/**
 * CDP 命令处理模块
 * 使用 chrome.debugger API 执行 CDP 命令
 */
import {
  createErrorResponse,
  createResponse,
  createNotification,
  ErrorCodes,
  Methods,
  type JsonRpcRequest,
  type CDPCommandParams,
} from '@playwright-mvp/shared';
import { checkNavigationAllowed } from './whitelist.js';

/** 已附加的 Tab 信息 */
interface AttachedTab {
  tabId: number;
  title: string;
  url: string;
}

/** 已附加的 Tab 列表 */
const attachedTabs = new Map<number, AttachedTab>();

/** CDP 事件回调 */
type CdpEventCallback = (tabId: number, method: string, params: unknown) => void;

/** 事件回调列表 */
let cdpEventCallback: CdpEventCallback | null = null;

/**
 * 设置 CDP 事件回调
 */
export function setCdpEventCallback(callback: CdpEventCallback | null): void {
  cdpEventCallback = callback;
}

/**
 * CDP 事件处理器
 */
function handleDebuggerEvent(
  source: chrome.debugger.Debuggee,
  method: string,
  params?: unknown
): void {
  if (source.tabId && cdpEventCallback) {
    cdpEventCallback(source.tabId, method, params);
  }
}

/**
 * 附加到 Tab
 */
export async function attachToTab(tabId: number): Promise<AttachedTab> {
  // 检查是否已附加
  if (attachedTabs.has(tabId)) {
    return attachedTabs.get(tabId)!;
  }
  
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, '1.3', () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      
      // 获取 Tab 信息
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        
        const attachedTab: AttachedTab = {
          tabId,
          title: tab.title ?? '',
          url: tab.url ?? '',
        };
        
        attachedTabs.set(tabId, attachedTab);
        console.log('[CDP] 已附加到 Tab:', tabId);
        resolve(attachedTab);
      });
    });
  });
}

/**
 * 从 Tab 分离
 */
export async function detachFromTab(tabId: number): Promise<void> {
  if (!attachedTabs.has(tabId)) {
    return;
  }
  
  return new Promise((resolve, reject) => {
    chrome.debugger.detach({ tabId }, () => {
      if (chrome.runtime.lastError) {
        // 忽略 "not attached" 错误
        if (!chrome.runtime.lastError.message?.includes('not attached')) {
          console.warn('[CDP] 分离错误:', chrome.runtime.lastError.message);
        }
      }
      
      attachedTabs.delete(tabId);
      console.log('[CDP] 已从 Tab 分离:', tabId);
      resolve();
    });
  });
}

/**
 * 分离所有 Tab
 */
export async function detachAllTabs(): Promise<void> {
  const tabIds = Array.from(attachedTabs.keys());
  await Promise.all(tabIds.map((tabId) => detachFromTab(tabId)));
}

/**
 * 获取已附加的 Tab 列表
 */
export function getAttachedTabs(): AttachedTab[] {
  return Array.from(attachedTabs.values());
}

/**
 * 检查 Tab 是否已附加
 */
export function isTabAttached(tabId: number): boolean {
  return attachedTabs.has(tabId);
}

/**
 * 执行 CDP 命令
 */
export async function executeCdpCommand(
  tabId: number,
  method: string,
  params?: Record<string, unknown>
): Promise<unknown> {
  // 检查 Tab 是否已附加
  if (!attachedTabs.has(tabId)) {
    throw new Error(`Tab ${tabId} 未附加`);
  }
  
  // 如果是导航命令，检查白名单
  if (method === 'Page.navigate' && params?.url) {
    const check = checkNavigationAllowed(params.url as string);
    if (!check.allowed) {
      throw new Error(check.reason);
    }
  }
  
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
 * 处理来自中转服务的 CDP 命令请求
 */
export async function handleCdpRequest(
  request: JsonRpcRequest<CDPCommandParams>
): Promise<unknown> {
  const params = request.params;
  
  if (!params) {
    throw new Error('缺少 CDP 命令参数');
  }
  
  const { method, params: cdpParams, tabId } = params;
  
  // 如果没有指定 tabId，使用第一个已附加的 Tab
  let targetTabId = tabId;
  if (!targetTabId) {
    const tabs = getAttachedTabs();
    if (tabs.length === 0) {
      throw new Error('没有已附加的 Tab');
    }
    targetTabId = tabs[0].tabId;
  }
  
  return executeCdpCommand(targetTabId, method, cdpParams);
}

/**
 * 初始化 CDP 处理器
 */
export function initCdpHandler(): void {
  // 监听 debugger 事件
  chrome.debugger.onEvent.addListener(handleDebuggerEvent);
  
  // 监听 debugger 分离事件
  chrome.debugger.onDetach.addListener((source, reason) => {
    if (source.tabId) {
      attachedTabs.delete(source.tabId);
      console.log('[CDP] Tab 已分离:', source.tabId, reason);
    }
  });
  
  // 监听 Tab 关闭事件
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (attachedTabs.has(tabId)) {
      attachedTabs.delete(tabId);
      console.log('[CDP] Tab 已关闭:', tabId);
    }
  });
  
  console.log('[CDP] CDP 处理器已初始化');
}
