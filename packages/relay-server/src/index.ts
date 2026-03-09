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
 * 
 * 日志级别控制：
 *   LOG_LEVEL=trace|debug|info|warn|error  (默认: info)
 *   LOG_TO_FILE=1  (启用文件日志)
 *   LOG_DIR=<path>  (日志文件目录，默认: ./logs)
 * 
 * 调试模式：
 *   LOG_LEVEL=debug 或 CDP_BRIDGE_DEBUG=1
 */
import express, { type Express } from 'express';
import { createServer, type Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { createLogger } from '@playwright-mvp/shared';
import { config, validateConfig } from './config.js';

// 创建日志记录器，启用文件日志
const enableFileLog = process.env.LOG_TO_FILE === '1' || process.env.LOG_TO_FILE === 'true';
const logger = createLogger('CDPBridge', config.logLevel, enableFileLog);

// 启动时打印配置信息
logger.info('========================================');
logger.info('CDP Bridge Server 正在初始化...');
logger.info(`日志级别: ${config.logLevel}`);
logger.info(`文件日志: ${enableFileLog ? '已启用' : '未启用'}`);
logger.info('========================================');

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
      const error = new Error('Extension not connected');
      logger.error(`[sendToExtension] ${method} 失败: Extension 未连接`);
      reject(error);
      return;
    }

    const id = ++extensionCommandId;
    const startTime = Date.now();
    
    const timeout = setTimeout(() => {
      const elapsed = Date.now() - startTime;
      logger.error(`[sendToExtension] ${method} (id=${id}) 超时，已等待 ${elapsed}ms`);
      extensionCallbacks.delete(id);
      reject(new Error(`Extension command timeout: ${method}`));
    }, 30000);

    extensionCallbacks.set(id, {
      resolve: (result) => {
        const elapsed = Date.now() - startTime;
        logger.trace(`[sendToExtension] ${method} (id=${id}) 完成，耗时 ${elapsed}ms`);
        resolve(result);
      },
      reject: (error) => {
        const elapsed = Date.now() - startTime;
        logger.error(`[sendToExtension] ${method} (id=${id}) 失败，耗时 ${elapsed}ms:`, error.message);
        reject(error);
      },
      method,
      timeout,
    });

    const message: ExtensionCommand = { id, method, params };
    const msgStr = JSON.stringify(message);
    logger.debug(`→ Extension: ${method} (id=${id}), params: ${JSON.stringify(params).substring(0, 200)}`);
    logger.trace(`[sendToExtension] 完整消息: ${msgStr}`);
    extensionWs.send(msgStr);
  });
}

/**
 * 附加到标签页
 */
async function attachToTab(tabId: number): Promise<void> {
  logger.debug(`[attachToTab] 开始附加到 Tab ${tabId}`);
  
  if (tabToSession.has(tabId)) {
    logger.debug(`[attachToTab] Tab ${tabId} 已附加，跳过`);
    return;
  }

  if (!extensionWs) {
    logger.error(`[attachToTab] Tab ${tabId}: Extension 未连接`);
    throw new Error('Extension not connected');
  }

  const startTime = Date.now();
  
  try {
    logger.debug(`[attachToTab] 发送 attachToTab 命令到 Extension, tabId=${tabId}`);
    const { targetInfo } = await sendToExtension('attachToTab', { tabId });
    const sessionId = `pw-tab-${nextSessionId++}`;

    const session: TabSession = { tabId, sessionId, targetInfo };
    sessions.set(sessionId, session);
    tabToSession.set(tabId, sessionId);

    const elapsed = Date.now() - startTime;
    logger.info(`✅ 已附加到 Tab ${tabId}, sessionId=${sessionId}, 耗时 ${elapsed}ms`);
    logger.debug(`[attachToTab] targetInfo:`, JSON.stringify(targetInfo));

    // 通知 Playwright 新的 target
    logger.debug(`[attachToTab] 通知 Playwright Target.attachedToTarget`);
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
    
    logger.debug(`[attachToTab] Tab ${tabId} 附加流程完成`);
  } catch (e: any) {
    const elapsed = Date.now() - startTime;
    logger.error(`❌ 附加到 Tab ${tabId} 失败 (耗时 ${elapsed}ms): ${e.message}`);
    logger.debug(`[attachToTab] 错误堆栈:`, e.stack);
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
  logger.trace(`[forwardToExtension] 开始: method=${method}, sessionId=${sessionId}`);
  
  if (!extensionWs) {
    logger.error(`[forwardToExtension] Extension 未连接，无法转发 ${method}`);
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
      logger.trace(`[forwardToExtension] 从顶层 session ${sessionId} 解析到 tabId=${tabId}`);
    } else {
      // 可能是子 session
      tabId = childSessionToTab.get(sessionId);
      if (tabId !== undefined) {
        actualSessionId = sessionId;
        logger.trace(`[forwardToExtension] 从子 session ${sessionId} 解析到 tabId=${tabId}`);
      } else {
        logger.error(`[forwardToExtension] 未知的 sessionId: ${sessionId}`);
        logger.debug(`[forwardToExtension] 当前 sessions: ${Array.from(sessions.keys()).join(', ')}`);
        logger.debug(`[forwardToExtension] 当前 childSessions: ${Array.from(childSessionToTab.keys()).join(', ')}`);
        throw new Error(`Unknown CDP sessionId: ${sessionId}`);
      }
    }
  }

  if (tabId === undefined) {
    // 浏览器级别命令：使用第一个可用的已附加标签页
    const firstSession = sessions.values().next().value;
    if (firstSession) {
      tabId = firstSession.tabId;
      logger.trace(`[forwardToExtension] 使用第一个可用 Tab: ${tabId}`);
    }
  }

  if (tabId === undefined) {
    logger.error(`[forwardToExtension] 没有已连接的 Tab，无法转发 ${method}`);
    logger.debug(`[forwardToExtension] sessions.size=${sessions.size}, tabToSession.size=${tabToSession.size}`);
    throw new Error('No tab connected');
  }

  const startTime = Date.now();
  logger.debug(`[forwardToExtension] 转发 CDP 命令: ${method} → Tab ${tabId}`);
  
  try {
    const result = await sendToExtension('forwardCDPCommand', {
      tabId,
      sessionId: actualSessionId,
      method,
      params,
    });
    
    const elapsed = Date.now() - startTime;
    logger.trace(`[forwardToExtension] ${method} 完成，耗时 ${elapsed}ms`);
    return result;
  } catch (e: any) {
    const elapsed = Date.now() - startTime;
    logger.error(`[forwardToExtension] ${method} 失败 (耗时 ${elapsed}ms): ${e.message}`);
    throw e;
  }
}

// ==================== Playwright 通信 ====================

/**
 * 发送消息到 Playwright
 */
function sendToPlaywright(message: any): void {
  if (playwrightWs?.readyState === WebSocket.OPEN) {
    const msgStr = JSON.stringify(message);
    const msgType = message.method ?? (message.id ? `response(id=${message.id})` : 'unknown');
    logger.debug(`→ Playwright: ${msgType}`);
    logger.trace(`[sendToPlaywright] 完整消息: ${msgStr.substring(0, 500)}${msgStr.length > 500 ? '...(truncated)' : ''}`);
    playwrightWs.send(msgStr);
  } else {
    const state = playwrightWs ? `readyState=${playwrightWs.readyState}` : 'null';
    logger.warn(`[sendToPlaywright] Playwright 未连接 (${state})，丢弃消息: ${message.method ?? message.id}`);
  }
}

/**
 * 处理 CDP 命令
 */
async function handleCDPCommand(id: number, method: string, params: any, sessionId: string | undefined): Promise<void> {
  const startTime = Date.now();
  logger.debug(`← Playwright: ${method} (id=${id}, sessionId=${sessionId || 'none'})`);
  logger.trace(`[handleCDPCommand] params: ${JSON.stringify(params || {}).substring(0, 300)}`);
  
  // 打印当前状态
  logger.trace(`[handleCDPCommand] 状态: extension=${extensionWs ? 'connected' : 'disconnected'}, sessions=${sessions.size}, autoAttach=${autoAttachEnabled}`);

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
        logger.info(`[Target.setAutoAttach] 开始处理, sessionId=${sessionId || 'none'}`);
        
        // 对于子 session（sessionId 存在），转发到 extension
        if (sessionId) {
          logger.debug(`[Target.setAutoAttach] 子 session，转发到 Extension`);
          result = await forwardToExtension(method, params, sessionId);
          break;
        }

        if (!extensionWs) {
          logger.error('[Target.setAutoAttach] Extension 未连接，无法执行 auto-attach');
          throw new Error('Extension not connected');
        }

        autoAttachEnabled = true;
        logger.info('[Target.setAutoAttach] Auto-attach 已启用');

        // 从 Extension 获取所有可用标签页并自动附加
        logger.debug('[Target.setAutoAttach] 获取可用标签页列表...');
        const tabsResult = await sendToExtension('listTabs', {});
        const tabs: Array<{ id: number; title: string; url: string }> = tabsResult?.tabs || [];

        logger.info(`[Target.setAutoAttach] 发现 ${tabs.length} 个可用标签页`);
        tabs.forEach((tab, i) => {
          logger.debug(`  Tab ${i + 1}: id=${tab.id}, title="${tab.title?.substring(0, 50)}", url=${tab.url?.substring(0, 80)}`);
        });

        logger.info(`[Target.setAutoAttach] 开始自动附加到 ${tabs.length} 个标签页...`);
        let attachedCount = 0;
        let failedCount = 0;
        
        for (const tab of tabs) {
          try {
            await attachToTab(tab.id);
            attachedCount++;
          } catch (e: any) {
            failedCount++;
            logger.warn(`[Target.setAutoAttach] 附加到 Tab ${tab.id} 失败: ${e.message}`);
          }
        }

        logger.info(`[Target.setAutoAttach] 完成: 成功 ${attachedCount}, 失败 ${failedCount}`);
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

    const elapsed = Date.now() - startTime;
    logger.trace(`[handleCDPCommand] ${method} 完成，耗时 ${elapsed}ms`);
    sendToPlaywright({ id, sessionId, result });
  } catch (e: any) {
    const elapsed = Date.now() - startTime;
    const isKnownLimitation = /session.*not found|no frame for given id/i.test(e.message);
    if (isKnownLimitation) {
      logger.warn(`⚠️ CDP 命令 ${method} (已知限制, 耗时 ${elapsed}ms): ${e.message}`);
    } else {
      logger.error(`❌ CDP 命令 ${method} 处理失败 (耗时 ${elapsed}ms): ${e.message}`);
      logger.debug(`[handleCDPCommand] 错误堆栈:`, e.stack);
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
  const remoteAddress = request.socket.remoteAddress;

  logger.info(`[WebSocket 升级] 新连接请求: ${pathname} from ${remoteAddress}`);
  logger.debug(`[WebSocket 升级] headers: ${JSON.stringify(request.headers).substring(0, 200)}`);

  // Extension 连接端点
  if (pathname === '/extension') {
    logger.info(`[WebSocket 升级] Extension 连接请求`);
    wss.handleUpgrade(request, socket, head, (ws) => {
      handleExtensionConnection(ws);
    });
    return;
  }

  // CDP 客户端连接端点
  if (pathname.startsWith('/devtools/browser/') || 
      pathname.startsWith('/devtools/page/') || 
      pathname === '/cdp') {
    logger.info(`[WebSocket 升级] Playwright/CDP 连接请求`);
    wss.handleUpgrade(request, socket, head, (ws) => {
      handlePlaywrightConnection(ws);
    });
    return;
  }

  logger.warn(`[WebSocket 升级] 未知路径，拒绝连接: ${pathname}`);
  socket.destroy();
});

/**
 * 处理 Extension 连接
 */
function handleExtensionConnection(ws: WebSocket): void {
  logger.info('========================================');
  logger.info('🔌 Extension 连接请求');
  logger.info('========================================');

  // 如果需要 Token 验证
  if (config.authToken) {
    logger.info('[Extension] 需要 Token 认证');
    pendingExtensionWs = ws;
    
    // 设置认证超时
    const authTimeout = setTimeout(() => {
      if (pendingExtensionWs === ws) {
        logger.warn('[Extension] 认证超时（30秒）');
        pendingExtensionWs = null;
        ws.close(4001, 'Auth timeout');
      }
    }, 30000);

    ws.once('message', (data) => {
      clearTimeout(authTimeout);
      const dataStr = data.toString();
      logger.debug(`[Extension] 收到认证消息: ${dataStr.substring(0, 200)}`);
      
      try {
        const message = JSON.parse(dataStr);
        
        if (message.action === 'auth' && message.token === config.authToken) {
          pendingExtensionWs = null;
          extensionWs = ws;
          setupExtensionHandlers(ws);
          ws.send(JSON.stringify({ id: message.id, result: { success: true } }));
          logger.info('✅ Extension 认证成功并已连接');
          logger.info(`   Token 验证: 通过`);
        } else {
          logger.warn('[Extension] 认证失败: Token 不匹配或格式错误');
          logger.debug(`[Extension] 期望 action=auth, 收到 action=${message.action}`);
          ws.close(4002, 'Auth failed');
        }
      } catch (error: any) {
        logger.error(`[Extension] 认证消息解析失败: ${error.message}`);
        ws.close(4003, 'Invalid auth message');
      }
    });
  } else {
    // 无需认证
    logger.info('[Extension] 无需认证，直接连接');
    extensionWs = ws;
    setupExtensionHandlers(ws);
    logger.info('✅ Extension 已连接（无认证模式）');
  }
}

/**
 * 设置 Extension 消息处理
 */
function setupExtensionHandlers(ws: WebSocket): void {
  let messageCount = 0;
  
  ws.on('message', (data) => {
    const raw = data.toString();
    messageCount++;
    
    // 根据消息类型决定日志级别
    const isResponse = raw.includes('"id"') && !raw.includes('"method"');
    const isEvent = raw.includes('"method"') && raw.includes('forwardCDPEvent');
    
    if (isEvent) {
      // CDP 事件使用 trace 级别
      logger.trace(`← Extension [${messageCount}]: CDP Event, len=${raw.length}`);
    } else if (isResponse) {
      logger.debug(`← Extension [${messageCount}]: Response, len=${raw.length}`);
    } else {
      logger.debug(`← Extension [${messageCount}]: ${raw.substring(0, 200)}`);
    }
    
    logger.trace(`[Extension 消息] 完整内容: ${raw.substring(0, 1000)}`);
    
    try {
      const message: ExtensionResponse = JSON.parse(raw);
      handleExtensionMessage(message);
    } catch (error: any) {
      logger.error(`[Extension] 消息解析失败: ${error.message}`);
      logger.debug(`[Extension] 原始消息: ${raw.substring(0, 500)}`);
    }
  });

  ws.on('close', (code, reason) => {
    logger.info('========================================');
    logger.info(`⚡ Extension 断开连接`);
    logger.info(`   关闭码: ${code}`);
    logger.info(`   原因: ${reason?.toString() || 'none'}`);
    logger.info(`   总消息数: ${messageCount}`);
    logger.info('========================================');
    
    extensionWs = null;
    
    // 清理所有 session
    const sessionCount = sessions.size;
    const tabCount = tabToSession.size;
    sessions.clear();
    tabToSession.clear();
    childSessionToTab.clear();
    autoAttachEnabled = false;
    
    logger.info(`[Extension] 已清理 ${sessionCount} 个 session, ${tabCount} 个 tab 映射`);
    
    // 通知 Playwright 断开
    if (playwrightWs?.readyState === WebSocket.OPEN) {
      logger.info('[Extension] 通知 Playwright 断开连接');
      playwrightWs.close(4000, 'Extension disconnected');
    }
  });

  ws.on('error', (error: any) => {
    logger.error(`[Extension] WebSocket 错误: ${error.message}`);
    logger.debug(`[Extension] 错误详情:`, error);
  });

  // 设置 ping-pong 保活
  let pingCount = 0;
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      pingCount++;
      logger.trace(`[Extension] 发送 ping #${pingCount}`);
      ws.ping();
    } else {
      clearInterval(pingInterval);
    }
  }, 10000);

  ws.on('pong', () => {
    logger.trace(`[Extension] 收到 pong`);
  });

  ws.on('close', () => {
    clearInterval(pingInterval);
  });
  
  logger.info('[Extension] 消息处理器已设置');
}

/**
 * 处理来自 Extension 的消息
 */
function handleExtensionMessage(message: ExtensionResponse): void {
  // 响应消息（有 id）
  if (message.id !== undefined && extensionCallbacks.has(message.id)) {
    const callback = extensionCallbacks.get(message.id)!;
    extensionCallbacks.delete(message.id);
    clearTimeout(callback.timeout);

    if (message.error) {
      logger.debug(`[Extension 响应] ${callback.method} (id=${message.id}) 错误: ${message.error}`);
      callback.reject(new Error(message.error));
    } else {
      logger.debug(`[Extension 响应] ${callback.method} (id=${message.id}) 成功`);
      logger.trace(`[Extension 响应] result: ${JSON.stringify(message.result).substring(0, 300)}`);
      callback.resolve(message.result);
    }
    return;
  }

  // 事件消息（无 id，有 method）
  if (message.method) {
    logger.trace(`[Extension 事件] ${message.method}`);
    handleExtensionEvent(message.method, message.params);
    return;
  }
  
  // 未知消息格式
  if (message.id !== undefined) {
    logger.warn(`[Extension] 收到无对应回调的响应 id=${message.id}`);
    logger.debug(`[Extension] 当前等待的回调 ids: ${Array.from(extensionCallbacks.keys()).join(', ')}`);
  } else {
    logger.warn(`[Extension] 收到未知格式的消息:`, JSON.stringify(message).substring(0, 200));
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
    logger.warn('[Playwright] 拒绝第二个连接，已有一个 Playwright 客户端连接');
    ws.close(1000, 'Another CDP client already connected');
    return;
  }
  
  playwrightWs = ws;
  let messageCount = 0;
  
  logger.info('========================================');
  logger.info('✅ Playwright MCP 已连接');
  logger.info(`   Extension 状态: ${extensionWs ? '已连接' : '未连接'}`);
  logger.info(`   当前 sessions: ${sessions.size}`);
  logger.info('========================================');

  ws.on('message', (data) => {
    const raw = data.toString();
    messageCount++;
    
    try {
      const message = JSON.parse(raw);
      const { id, sessionId, method, params } = message;
      
      // 根据方法类型决定日志级别
      const isFrequentMethod = ['Runtime.evaluate', 'DOM.getDocument', 'Page.getFrameTree'].includes(method);
      if (isFrequentMethod) {
        logger.trace(`← Playwright [${messageCount}]: ${method} (id=${id})`);
      } else {
        logger.debug(`← Playwright [${messageCount}]: ${method} (id=${id})`);
      }
      
      handleCDPCommand(id, method, params, sessionId);
    } catch (e: any) {
      logger.error(`[Playwright] 消息处理错误: ${e.message}`);
      logger.debug(`[Playwright] 原始消息: ${raw.substring(0, 500)}`);
    }
  });

  ws.on('close', (code, reason) => {
    if (playwrightWs !== ws) return;
    playwrightWs = null;
    
    logger.info('========================================');
    logger.info(`⚡ Playwright MCP 已断开`);
    logger.info(`   关闭码: ${code}`);
    logger.info(`   原因: ${reason?.toString() || 'none'}`);
    logger.info(`   总消息数: ${messageCount}`);
    logger.info('========================================');
    
    // 清理 session
    const sessionCount = sessions.size;
    sessions.clear();
    tabToSession.clear();
    childSessionToTab.clear();
    autoAttachEnabled = false;
    
    logger.info(`[Playwright] 已清理 ${sessionCount} 个 session`);
  });

  ws.on('error', (e: any) => {
    logger.error(`[Playwright] WebSocket 错误: ${e.message}`);
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
