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
 */
console.log('[RelayConnection] 模块加载 - 版本 2026-03-08-v3');

import { type ConnectionState } from '@playwright-mvp/shared';
import { getConfig, onConfigChange } from '../storage/config-storage.js';
import { updateWhitelist, checkNavigationAllowed } from './whitelist.js';

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

// ==================== 辅助函数 ====================

function debugLog(...args: unknown[]): void {
  console.log('[RelayConnection]', ...args);
}

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
    debugLog('发送消息:', msgStr.substring(0, 200));
    ws.send(msgStr);
  } else {
    debugLog('WebSocket 未连接，无法发送消息');
  }
}

// ==================== 协议命令处理 ====================

/**
 * 处理 attachToTab 命令
 */
async function handleAttachToTab(tabId: number): Promise<any> {
  debugLog('附加到 Tab:', tabId);
  
  if (attachedTabs.has(tabId)) {
    debugLog('Tab 已附加，返回缓存的 targetInfo');
    return { targetInfo: attachedTabs.get(tabId) };
  }

  const debuggee: chrome.debugger.Debuggee = { tabId };
  
  // 附加 debugger
  await new Promise<void>((resolve, reject) => {
    chrome.debugger.attach(debuggee, '1.3', () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });

  // 获取 target 信息
  const result = await new Promise<any>((resolve, reject) => {
    chrome.debugger.sendCommand(debuggee, 'Target.getTargetInfo', undefined, (res) => {
      if (chrome.runtime.lastError) {
        // 某些情况下可能没有 targetInfo，构造一个
        resolve(null);
      } else {
        resolve(res);
      }
    });
  });

  // 获取 Tab 信息作为备用
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
  debugLog('已附加到 Tab:', tabId, targetInfo);

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
  debugLog('CDP 命令:', method, 'Tab:', tabId, 'sessionId:', sessionId);

  if (!attachedTabs.has(tabId)) {
    throw new Error(`Tab ${tabId} 未附加`);
  }

  // 特殊处理：导航命令需要检查白名单
  if (method === 'Page.navigate' && params?.url) {
    const check = checkNavigationAllowed(params.url as string);
    if (!check.allowed) {
      throw new Error(check.reason);
    }
  }

  const debuggerSession: chrome.debugger.Debuggee = {
    tabId,
  };

  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(debuggerSession, method, params, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
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
  let message: ProtocolCommand;
  
  try {
    message = JSON.parse(data);
  } catch (error: any) {
    debugLog('JSON 解析错误:', error);
    sendMessage({ error: `JSON 解析错误: ${error.message}` });
    return;
  }

  debugLog('收到消息:', message);

  const response: ProtocolResponse = {
    id: message.id,
  };

  try {
    response.result = await handleCommand(message);
  } catch (error: any) {
    debugLog('命令执行错误:', error);
    response.error = error.message;
  }

  debugLog('发送响应:', response);
  sendMessage(response);
}

// ==================== Debugger 事件处理 ====================

/**
 * 设置 Debugger 事件监听
 */
function setupDebuggerListeners(): void {
  // CDP 事件转发
  debuggerEventListener = (source: chrome.debugger.Debuggee, method: string, params: any) => {
    const tabId = source.tabId;
    if (!tabId || !attachedTabs.has(tabId)) return;

    debugLog('转发 CDP 事件:', method, 'Tab:', tabId);
    
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
    if (!tabId || !attachedTabs.has(tabId)) return;

    debugLog(`Debugger 从 Tab ${tabId} 分离: ${reason}`);
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
  if (connectionState === 'connected' || connectionState === 'connecting') {
    return;
  }

  const config = await getConfig();

  if (!config.relayServerUrl) {
    throw new Error('未配置服务器地址');
  }

  // 构建 Extension WebSocket 端点
  let wsUrl = config.relayServerUrl;
  if (!wsUrl.endsWith('/extension')) {
    wsUrl = wsUrl.replace(/\/$/, '') + '/extension';
  }

  setConnectionState('connecting');

  return new Promise((resolve, reject) => {
    try {
      ws = new WebSocket(wsUrl);

      ws.onopen = async () => {
        debugLog('WebSocket 已连接');

        try {
          // 如果配置了 Token，发送认证
          if (config.token) {
            debugLog('发送认证...');
            
            const authPromise = new Promise<void>((res, rej) => {
              const currentWs = ws!;
            const authHandler = (event: MessageEvent) => {
                try {
                  const response = JSON.parse(event.data);
                  if (response.result?.success) {
                    currentWs.removeEventListener('message', authHandler);
                    res();
                  } else if (response.error) {
                    currentWs.removeEventListener('message', authHandler);
                    rej(new Error(response.error));
                  }
                } catch (e) {
                  // 忽略解析错误，等待正确的响应
                }
              };
              
              currentWs.addEventListener('message', authHandler);
              
              // 认证超时
              setTimeout(() => {
                currentWs.removeEventListener('message', authHandler);
                rej(new Error('认证超时'));
              }, 10000);
            });

            ws!.send(JSON.stringify({
              id: 1,
              action: 'auth',
              token: config.token,
            }));

            await authPromise;
            debugLog('认证成功');
          }

          reconnectAttempts = 0;
          setConnectionState('connected');

          // 设置 Debugger 事件监听
          setupDebuggerListeners();

          // 设置正常消息处理
          const currentWs2 = ws!;
          currentWs2.onmessage = (event) => {
            debugLog('收到消息, 长度:', (event.data as string).length);
            handleMessage(event.data as string);
          };

          resolve();
        } catch (error) {
          ws?.close();
          setConnectionState('error');
          reject(error);
        }
      };

      ws.onclose = (event) => {
        debugLog('WebSocket 已关闭:', event.code, event.reason);
        handleDisconnect(config.autoReconnect);
      };

      ws.onerror = (error) => {
        debugLog('WebSocket 错误:', error);
        if (connectionState === 'connecting') {
          setConnectionState('error');
          reject(new Error('连接失败'));
        }
      };
    } catch (error) {
      setConnectionState('error');
      reject(error);
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
  // 监听配置变化
  onConfigChange(async (oldConfig, newConfig) => {
    // 更新白名单
    if (JSON.stringify(oldConfig.whitelist) !== JSON.stringify(newConfig.whitelist)) {
      updateWhitelist(newConfig.whitelist);
    }

    // 如果服务器地址或 Token 变化，需要重新连接
    if (
      oldConfig.relayServerUrl !== newConfig.relayServerUrl ||
      oldConfig.token !== newConfig.token
    ) {
      if (connectionState === 'connected') {
        debugLog('配置已变化，重新连接');
        await disconnect();
        try {
          await connect();
        } catch (error) {
          debugLog('重新连接失败:', error);
        }
      }
    }
  });

  // 监听 Tab 关闭
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (attachedTabs.has(tabId)) {
      attachedTabs.delete(tabId);
    }
  });

  debugLog('连接管理器已初始化');
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
