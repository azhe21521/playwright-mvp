/**
 * Playwright MVP CDP Bridge Server
 * 提供标准 CDP HTTP/WebSocket 端点，将请求转发到 Chrome Extension
 */
import express, { type Express } from 'express';
import { createServer, type Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { createLogger } from '@playwright-mvp/shared';
import { config, validateConfig } from './config.js';

const logger = createLogger('CDPBridge', config.logLevel);

// ==================== 状态管理 ====================

/** 浏览器 ID（模拟） */
const browserId = randomUUID();

/** Extension WebSocket 连接 */
let extensionWs: WebSocket | null = null;

/** 等待认证的 Extension 连接 */
let pendingExtensionWs: WebSocket | null = null;

/** MCP/CDP 客户端连接列表 */
const cdpClients = new Map<string, WebSocket>();

/** 等待响应的请求 */
const pendingRequests = new Map<number, {
  clientId: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}>();

/** 请求 ID 计数器 */
let requestIdCounter = 0;

/** 服务启动时间 */
const startTime = Date.now();

/** 获取 Target 列表（从 Extension 获取） */
let cachedTargets: Target[] = [];

interface Target {
  id: string;
  type: 'page';
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
}

// ==================== CDP HTTP 端点 ====================

const app: Express = express();
app.use(express.json());

/**
 * GET /json/version - 浏览器版本信息
 */
app.get('/json/version', (req, res) => {
  const wsUrl = `ws://${req.headers.host}/devtools/browser/${browserId}`;
  res.json({
    'Browser': 'Chrome/120.0.0.0 (Playwright MVP Bridge)',
    'Protocol-Version': '1.3',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    'V8-Version': '12.0.267.8',
    'WebKit-Version': '537.36',
    'webSocketDebuggerUrl': wsUrl,
  });
});

/**
 * GET /json/list 或 /json - 可调试目标列表
 */
app.get(['/json/list', '/json'], async (req, res) => {
  logger.info(`收到 /json/list 请求`);
  try {
    const targets = await getTargetList(req.headers.host as string);
    logger.info(`返回 targets: ${JSON.stringify(targets)}`);
    res.json(targets);
  } catch (error) {
    logger.error(`获取 targets 失败: ${error}`);
    res.json([]);
  }
});

/**
 * GET /json/protocol - 协议定义（简化版）
 */
app.get('/json/protocol', (req, res) => {
  res.json({ domains: [] });
});

/**
 * PUT /json/new - 打开新标签页
 */
app.put('/json/new', async (req, res) => {
  const url = req.query.url as string || 'about:blank';
  try {
    const result = await sendToExtension({
      action: 'newTab',
      url,
    });
    const target = result as Target;
    target.webSocketDebuggerUrl = `ws://${req.headers.host}/devtools/page/${target.id}`;
    res.json(target);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create new tab' });
  }
});

/**
 * GET /json/activate/:targetId - 激活页面
 */
app.get('/json/activate/:targetId', async (req, res) => {
  try {
    await sendToExtension({
      action: 'activateTab',
      targetId: req.params.targetId,
    });
    res.send('Target activated');
  } catch (error) {
    res.status(404).send(`No such target id: ${req.params.targetId}`);
  }
});

/**
 * GET /json/close/:targetId - 关闭页面
 */
app.get('/json/close/:targetId', async (req, res) => {
  try {
    await sendToExtension({
      action: 'closeTab',
      targetId: req.params.targetId,
    });
    res.send('Target is closing');
  } catch (error) {
    res.status(404).send(`No such target id: ${req.params.targetId}`);
  }
});

/**
 * GET /health - 健康检查
 */
app.get('/health', (req, res) => {
  res.json({
    status: extensionWs ? 'healthy' : 'waiting_extension',
    version: config.version,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    extensionConnected: !!extensionWs,
    cdpClients: cdpClients.size,
  });
});

// ==================== 辅助函数 ====================

/**
 * 获取 Target 列表
 */
async function getTargetList(host: string): Promise<Target[]> {
  logger.info(`getTargetList 被调用, extensionWs=${!!extensionWs}, readyState=${extensionWs?.readyState}`);
  
  if (!extensionWs) {
    logger.warn('Extension 未连接，返回空列表');
    return [];
  }

  try {
    logger.info('向 Extension 发送 listTargets 请求...');
    const result = await sendToExtension({ action: 'listTargets' });
    logger.info(`Extension 返回结果: ${JSON.stringify(result)}`);
    const tabs = result as Array<{ id: string; title: string; url: string }>;
    
    cachedTargets = tabs.map(tab => ({
      id: tab.id,
      type: 'page' as const,
      title: tab.title,
      url: tab.url,
      webSocketDebuggerUrl: `ws://${host}/devtools/page/${tab.id}`,
    }));
    
    return cachedTargets;
  } catch (error) {
    logger.error('获取 Target 列表失败:', error);
    return cachedTargets;
  }
}

/**
 * 发送消息到 Extension 并等待响应
 */
function sendToExtension(message: object): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!extensionWs || extensionWs.readyState !== WebSocket.OPEN) {
      reject(new Error('Extension not connected'));
      return;
    }

    const id = ++requestIdCounter;
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error('Request timeout'));
    }, 30000);

    pendingRequests.set(id, {
      clientId: '__internal__',
      resolve,
      reject,
      timeout,
    });

    extensionWs.send(JSON.stringify({ id, ...message }));
  });
}

/**
 * 转发 CDP 命令到 Extension
 */
function forwardCdpToExtension(clientId: string, targetId: string, message: object): void {
  logger.info(`转发 CDP 命令: clientId=${clientId}, targetId=${targetId}, message=${JSON.stringify(message)}`);
  
  if (!extensionWs || extensionWs.readyState !== WebSocket.OPEN) {
    logger.warn(`Extension 未连接或连接已关闭: ws=${!!extensionWs}, readyState=${extensionWs?.readyState}`);
    const cdpClient = cdpClients.get(clientId);
    if (cdpClient) {
      const msg = message as { id?: number };
      cdpClient.send(JSON.stringify({
        id: msg.id,
        error: { code: -32000, message: 'Extension not connected' },
      }));
    }
    return;
  }

  // 为请求添加路由信息
  const forwardMessage = {
    ...(message as object),
    __clientId: clientId,
    __targetId: targetId,
  };

  const messageStr = JSON.stringify(forwardMessage);
  logger.info(`发送到 Extension: ${messageStr}`);
  logger.info(`Extension WebSocket 状态: readyState=${extensionWs.readyState}, bufferedAmount=${extensionWs.bufferedAmount}`);
  
  extensionWs.send(messageStr, (err) => {
    if (err) {
      logger.error(`发送到 Extension 失败: ${err.message}`);
    } else {
      logger.info(`发送到 Extension 成功`);
    }
  });
}

// ==================== WebSocket 服务器 ====================

const server = createServer(app);

const wss = new WebSocketServer({ noServer: true });

/**
 * 处理 HTTP 升级为 WebSocket
 */
server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url!, `http://${request.headers.host}`);
  const pathname = url.pathname;

  logger.debug(`WebSocket 升级请求: ${pathname}`);

  // Extension 连接端点
  if (pathname === '/extension') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      handleExtensionConnection(ws);
    });
    return;
  }

  // CDP 客户端连接端点
  if (pathname.startsWith('/devtools/browser/') || pathname.startsWith('/devtools/page/') || pathname === '/cdp') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      const targetId = pathname.startsWith('/devtools/page/') 
        ? pathname.replace('/devtools/page/', '')
        : 'browser';
      handleCdpClientConnection(ws, targetId);
    });
    return;
  }

  socket.destroy();
});

/**
 * 处理 Extension 连接
 */
function handleExtensionConnection(ws: WebSocket): void {
  logger.info('Extension 连接请求');

  // 如果需要 Token 验证
  if (config.authToken) {
    pendingExtensionWs = ws;
    
    // 设置认证超时
    const authTimeout = setTimeout(() => {
      if (pendingExtensionWs === ws) {
        logger.warn('Extension 认证超时');
        pendingExtensionWs = null;
        ws.close(4001, 'Auth timeout');
      }
    }, 30000);

    ws.once('message', (data) => {
      clearTimeout(authTimeout);
      
      try {
        const message = JSON.parse(data.toString());
        
        if (message.action === 'auth' && message.token === config.authToken) {
          pendingExtensionWs = null;
          extensionWs = ws;
          setupExtensionHandlers(ws);
          ws.send(JSON.stringify({ id: message.id, result: { success: true } }));
          logger.info('✅ Extension 认证成功并已连接');
        } else {
          logger.warn('Extension 认证失败');
          ws.close(4002, 'Auth failed');
        }
      } catch (error) {
        logger.error('Extension 认证消息解析失败');
        ws.close(4003, 'Invalid auth message');
      }
    });
  } else {
    // 无需认证
    extensionWs = ws;
    setupExtensionHandlers(ws);
    logger.info('✅ Extension 已连接（无认证）');
  }
}

/**
 * 设置 Extension 消息处理
 */
function setupExtensionHandlers(ws: WebSocket): void {
  ws.on('message', (data) => {
    logger.info(`收到 Extension 消息: ${data.toString().substring(0, 200)}`);
    try {
      const message = JSON.parse(data.toString());
      handleExtensionMessage(message);
    } catch (error) {
      logger.error('Extension 消息解析失败:', error);
    }
  });

  ws.on('close', (code, reason) => {
    logger.info(`Extension 断开连接: code=${code}, reason=${reason?.toString() || 'none'}`);
    extensionWs = null;
    
    // 通知所有 CDP 客户端
    for (const [clientId, client] of cdpClients) {
      client.close(4000, 'Extension disconnected');
    }
  });

  ws.on('error', (error) => {
    logger.error('Extension WebSocket 错误:', error);
  });

  // 设置 ping-pong 保活
  ws.on('pong', () => {
    logger.debug('收到 Extension pong');
  });

  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
      logger.debug('发送 ping 到 Extension');
    } else {
      clearInterval(pingInterval);
    }
  }, 10000);

  ws.on('close', () => {
    clearInterval(pingInterval);
  });
}

/**
 * 处理来自 Extension 的消息
 */
function handleExtensionMessage(message: Record<string, unknown>): void {
  const id = message.id as number | undefined;
  const clientId = message.__clientId as string | undefined;

  // 内部请求的响应
  if (id && !clientId) {
    const pending = pendingRequests.get(id);
    if (pending) {
      clearTimeout(pending.timeout);
      pendingRequests.delete(id);
      
      if (message.error) {
        pending.reject(new Error((message.error as { message: string }).message));
      } else {
        pending.resolve(message.result);
      }
    }
    return;
  }

  // CDP 客户端请求的响应
  if (clientId && clientId !== '__internal__') {
    const cdpClient = cdpClients.get(clientId);
    if (cdpClient && cdpClient.readyState === WebSocket.OPEN) {
      // 清除路由信息
      const cleanMessage = { ...message };
      delete cleanMessage.__clientId;
      delete cleanMessage.__targetId;
      
      const msgStr = JSON.stringify(cleanMessage);
      logger.info(`转发响应到 CDP 客户端 [${clientId}]: ${msgStr.substring(0, 150)}`);
      cdpClient.send(msgStr);
    } else {
      logger.warn(`CDP 客户端 [${clientId}] 不存在或已断开`);
    }
    return;
  }

  // CDP 事件（广播给所有客户端）
  if (message.method && !id) {
    const targetId = message.__targetId as string | undefined;
    
    // 清除路由信息
    const cleanMessage = { ...message };
    delete cleanMessage.__clientId;
    delete cleanMessage.__targetId;
    
    const eventData = JSON.stringify(cleanMessage);
    
    // 广播给对应的客户端
    for (const [cid, client] of cdpClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(eventData);
      }
    }
  }
}

/**
 * 处理 CDP 客户端连接
 */
function handleCdpClientConnection(ws: WebSocket, targetId: string): void {
  const clientId = randomUUID();
  cdpClients.set(clientId, ws);
  
  logger.info(`CDP 客户端已连接: ${clientId}, target: ${targetId}, readyState: ${ws.readyState}`);

  ws.on('message', (data) => {
    logger.info(`收到 CDP 消息 [${clientId}]: ${data.toString().substring(0, 200)}`);
    try {
      const message = JSON.parse(data.toString());
      logger.info(`CDP 请求 [${clientId}]: method=${message.method}, id=${message.id}`);
      forwardCdpToExtension(clientId, targetId, message);
    } catch (error) {
      logger.error('CDP 消息解析失败:', error);
    }
  });

  ws.on('close', (code, reason) => {
    logger.info(`CDP 客户端断开: ${clientId}, code=${code}, reason=${reason?.toString() || 'none'}`);
    cdpClients.delete(clientId);
  });

  ws.on('error', (error) => {
    logger.error(`CDP 客户端错误 [${clientId}]:`, error);
  });
}

// ==================== 启动服务器 ====================

// 验证配置
const configErrors = validateConfig();
for (const error of configErrors) {
  if (error.startsWith('警告')) {
    logger.warn(error);
  } else {
    logger.error(error);
  }
}

server.listen(config.port, config.host, () => {
  logger.info('');
  logger.info('🚀 CDP Bridge Server 启动成功');
  logger.info(`   端口: ${config.port}`);
  logger.info(`   Token 验证: ${config.authToken ? '已启用' : '未启用'}`);
  logger.info('');
  logger.info('📋 HTTP 端点:');
  logger.info(`   GET  http://localhost:${config.port}/json/version`);
  logger.info(`   GET  http://localhost:${config.port}/json/list`);
  logger.info('');
  logger.info('🔌 WebSocket 端点:');
  logger.info(`   Extension: ws://localhost:${config.port}/extension`);
  logger.info(`   CDP:       ws://localhost:${config.port}/devtools/browser/${browserId}`);
  logger.info('');
  logger.info('💡 使用方式:');
  logger.info(`   Playwright MCP: --cdp-endpoint http://localhost:${config.port}`);
  logger.info('');
});

// 优雅关闭
process.on('SIGTERM', () => {
  logger.info('收到 SIGTERM 信号，开始优雅关闭...');
  
  // 关闭所有连接
  if (extensionWs) {
    extensionWs.close();
  }
  for (const [, client] of cdpClients) {
    client.close();
  }
  cdpClients.clear();
  
  server.close(() => {
    logger.info('服务器已关闭');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  process.emit('SIGTERM', 'SIGTERM');
});

export { app, server };
