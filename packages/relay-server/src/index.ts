/**
 * Playwright MVP CDP Bridge Server
 * 
 * 架构：
 *   Playwright MCP  <--CDP-->  CDPBridge  <--自定义协议-->  Chrome Extension
 * 
 * 端点：
 *   /cdp        - Playwright MCP 连接（标准 CDP 协议）
 *   /extension  - Chrome Extension 连接（自定义扩展协议）
 * 
 * 多标签支持：
 *   Bridge 可以同时管理多个标签页。每个标签页有独立的 CDP Session。
 *   Playwright 通过 Target.setAutoAttach 附加到标签页。
 */
import express, { type Express } from 'express';
import { createServer, type Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { createLogger } from '@playwright-mvp/shared';
import { config, validateConfig } from './config.js';

const logger = createLogger('CDPBridge', config.logLevel);

// ==================== 类型定义 ====================

interface TabSession {
  tabId: number;
  sessionId: string;
  targetInfo: any;
}

interface ExtensionCommand {
  id: number;
  method: string;
  params?: any;
}

interface ExtensionResponse {
  id?: number;
  method?: string;
  params?: any;
  result?: any;
  error?: string;
}

// ==================== 状态管理 ====================

/** 浏览器 ID（模拟） */
const browserId = randomUUID();

/** Extension WebSocket 连接 */
let extensionWs: WebSocket | null = null;

/** 等待认证的 Extension 连接 */
let pendingExtensionWs: WebSocket | null = null;

/** Playwright MCP 客户端连接 */
let playwrightWs: WebSocket | null = null;

/** 服务启动时间 */
const startTime = Date.now();

// 多标签 Session 管理
/** sessionId -> TabSession */
const sessions = new Map<string, TabSession>();
/** tabId -> sessionId */
const tabToSession = new Map<number, string>();
/** 子 CDP sessionId -> tabId */
const childSessionToTab = new Map<string, number>();
/** 下一个 Session ID */
let nextSessionId = 1;

/** Auto-attach 状态 */
let autoAttachEnabled = false;

// Extension 命令回调管理
let extensionCommandId = 0;
const extensionCallbacks = new Map<number, {
  resolve: (result: any) => void;
  reject: (error: Error) => void;
  method: string;
  timeout: NodeJS.Timeout;
}>();

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
    const targets = Array.from(sessions.values()).map(s => ({
      id: s.targetInfo?.targetId || String(s.tabId),
      type: 'page',
      title: s.targetInfo?.title || '',
      url: s.targetInfo?.url || '',
      webSocketDebuggerUrl: `ws://${req.headers.host}/devtools/page/${s.sessionId}`,
    }));
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
 * GET /health - 健康检查
 */
app.get('/health', (req, res) => {
  res.json({
    status: extensionWs ? 'healthy' : 'waiting_extension',
    version: config.version,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    extensionConnected: !!extensionWs,
    playwrightConnected: !!playwrightWs,
    activeSessions: sessions.size,
  });
});

// ==================== Extension 通信 ====================

/**
 * 发送命令到 Extension 并等待响应
 */
function sendToExtension(method: string, params: any = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!extensionWs || extensionWs.readyState !== WebSocket.OPEN) {
      reject(new Error('Extension not connected'));
      return;
    }

    const id = ++extensionCommandId;
    const timeout = setTimeout(() => {
      extensionCallbacks.delete(id);
      reject(new Error(`Extension command timeout: ${method}`));
    }, 30000);

    extensionCallbacks.set(id, {
      resolve,
      reject,
      method,
      timeout,
    });

    const message: ExtensionCommand = { id, method, params };
    logger.debug(`→ Extension: ${method} (id=${id})`);
    extensionWs.send(JSON.stringify(message));
  });
}

/**
 * 附加到标签页
 */
async function attachToTab(tabId: number): Promise<void> {
  if (tabToSession.has(tabId)) {
    logger.debug(`Tab ${tabId} 已附加，跳过`);
    return;
  }

  if (!extensionWs) {
    throw new Error('Extension not connected');
  }

  try {
    const { targetInfo } = await sendToExtension('attachToTab', { tabId });
    const sessionId = `pw-tab-${nextSessionId++}`;

    const session: TabSession = { tabId, sessionId, targetInfo };
    sessions.set(sessionId, session);
    tabToSession.set(tabId, sessionId);

    logger.info(`已附加到 Tab ${tabId}, sessionId=${sessionId}`);

    // 通知 Playwright 新的 target
    sendToPlaywright({
      method: 'Target.attachedToTarget',
      params: {
        sessionId,
        targetInfo: {
          ...targetInfo,
          attached: true,
        },
        waitingForDebugger: false,
      },
    });
  } catch (e: any) {
    logger.error(`附加到 Tab ${tabId} 失败: ${e.message}`);
  }
}

/**
 * 从标签页分离
 */
async function detachFromTab(tabId: number): Promise<void> {
  const sessionId = tabToSession.get(tabId);
  if (!sessionId) return;

  const session = sessions.get(sessionId);
  if (!session) return;

  sessions.delete(sessionId);
  tabToSession.delete(tabId);
  
  // 清理子 session
  for (const [childSessionId, childTabId] of childSessionToTab) {
    if (childTabId === tabId) {
      childSessionToTab.delete(childSessionId);
    }
  }

  if (extensionWs) {
    try {
      await sendToExtension('detachFromTab', { tabId });
    } catch (e: any) {
      logger.debug(`分离 Tab ${tabId} 出错: ${e.message}`);
    }
  }

  sendToPlaywright({
    method: 'Target.detachedFromTarget',
    params: { sessionId },
  });
}

/**
 * 转发 CDP 命令到 Extension
 */
async function forwardToExtension(method: string, params: any, sessionId: string | undefined): Promise<any> {
  if (!extensionWs) {
    throw new Error('Extension not connected');
  }

  // 从 sessionId 解析 tabId
  let tabId: number | undefined;
  let actualSessionId: string | undefined;
  
  if (sessionId) {
    const session = sessions.get(sessionId);
    if (session) {
      tabId = session.tabId;
      // 顶层 sessionId 仅在 bridge 和 Playwright 之间使用
      actualSessionId = undefined;
    } else {
      // 可能是子 session
      tabId = childSessionToTab.get(sessionId);
      if (tabId !== undefined) {
        actualSessionId = sessionId;
      } else {
        throw new Error(`Unknown CDP sessionId: ${sessionId}`);
      }
    }
  }

  if (tabId === undefined) {
    // 浏览器级别命令：使用第一个可用的已附加标签页
    const firstSession = sessions.values().next().value;
    if (firstSession) {
      tabId = firstSession.tabId;
    }
  }

  if (tabId === undefined) {
    throw new Error('No tab connected');
  }

  return await sendToExtension('forwardCDPCommand', {
    tabId,
    sessionId: actualSessionId,
    method,
    params,
  });
}

// ==================== Playwright 通信 ====================

/**
 * 发送消息到 Playwright
 */
function sendToPlaywright(message: any): void {
  if (playwrightWs?.readyState === WebSocket.OPEN) {
    logger.debug(`→ Playwright: ${message.method ?? `response(id=${message.id})`}`);
    playwrightWs.send(JSON.stringify(message));
  }
}

/**
 * 处理 CDP 命令
 */
async function handleCDPCommand(id: number, method: string, params: any, sessionId: string | undefined): Promise<void> {
  logger.debug(`← Playwright: ${method} (id=${id}, sessionId=${sessionId})`);

  try {
    let result: any;

    switch (method) {
      case 'Browser.getVersion':
        result = {
          protocolVersion: '1.3',
          product: 'Chrome/Extension-Bridge',
          userAgent: 'CDP-Bridge-Server/1.0.0',
        };
        break;

      case 'Browser.setDownloadBehavior':
        result = {};
        break;

      case 'Target.setAutoAttach': {
        // 对于子 session（sessionId 存在），转发到 extension
        if (sessionId) {
          result = await forwardToExtension(method, params, sessionId);
          break;
        }

        if (!extensionWs) {
          logger.info('等待 Extension 连接...');
          throw new Error('Extension not connected');
        }

        autoAttachEnabled = true;

        // 从 Extension 获取所有可用标签页并自动附加
        const tabsResult = await sendToExtension('listTabs', {});
        const tabs: Array<{ id: number; title: string; url: string }> = tabsResult?.tabs || [];

        logger.info(`Auto-attaching to ${tabs.length} tabs`);

        for (const tab of tabs) {
          await attachToTab(tab.id);
        }

        result = {};
        break;
      }

      case 'Target.getTargets': {
        // 返回所有当前已附加的 targets
        const targets = Array.from(sessions.values()).map(s => ({
          ...s.targetInfo,
          attached: true,
        }));
        result = { targetInfos: targets };
        break;
      }

      case 'Target.getTargetInfo': {
        if (sessionId) {
          const session = sessions.get(sessionId);
          if (session) {
            result = { targetInfo: session.targetInfo };
            break;
          }
        }
        // 如果没有指定 session，返回第一个 target
        const first = sessions.values().next().value;
        result = first ? { targetInfo: first.targetInfo } : {};
        break;
      }

      case 'Target.detachFromTarget': {
        const targetSessionId = params?.sessionId;
        if (targetSessionId) {
          const session = sessions.get(targetSessionId);
          if (session) {
            await detachFromTab(session.tabId);
          }
        }
        result = {};
        break;
      }

      case 'Target.closeTarget': {
        const targetId = params?.targetId;
        if (targetId) {
          const session = Array.from(sessions.values()).find(
            s => s.targetInfo?.targetId === targetId
          );
          if (session) {
            await sendToExtension('closeTab', { tabId: session.tabId });
            result = { success: true };
            break;
          }
        }
        result = await forwardToExtension(method, params, sessionId);
        break;
      }

      default:
        // 转发到 Extension
        result = await forwardToExtension(method, params, sessionId);
        break;
    }

    sendToPlaywright({ id, sessionId, result });
  } catch (e: any) {
    const isKnownLimitation = /session.*not found|no frame for given id/i.test(e.message);
    if (isKnownLimitation) {
      logger.warn(`CDP 命令 ${method} (已知限制): ${e.message}`);
    } else {
      logger.error(`CDP 命令 ${method} 处理失败: ${e.message}`);
    }
    sendToPlaywright({
      id,
      sessionId,
      error: { message: e.message },
    });
  }
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
  if (pathname.startsWith('/devtools/browser/') || 
      pathname.startsWith('/devtools/page/') || 
      pathname === '/cdp') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      handlePlaywrightConnection(ws);
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
    const raw = data.toString();
    logger.debug(`← Extension: ${raw.substring(0, 200)}`);
    
    try {
      const message: ExtensionResponse = JSON.parse(raw);
      handleExtensionMessage(message);
    } catch (error) {
      logger.error('Extension 消息解析失败:', error);
    }
  });

  ws.on('close', (code, reason) => {
    logger.info(`Extension 断开连接: code=${code}, reason=${reason?.toString() || 'none'}`);
    extensionWs = null;
    
    // 清理所有 session
    sessions.clear();
    tabToSession.clear();
    childSessionToTab.clear();
    autoAttachEnabled = false;
    
    // 通知 Playwright 断开
    if (playwrightWs?.readyState === WebSocket.OPEN) {
      playwrightWs.close(4000, 'Extension disconnected');
    }
  });

  ws.on('error', (error) => {
    logger.error('Extension WebSocket 错误:', error);
  });

  // 设置 ping-pong 保活
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
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
function handleExtensionMessage(message: ExtensionResponse): void {
  // 响应消息（有 id）
  if (message.id && extensionCallbacks.has(message.id)) {
    const callback = extensionCallbacks.get(message.id)!;
    extensionCallbacks.delete(message.id);
    clearTimeout(callback.timeout);

    if (message.error) {
      callback.reject(new Error(message.error));
    } else {
      logger.debug(`← Extension: ${callback.method} 响应 (id=${message.id})`);
      callback.resolve(message.result);
    }
    return;
  }

  // 事件消息（无 id，有 method）
  if (message.method) {
    handleExtensionEvent(message.method, message.params);
  }
}

/**
 * 处理 Extension 事件
 */
function handleExtensionEvent(method: string, params: any): void {
  switch (method) {
    case 'forwardCDPEvent': {
      const tabId = params.tabId;
      const sessionId = tabToSession.get(tabId);
      const childSessionId = params.sessionId as string | undefined;
      
      if (childSessionId) {
        childSessionToTab.set(childSessionId, tabId);
      }
      
      const eventSessionId = childSessionId || sessionId;
      sendToPlaywright({
        sessionId: eventSessionId,
        method: params.method,
        params: params.params,
      });
      break;
    }

    case 'tabDetached': {
      const { tabId, reason } = params;
      logger.info(`Tab ${tabId} 已分离: ${reason}`);
      
      const sessionId = tabToSession.get(tabId);
      if (sessionId) {
        sessions.delete(sessionId);
        tabToSession.delete(tabId);
        
        // 清理子 session
        for (const [childSessionId, childTabId] of childSessionToTab) {
          if (childTabId === tabId) {
            childSessionToTab.delete(childSessionId);
          }
        }
        
        sendToPlaywright({
          method: 'Target.detachedFromTarget',
          params: { sessionId },
        });
      }
      break;
    }
  }
}

/**
 * 处理 Playwright 连接
 */
function handlePlaywrightConnection(ws: WebSocket): void {
  if (playwrightWs) {
    logger.warn('拒绝第二个 Playwright 连接');
    ws.close(1000, 'Another CDP client already connected');
    return;
  }
  
  playwrightWs = ws;
  logger.info('✅ Playwright MCP 已连接');

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      const { id, sessionId, method, params } = message;
      handleCDPCommand(id, method, params, sessionId);
    } catch (e: any) {
      logger.error('Playwright 消息处理错误:', e.message);
    }
  });

  ws.on('close', () => {
    if (playwrightWs !== ws) return;
    playwrightWs = null;
    
    // 清理 session
    sessions.clear();
    tabToSession.clear();
    childSessionToTab.clear();
    autoAttachEnabled = false;
    
    logger.info('Playwright MCP 已断开');
  });

  ws.on('error', (e) => {
    logger.error('Playwright WebSocket 错误:', e.message);
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
  logger.info(`   GET  http://localhost:${config.port}/health`);
  logger.info('');
  logger.info('🔌 WebSocket 端点:');
  logger.info(`   Extension: ws://localhost:${config.port}/extension`);
  logger.info(`   CDP:       ws://localhost:${config.port}/cdp`);
  logger.info(`   Browser:   ws://localhost:${config.port}/devtools/browser/${browserId}`);
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
  if (playwrightWs) {
    playwrightWs.close();
  }
  
  // 清理回调
  for (const [id, callback] of extensionCallbacks) {
    clearTimeout(callback.timeout);
    callback.reject(new Error('Server shutting down'));
  }
  extensionCallbacks.clear();
  
  server.close(() => {
    logger.info('服务器已关闭');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  process.emit('SIGTERM', 'SIGTERM');
});

export { app, server };
