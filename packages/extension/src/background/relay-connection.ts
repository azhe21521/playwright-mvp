/**
 * CDP Bridge 连接管理
 * 
 * 与 Bridge Server 使用自定义协议通信：
 *   - attachToTab: 附加到标签页
 *   - detachFromTab: 从标签页分离
 *   - forwardCDPCommand: 转发 CDP 命令
 *   - listTabs: 列出可用标签页
 *   - closeTab: 关闭标签页
 * 
 * 事件：
 *   - forwardCDPEvent: 转发 CDP 事件
 *   - tabDetached: 标签页分离通知
 * 
 * 日志系统：
 *   LOG_LEVEL 环境变量控制日志级别（但在扩展中无法使用环境变量）
 *   可以通过 localStorage.setItem('LOG_LEVEL', 'trace') 来控制
 */
const VERSION = '2026-03-09-v4-debug';
console.log(`[RelayConnection] 模块加载 - 版本 ${VERSION}`);

import { type ConnectionState } from '@playwright-mvp/shared';
import { getConfig, onConfigChange } from '../storage/config-storage.js';
import { updateWhitelist, checkNavigationAllowed } from './whitelist.js';

// ==================== 日志系统 ====================

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

// 从 localStorage 获取日志级别，默认 debug
function getLogLevel(): LogLevel {
  try {
    const level = localStorage.getItem('LOG_LEVEL')?.toLowerCase() as LogLevel;
    if (level && level in LOG_LEVELS) return level;
  } catch {
    // 忽略
  }
  return 'debug'; // 扩展默认使用 debug 级别
}

let currentLogLevel = getLogLevel();

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLogLevel];
}

function formatTime(): string {
  return new Date().toISOString().replace('T', ' ').substring(11, 23);
}

function trace(...args: unknown[]): void {
  if (shouldLog('trace')) {
    console.log(`[${formatTime()}] [TRACE] [RelayConnection]`, ...args);
  }
}

function debugLog(...args: unknown[]): void {
  if (shouldLog('debug')) {
    console.log(`[${formatTime()}] [DEBUG] [RelayConnection]`, ...args);
  }
}

function info(...args: unknown[]): void {
  if (shouldLog('info')) {
    console.info(`[${formatTime()}] [INFO ] [RelayConnection]`, ...args);
  }
}

function warn(...args: unknown[]): void {
  if (shouldLog('warn')) {
    console.warn(`[${formatTime()}] [WARN ] [RelayConnection]`, ...args);
  }
}

function error(...args: unknown[]): void {
  if (shouldLog('error')) {
    console.error(`[${formatTime()}] [ERROR] [RelayConnection]`, ...args);
  }
}

// 设置日志级别
function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
  localStorage.setItem('LOG_LEVEL', level);
  info(`日志级别已设置为: ${level}`);
}

// 暴露到全局供调试使用
(globalThis as any).RelayConnectionDebug = {
  setLogLevel,
  getLogLevel: () => currentLogLevel,
  getState: () => ({
    connectionState,
    attachedTabs: Array.from(attachedTabs.entries()),
    reconnectAttempts,
  }),
};

// ==================== 类型定义 ====================

type ProtocolCommand = {
  id: number;
  method: string;
  params?: any;
};

type ProtocolResponse = {
  id?: number;
  method?: string;
  params?: any;
  result?: any;
  error?: string;
};

// ==================== 状态管理 ====================

/** 连接状态 */
let connectionState: ConnectionState = 'disconnected';

/** WebSocket 实例 */
let ws: WebSocket | null = null;

/** 重连定时器 */
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

/** 重连次数 */
let reconnectAttempts = 0;

/** 状态变化回调 */
type StateChangeCallback = (state: ConnectionState) => void;
let stateChangeCallbacks: StateChangeCallback[] = [];

/** 已附加的 Tab (tabId -> targetInfo) */
const attachedTabs = new Map<number, any>();

/** Debugger 事件监听器 */
let debuggerEventListener: ((source: chrome.debugger.Debuggee, method: string, params: any) => void) | null = null;
let debuggerDetachListener: ((source: chrome.debugger.Debuggee, reason: string) => void) | null = null;

/** 消息统计 */
let messagesSent = 0;
let messagesReceived = 0;
let cdpCommandsForwarded = 0;
let cdpEventsForwarded = 0;

/**
 * 获取当前连接状态
 */
export function getConnectionState(): ConnectionState {
  return connectionState;
}

/**
 * 注册状态变化回调
 */
export function onStateChange(callback: StateChangeCallback): () => void {
  stateChangeCallbacks.push(callback);
  return () => {
    stateChangeCallbacks = stateChangeCallbacks.filter((cb) => cb !== callback);
  };
}

/**
 * 更新连接状态
 */
function setConnectionState(state: ConnectionState): void {
  if (connectionState !== state) {
    connectionState = state;
    stateChangeCallbacks.forEach((cb) => cb(state));
  }
}

/**
 * 发送消息到 Bridge Server
 */
function sendMessage(message: ProtocolResponse): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    const msgStr = JSON.stringify(message);
    messagesSent++;
    
    // 根据消息类型选择日志级别
    const isEvent = message.method && !message.id;
    if (isEvent) {
      trace(`→ Bridge [${messagesSent}]: Event ${message.method}`);
    } else {
      debugLog(`→ Bridge [${messagesSent}]: Response id=${message.id}, len=${msgStr.length}`);
    }
    trace(`[sendMessage] 完整内容: ${msgStr.substring(0, 500)}`);
    
    ws.send(msgStr);
  } else {
    const state = ws ? `readyState=${ws.readyState}` : 'ws=null';
    warn(`[sendMessage] WebSocket 未就绪 (${state})，丢弃消息:`, message.id || message.method);
  }
}

// ==================== 协议命令处理 ====================

/**
 * 处理 attachToTab 命令
 */
async function handleAttachToTab(tabId: number): Promise<any> {
  info(`[attachToTab] 开始附加到 Tab ${tabId}`);
  const startTime = Date.now();
  
  if (attachedTabs.has(tabId)) {
    const cached = attachedTabs.get(tabId);
    debugLog(`[attachToTab] Tab ${tabId} 已附加，返回缓存的 targetInfo`);
    debugLog(`[attachToTab] 缓存内容:`, JSON.stringify(cached));
    return { targetInfo: cached };
  }

  const debuggee: chrome.debugger.Debuggee = { tabId };
  
  // 附加 debugger
  debugLog(`[attachToTab] 调用 chrome.debugger.attach, tabId=${tabId}`);
  await new Promise<void>((resolve, reject) => {
    chrome.debugger.attach(debuggee, '1.3', () => {
      if (chrome.runtime.lastError) {
        const errMsg = chrome.runtime.lastError.message;
        error(`[attachToTab] chrome.debugger.attach 失败: ${errMsg}`);
        reject(new Error(errMsg));
      } else {
        debugLog(`[attachToTab] chrome.debugger.attach 成功`);
        resolve();
      }
    });
  });

  // 获取 target 信息
  debugLog(`[attachToTab] 获取 Target.getTargetInfo`);
  const result = await new Promise<any>((resolve, reject) => {
    chrome.debugger.sendCommand(debuggee, 'Target.getTargetInfo', undefined, (res) => {
      if (chrome.runtime.lastError) {
        // 某些情况下可能没有 targetInfo，构造一个
        debugLog(`[attachToTab] Target.getTargetInfo 无结果: ${chrome.runtime.lastError.message}`);
        resolve(null);
      } else {
        debugLog(`[attachToTab] Target.getTargetInfo 成功:`, JSON.stringify(res));
        resolve(res);
      }
    });
  });

  // 获取 Tab 信息作为备用
  debugLog(`[attachToTab] 获取 Tab 信息`);
  const tab = await chrome.tabs.get(tabId);
  
  const targetInfo = result?.targetInfo || {
    targetId: String(tabId),
    type: 'page',
    title: tab.title || '',
    url: tab.url || '',
    attached: true,
    browserContextId: '1',
  };

  attachedTabs.set(tabId, targetInfo);
  
  const elapsed = Date.now() - startTime;
  info(`✅ [attachToTab] 已附加到 Tab ${tabId}，耗时 ${elapsed}ms`);
  debugLog(`[attachToTab] targetInfo:`, JSON.stringify(targetInfo));

  return { targetInfo };
}

/**
 * 处理 detachFromTab 命令
 */
async function handleDetachFromTab(tabId: number): Promise<any> {
  debugLog('从 Tab 分离:', tabId);
  
  if (!attachedTabs.has(tabId)) {
    return {};
  }

  await new Promise<void>((resolve) => {
    chrome.debugger.detach({ tabId }, () => {
      if (chrome.runtime.lastError) {
        debugLog('分离警告:', chrome.runtime.lastError.message);
      }
      resolve();
    });
  });

  attachedTabs.delete(tabId);
  debugLog('已从 Tab 分离:', tabId);
  
  return {};
}

/**
 * 处理 listTabs 命令
 */
async function handleListTabs(): Promise<any> {
  const tabs = await chrome.tabs.query({});
  
  // 过滤掉 chrome:// 等内部页面
  const filteredTabs = tabs.filter(tab =>
    tab.url && !['chrome:', 'edge:', 'devtools:', 'chrome-extension:'].some(
      scheme => tab.url!.startsWith(scheme)
    )
  );

  return {
    tabs: filteredTabs.map(tab => ({
      id: tab.id!,
      title: tab.title || 'Untitled',
      url: tab.url!,
      favIconUrl: tab.favIconUrl,
      windowId: tab.windowId,
    })),
  };
}

/**
 * 处理 closeTab 命令
 */
async function handleCloseTab(tabId: number): Promise<any> {
  debugLog('关闭 Tab:', tabId);
  await chrome.tabs.remove(tabId);
  return { success: true };
}

/**
 * 处理 forwardCDPCommand 命令
 */
async function handleForwardCDPCommand(
  tabId: number,
  sessionId: string | undefined,
  method: string,
  params: any
): Promise<any> {
  cdpCommandsForwarded++;
  const startTime = Date.now();
  
  // 高频命令使用 trace 级别
  const isFrequent = ['Runtime.evaluate', 'DOM.getDocument', 'DOM.querySelector', 'DOM.describeNode'].includes(method);
  if (isFrequent) {
    trace(`[CDP ${cdpCommandsForwarded}] ${method}, Tab=${tabId}, sessionId=${sessionId || 'none'}`);
  } else {
    debugLog(`[CDP ${cdpCommandsForwarded}] ${method}, Tab=${tabId}, sessionId=${sessionId || 'none'}`);
  }
  trace(`[CDP ${cdpCommandsForwarded}] params:`, JSON.stringify(params || {}).substring(0, 300));

  if (!attachedTabs.has(tabId)) {
    error(`[CDP] Tab ${tabId} 未附加，无法执行 ${method}`);
    debugLog(`[CDP] 当前已附加的 Tabs: ${Array.from(attachedTabs.keys()).join(', ')}`);
    throw new Error(`Tab ${tabId} 未附加`);
  }

  // 特殊处理：导航命令需要检查白名单
  if (method === 'Page.navigate' && params?.url) {
    info(`[CDP] 检查导航白名单: ${params.url}`);
    const check = checkNavigationAllowed(params.url as string);
    if (!check.allowed) {
      warn(`[CDP] 导航被白名单阻止: ${check.reason}`);
      throw new Error(check.reason);
    }
    info(`[CDP] 导航白名单检查通过`);
  }

  const debuggerSession: chrome.debugger.Debuggee = {
    tabId,
  };

  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(debuggerSession, method, params, (result) => {
      const elapsed = Date.now() - startTime;
      
      if (chrome.runtime.lastError) {
        const errMsg = chrome.runtime.lastError.message || 'Unknown error';
        if (isFrequent) {
          trace(`[CDP ${cdpCommandsForwarded}] ${method} 失败 (${elapsed}ms): ${errMsg}`);
        } else {
          warn(`[CDP ${cdpCommandsForwarded}] ${method} 失败 (${elapsed}ms): ${errMsg}`);
        }
        reject(new Error(errMsg));
      } else {
        if (isFrequent) {
          trace(`[CDP ${cdpCommandsForwarded}] ${method} 成功 (${elapsed}ms)`);
        } else {
          debugLog(`[CDP ${cdpCommandsForwarded}] ${method} 成功 (${elapsed}ms)`);
        }
        trace(`[CDP ${cdpCommandsForwarded}] result:`, JSON.stringify(result || {}).substring(0, 300));
        resolve(result);
      }
    });
  });
}

/**
 * 处理协议命令
 */
async function handleCommand(message: ProtocolCommand): Promise<any> {
  const { method, params } = message;

  switch (method) {
    case 'attachToTab':
      return handleAttachToTab(params?.tabId);

    case 'detachFromTab':
      return handleDetachFromTab(params?.tabId);

    case 'listTabs':
      return handleListTabs();

    case 'closeTab':
      return handleCloseTab(params?.tabId);

    case 'forwardCDPCommand':
      return handleForwardCDPCommand(
        params?.tabId,
        params?.sessionId,
        params?.method,
        params?.params
      );

    default:
      throw new Error(`未知命令: ${method}`);
  }
}

// ==================== 消息处理 ====================

/**
 * 处理来自 Bridge Server 的消息
 */
async function handleMessage(data: string): Promise<void> {
  messagesReceived++;
  const startTime = Date.now();
  
  let message: ProtocolCommand;
  
  try {
    message = JSON.parse(data);
  } catch (parseError: any) {
    error(`[handleMessage] JSON 解析错误: ${parseError.message}`);
    debugLog(`[handleMessage] 原始数据: ${data.substring(0, 200)}`);
    sendMessage({ error: `JSON 解析错误: ${parseError.message}` });
    return;
  }

  debugLog(`← Bridge [${messagesReceived}]: ${message.method} (id=${message.id})`);
  trace(`[handleMessage] 完整消息:`, JSON.stringify(message).substring(0, 500));

  const response: ProtocolResponse = {
    id: message.id,
  };

  try {
    response.result = await handleCommand(message);
    const elapsed = Date.now() - startTime;
    debugLog(`[handleMessage] ${message.method} (id=${message.id}) 完成，耗时 ${elapsed}ms`);
  } catch (cmdError: any) {
    const elapsed = Date.now() - startTime;
    error(`[handleMessage] ${message.method} (id=${message.id}) 失败，耗时 ${elapsed}ms: ${cmdError.message}`);
    response.error = cmdError.message;
  }

  trace(`[handleMessage] 发送响应:`, JSON.stringify(response).substring(0, 300));
  sendMessage(response);
}

// ==================== Debugger 事件处理 ====================

/**
 * 设置 Debugger 事件监听
 */
function setupDebuggerListeners(): void {
  info('[Debugger] 设置事件监听器');
  
  // CDP 事件转发
  debuggerEventListener = (source: chrome.debugger.Debuggee, method: string, params: any) => {
    const tabId = source.tabId;
    if (!tabId || !attachedTabs.has(tabId)) {
      trace(`[Debugger Event] 忽略事件 ${method}，Tab ${tabId} 未跟踪`);
      return;
    }

    cdpEventsForwarded++;
    
    // 高频事件使用 trace 级别
    const isHighFreq = ['Network.', 'Runtime.consoleAPICalled', 'Log.entryAdded', 'Page.lifecycleEvent'].some(
      prefix => method.startsWith(prefix)
    );
    
    if (isHighFreq) {
      trace(`[Debugger Event ${cdpEventsForwarded}] ${method}, Tab=${tabId}`);
    } else {
      debugLog(`[Debugger Event ${cdpEventsForwarded}] ${method}, Tab=${tabId}`);
    }
    
    sendMessage({
      method: 'forwardCDPEvent',
      params: {
        tabId,
        sessionId: undefined, // chrome.debugger.Debuggee 没有 sessionId
        method,
        params,
      },
    });
  };

  // Debugger 分离事件
  debuggerDetachListener = (source: chrome.debugger.Debuggee, reason: string) => {
    const tabId = source.tabId;
    if (!tabId) {
      warn(`[Debugger Detach] 收到无 tabId 的分离事件`);
      return;
    }
    
    if (!attachedTabs.has(tabId)) {
      debugLog(`[Debugger Detach] Tab ${tabId} 未在跟踪列表中`);
      return;
    }

    info(`⚡ [Debugger Detach] Tab ${tabId} 已分离: ${reason}`);
    attachedTabs.delete(tabId);

    sendMessage({
      method: 'tabDetached',
      params: {
        tabId,
        reason,
      },
    });
  };

  chrome.debugger.onEvent.addListener(debuggerEventListener);
  chrome.debugger.onDetach.addListener(debuggerDetachListener);
  
  info('[Debugger] 事件监听器已设置');
}

/**
 * 移除 Debugger 事件监听
 */
function removeDebuggerListeners(): void {
  if (debuggerEventListener) {
    chrome.debugger.onEvent.removeListener(debuggerEventListener);
    debuggerEventListener = null;
  }
  if (debuggerDetachListener) {
    chrome.debugger.onDetach.removeListener(debuggerDetachListener);
    debuggerDetachListener = null;
  }
}

/**
 * 分离所有已附加的 Tab
 */
async function detachAllTabs(): Promise<void> {
  const tabIds = Array.from(attachedTabs.keys());
  
  for (const tabId of tabIds) {
    try {
      await new Promise<void>((resolve) => {
        chrome.debugger.detach({ tabId }, () => {
          if (chrome.runtime.lastError) {
            debugLog('分离 Tab 警告:', tabId, chrome.runtime.lastError.message);
          }
          resolve();
        });
      });
    } catch (e) {
      debugLog('分离 Tab 错误:', tabId, e);
    }
  }
  
  attachedTabs.clear();
}

// ==================== 连接管理 ====================

/**
 * 连接到 CDP Bridge Server
 */
export async function connect(): Promise<void> {
  info('========================================');
  info('🔌 开始连接到 CDP Bridge Server');
  info('========================================');
  
  if (connectionState === 'connected' || connectionState === 'connecting') {
    warn(`[connect] 已在连接中或已连接，当前状态: ${connectionState}`);
    return;
  }

  const config = await getConfig();
  debugLog('[connect] 配置:', {
    relayServerUrl: config.relayServerUrl,
    hasToken: !!config.token,
    autoReconnect: config.autoReconnect,
  });

  if (!config.relayServerUrl) {
    error('[connect] 未配置服务器地址');
    throw new Error('未配置服务器地址');
  }

  // 构建 Extension WebSocket 端点
  let wsUrl = config.relayServerUrl;
  if (!wsUrl.endsWith('/extension')) {
    wsUrl = wsUrl.replace(/\/$/, '') + '/extension';
  }

  info(`[connect] 目标地址: ${wsUrl}`);
  setConnectionState('connecting');

  // 重置统计
  messagesSent = 0;
  messagesReceived = 0;
  cdpCommandsForwarded = 0;
  cdpEventsForwarded = 0;

  return new Promise((resolve, reject) => {
    try {
      debugLog('[connect] 创建 WebSocket 连接...');
      ws = new WebSocket(wsUrl);

      ws.onopen = async () => {
        info('✅ WebSocket 连接已建立');

        try {
          // 如果配置了 Token，发送认证
          if (config.token) {
            info('[connect] 开始 Token 认证...');
            
            const authPromise = new Promise<void>((res, rej) => {
              const currentWs = ws!;
              const authHandler = (event: MessageEvent) => {
                try {
                  const response = JSON.parse(event.data);
                  debugLog('[connect] 收到认证响应:', JSON.stringify(response));
                  
                  if (response.result?.success) {
                    currentWs.removeEventListener('message', authHandler);
                    info('✅ Token 认证成功');
                    res();
                  } else if (response.error) {
                    currentWs.removeEventListener('message', authHandler);
                    error(`[connect] 认证失败: ${response.error}`);
                    rej(new Error(response.error));
                  }
                } catch (e) {
                  // 忽略解析错误，等待正确的响应
                  trace('[connect] 忽略非认证响应');
                }
              };
              
              currentWs.addEventListener('message', authHandler);
              
              // 认证超时
              setTimeout(() => {
                currentWs.removeEventListener('message', authHandler);
                error('[connect] 认证超时（10秒）');
                rej(new Error('认证超时'));
              }, 10000);
            });

            const authMsg = {
              id: 1,
              action: 'auth',
              token: config.token,
            };
            debugLog('[connect] 发送认证消息');
            ws!.send(JSON.stringify(authMsg));

            await authPromise;
          } else {
            info('[connect] 无需 Token 认证');
          }

          reconnectAttempts = 0;
          setConnectionState('connected');

          // 设置 Debugger 事件监听
          setupDebuggerListeners();

          // 设置正常消息处理
          const currentWs2 = ws!;
          currentWs2.onmessage = (event) => {
            const dataLen = (event.data as string).length;
            trace(`[WebSocket] 收到消息, 长度: ${dataLen}`);
            handleMessage(event.data as string);
          };

          info('========================================');
          info('✅ 连接完成，等待 Bridge 命令');
          info('========================================');
          
          resolve();
        } catch (connectError: any) {
          error(`[connect] 连接过程中出错: ${connectError.message}`);
          ws?.close();
          setConnectionState('error');
          reject(connectError);
        }
      };

      ws.onclose = (event) => {
        info('========================================');
        info(`⚡ WebSocket 连接已关闭`);
        info(`   关闭码: ${event.code}`);
        info(`   原因: ${event.reason || 'none'}`);
        info(`   统计: 发送 ${messagesSent}, 接收 ${messagesReceived}`);
        info(`         CDP命令 ${cdpCommandsForwarded}, CDP事件 ${cdpEventsForwarded}`);
        info('========================================');
        handleDisconnect(config.autoReconnect);
      };

      ws.onerror = (wsError) => {
        error('[connect] WebSocket 错误:', wsError);
        if (connectionState === 'connecting') {
          setConnectionState('error');
          reject(new Error('连接失败'));
        }
      };
    } catch (createError: any) {
      error(`[connect] 创建 WebSocket 失败: ${createError.message}`);
      setConnectionState('error');
      reject(createError);
    }
  });
}

/**
 * 断开连接
 */
export async function disconnect(): Promise<void> {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  // 移除事件监听
  removeDebuggerListeners();

  // 分离所有 Tab
  await detachAllTabs();

  if (ws) {
    ws.close();
    ws = null;
  }

  reconnectAttempts = 0;
  setConnectionState('disconnected');
}

/**
 * 处理断开连接
 */
async function handleDisconnect(autoReconnect: boolean): Promise<void> {
  ws = null;

  // 移除事件监听
  removeDebuggerListeners();

  // 清理已附加的 Tab（不主动分离，因为连接已断开）
  attachedTabs.clear();

  if (autoReconnect && connectionState !== 'disconnected') {
    setConnectionState('error');
    scheduleReconnect();
  } else {
    setConnectionState('disconnected');
  }
}

/**
 * 计划重连
 */
async function scheduleReconnect(): Promise<void> {
  const config = await getConfig();

  if (reconnectAttempts >= config.maxReconnectAttempts) {
    debugLog('达到最大重连次数');
    setConnectionState('disconnected');
    return;
  }

  reconnectAttempts++;
  const delay = Math.min(config.reconnectInterval * reconnectAttempts, 30000);

  debugLog(`${delay}ms 后尝试重连 (${reconnectAttempts}/${config.maxReconnectAttempts})`);

  reconnectTimer = setTimeout(async () => {
    try {
      await connect();
    } catch (error) {
      debugLog('重连失败:', error);
    }
  }, delay);
}

/**
 * 初始化连接管理器
 */
export function initRelayConnection(): void {
  info('========================================');
  info('🚀 初始化连接管理器');
  info(`   版本: ${VERSION}`);
  info(`   日志级别: ${currentLogLevel}`);
  info('========================================');
  
  // 监听配置变化
  onConfigChange(async (oldConfig, newConfig) => {
    debugLog('[ConfigChange] 检测到配置变化');
    
    // 更新白名单
    if (JSON.stringify(oldConfig.whitelist) !== JSON.stringify(newConfig.whitelist)) {
      info('[ConfigChange] 白名单已更新');
      updateWhitelist(newConfig.whitelist);
    }

    // 如果服务器地址或 Token 变化，需要重新连接
    if (
      oldConfig.relayServerUrl !== newConfig.relayServerUrl ||
      oldConfig.token !== newConfig.token
    ) {
      info('[ConfigChange] 服务器地址或 Token 变化，需要重新连接');
      debugLog(`[ConfigChange] URL: ${oldConfig.relayServerUrl} → ${newConfig.relayServerUrl}`);
      debugLog(`[ConfigChange] Token: ${oldConfig.token ? '有' : '无'} → ${newConfig.token ? '有' : '无'}`);
      
      if (connectionState === 'connected') {
        info('[ConfigChange] 断开旧连接...');
        await disconnect();
        try {
          info('[ConfigChange] 尝试重新连接...');
          await connect();
          info('[ConfigChange] 重新连接成功');
        } catch (reconnectError: any) {
          error(`[ConfigChange] 重新连接失败: ${reconnectError.message}`);
        }
      }
    }
  });

  // 监听 Tab 关闭
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (attachedTabs.has(tabId)) {
      info(`[TabRemoved] Tab ${tabId} 已关闭，从跟踪列表移除`);
      attachedTabs.delete(tabId);
    }
  });

  info('[初始化] 连接管理器已初始化');
  info('[初始化] 调试命令: RelayConnectionDebug.setLogLevel("trace")');
  info('[初始化] 调试命令: RelayConnectionDebug.getState()');
}

/**
 * 获取连接状态信息
 */
export function getConnectionInfo() {
  return {
    state: connectionState,
    attachedTabs: attachedTabs.size,
    reconnectAttempts,
  };
}

/**
 * 获取已附加的 Tab 列表
 */
export function getAttachedTabs(): Array<{ tabId: number; targetInfo: any }> {
  return Array.from(attachedTabs.entries()).map(([tabId, targetInfo]) => ({
    tabId,
    targetInfo,
  }));
}
