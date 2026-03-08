/**
 * CDP Bridge 连接管理
 * 管理与 CDP Bridge Server 的 WebSocket 连接
 * 直接转发标准 CDP 消息
 */
import { type ConnectionState } from '@playwright-mvp/shared';
import { getConfig, onConfigChange } from '../storage/config-storage.js';
import { updateWhitelist, checkNavigationAllowed } from './whitelist.js';

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

/** 已附加的 Tab (tabId -> targetId) */
const attachedTabs = new Map<number, string>();

/** targetId -> tabId 的映射 */
const targetToTab = new Map<string, number>();

/** 待处理的内部请求 */
const pendingInternalRequests = new Map<number, {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}>();

/** 内部请求 ID 计数器 */
let internalRequestId = 0;

// ==================== 状态管理 ====================

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
function sendMessage(message: unknown): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

// ==================== CDP 执行相关 ====================

/**
 * 通过 chrome.debugger 执行 CDP 命令
 */
async function executeCdpCommand(
  tabId: number,
  method: string,
  params?: Record<string, unknown>
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result);
      }
    });
  });
}

/**
 * 附加到 Tab
 */
async function attachToTab(tabId: number): Promise<string> {
  if (attachedTabs.has(tabId)) {
    return attachedTabs.get(tabId)!;
  }

  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, '1.3', () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      // 使用 tabId 作为 targetId
      const targetId = String(tabId);
      attachedTabs.set(tabId, targetId);
      targetToTab.set(targetId, tabId);

      console.log('[CDP] 已附加到 Tab:', tabId, '-> targetId:', targetId);
      resolve(targetId);
    });
  });
}

/**
 * 从 Tab 分离
 */
async function detachFromTab(tabId: number): Promise<void> {
  const targetId = attachedTabs.get(tabId);
  if (!targetId) {
    return;
  }

  return new Promise((resolve) => {
    chrome.debugger.detach({ tabId }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[CDP] 分离警告:', chrome.runtime.lastError.message);
      }
      
      attachedTabs.delete(tabId);
      targetToTab.delete(targetId);
      console.log('[CDP] 已从 Tab 分离:', tabId);
      resolve();
    });
  });
}

/**
 * 分离所有 Tab
 */
async function detachAllTabs(): Promise<void> {
  const tabIds = Array.from(attachedTabs.keys());
  await Promise.all(tabIds.map((tabId) => detachFromTab(tabId)));
}

// ==================== 消息处理 ====================

/**
 * 处理来自 Bridge Server 的消息
 */
async function handleMessage(data: string): Promise<void> {
  let message: Record<string, unknown>;
  try {
    message = JSON.parse(data);
  } catch (e) {
    console.error('[RelayConnection] JSON 解析错误:', e);
    return;
  }

  const id = message.id as number | undefined;
  const action = message.action as string | undefined;
  const clientId = message.__clientId as string | undefined;
  const targetId = message.__targetId as string | undefined;

  // 处理内部请求响应（如认证）
  if (id && pendingInternalRequests.has(id)) {
    const pending = pendingInternalRequests.get(id)!;
    pendingInternalRequests.delete(id);
    
    if (message.error) {
      pending.reject(new Error((message.error as { message: string }).message));
    } else {
      pending.resolve(message.result);
    }
    return;
  }

  // 处理 Bridge Server 的控制命令
  if (action) {
    await handleControlAction(id, action, message);
    return;
  }

  // 处理 CDP 命令（来自 MCP 客户端）
  if (id && message.method) {
    await handleCdpCommand(id, message, clientId, targetId);
    return;
  }
}

/**
 * 处理控制命令（如 listTargets、newTab 等）
 */
async function handleControlAction(
  id: number | undefined,
  action: string,
  message: Record<string, unknown>
): Promise<void> {
  try {
    let result: unknown;

    switch (action) {
      case 'listTargets': {
        const tabs = await chrome.tabs.query({});
        result = tabs.map((tab) => ({
          id: String(tab.id),
          title: tab.title ?? '',
          url: tab.url ?? '',
        }));
        break;
      }

      case 'newTab': {
        const url = message.url as string || 'about:blank';
        
        // 检查白名单
        if (url !== 'about:blank') {
          const check = checkNavigationAllowed(url);
          if (!check.allowed) {
            throw new Error(check.reason);
          }
        }

        const tab = await chrome.tabs.create({ url });
        result = {
          id: String(tab.id),
          title: tab.title ?? '',
          url: tab.url ?? url,
        };
        break;
      }

      case 'activateTab': {
        const tabId = parseInt(message.targetId as string, 10);
        await chrome.tabs.update(tabId, { active: true });
        result = { success: true };
        break;
      }

      case 'closeTab': {
        const tabId = parseInt(message.targetId as string, 10);
        await chrome.tabs.remove(tabId);
        result = { success: true };
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    if (id) {
      sendMessage({ id, result });
    }
  } catch (error) {
    if (id) {
      sendMessage({
        id,
        error: { code: -32603, message: error instanceof Error ? error.message : 'Internal error' },
      });
    }
  }
}

/**
 * 处理 CDP 命令
 */
async function handleCdpCommand(
  id: number,
  message: Record<string, unknown>,
  clientId: string | undefined,
  targetId: string | undefined
): Promise<void> {
  const method = message.method as string;
  const params = message.params as Record<string, unknown> | undefined;

  try {
    // 确定目标 Tab
    let tabId: number;
    
    if (targetId && targetId !== 'browser') {
      tabId = parseInt(targetId, 10);
    } else {
      // 使用第一个已附加的 Tab，或者当前活跃 Tab
      if (attachedTabs.size > 0) {
        const firstKey = attachedTabs.keys().next().value;
        if (firstKey === undefined) {
          throw new Error('No attached tab');
        }
        tabId = firstKey;
      } else {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTab?.id) {
          throw new Error('No active tab');
        }
        tabId = activeTab.id;
      }
    }

    // 确保已附加到 Tab
    if (!attachedTabs.has(tabId)) {
      await attachToTab(tabId);
    }

    // 特殊处理：导航命令需要检查白名单
    if (method === 'Page.navigate' && params?.url) {
      const check = checkNavigationAllowed(params.url as string);
      if (!check.allowed) {
        throw new Error(check.reason);
      }
    }

    // 执行 CDP 命令
    const result = await executeCdpCommand(tabId, method, params);

    // 发送响应
    sendMessage({
      id,
      result: result ?? {},
      __clientId: clientId,
      __targetId: targetId,
    });
  } catch (error) {
    sendMessage({
      id,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : 'CDP command failed',
      },
      __clientId: clientId,
      __targetId: targetId,
    });
  }
}

/**
 * 处理 Debugger 事件
 */
function handleDebuggerEvent(
  source: chrome.debugger.Debuggee,
  method: string,
  params?: unknown
): void {
  if (!source.tabId) return;

  const targetId = attachedTabs.get(source.tabId);
  if (!targetId) return;

  // 转发 CDP 事件到 Bridge Server
  sendMessage({
    method,
    params,
    __targetId: targetId,
  });
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
        console.log('[RelayConnection] WebSocket 已连接');

        try {
          // 如果配置了 Token，发送认证
          if (config.token) {
            const authId = ++internalRequestId;
            
            const authPromise = new Promise<{ success: boolean }>((res, rej) => {
              pendingInternalRequests.set(authId, {
                resolve: res as (value: unknown) => void,
                reject: rej,
              });
              
              // 认证超时
              setTimeout(() => {
                if (pendingInternalRequests.has(authId)) {
                  pendingInternalRequests.delete(authId);
                  rej(new Error('认证超时'));
                }
              }, 10000);
            });

            sendMessage({
              id: authId,
              action: 'auth',
              token: config.token,
            });

            await authPromise;
          }

          reconnectAttempts = 0;
          setConnectionState('connected');

          // 设置 CDP 事件监听
          chrome.debugger.onEvent.addListener(handleDebuggerEvent);
          chrome.debugger.onDetach.addListener((source, reason) => {
            if (source.tabId) {
              const targetId = attachedTabs.get(source.tabId);
              if (targetId) {
                attachedTabs.delete(source.tabId);
                targetToTab.delete(targetId);
              }
              console.log('[CDP] Tab 已分离:', source.tabId, reason);
            }
          });

          resolve();
        } catch (error) {
          ws?.close();
          setConnectionState('error');
          reject(error);
        }
      };

      ws.onmessage = (event) => {
        handleMessage(event.data as string);
      };

      ws.onclose = (event) => {
        console.log('[RelayConnection] WebSocket 已关闭:', event.code, event.reason);
        handleDisconnect(config.autoReconnect);
      };

      ws.onerror = (error) => {
        console.error('[RelayConnection] WebSocket 错误:', error);
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

  // 分离所有 Tab
  await detachAllTabs();

  // 移除事件监听
  chrome.debugger.onEvent.removeListener(handleDebuggerEvent);

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
    console.log('[RelayConnection] 达到最大重连次数');
    setConnectionState('disconnected');
    return;
  }

  reconnectAttempts++;
  const delay = Math.min(config.reconnectInterval * reconnectAttempts, 30000);

  console.log(`[RelayConnection] ${delay}ms 后尝试重连 (${reconnectAttempts}/${config.maxReconnectAttempts})`);

  reconnectTimer = setTimeout(async () => {
    try {
      await connect();
    } catch (error) {
      console.error('[RelayConnection] 重连失败:', error);
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
        console.log('[RelayConnection] 配置已变化，重新连接');
        await disconnect();
        try {
          await connect();
        } catch (error) {
          console.error('[RelayConnection] 重新连接失败:', error);
        }
      }
    }
  });

  // 监听 Tab 关闭
  chrome.tabs.onRemoved.addListener((tabId) => {
    const targetId = attachedTabs.get(tabId);
    if (targetId) {
      attachedTabs.delete(tabId);
      targetToTab.delete(targetId);
    }
  });

  console.log('[RelayConnection] 连接管理器已初始化');
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
export function getAttachedTabs(): Array<{ tabId: number; targetId: string }> {
  return Array.from(attachedTabs.entries()).map(([tabId, targetId]) => ({
    tabId,
    targetId,
  }));
}
