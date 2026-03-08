/**
 * 扩展内部类型定义
 */
import type { ConnectionState, ExtensionConfig } from '@playwright-mvp/shared';

/** 扩展运行时状态 */
export interface ExtensionState {
  /** 连接状态 */
  connectionState: ConnectionState;
  /** 已连接的服务器地址 */
  serverUrl: string;
  /** 会话 ID */
  sessionId: string | null;
  /** 最后连接时间 */
  lastConnectedAt: number | null;
  /** 最后错误信息 */
  lastError: string | null;
  /** 重连次数 */
  reconnectAttempts: number;
  /** 已附加的 Tab */
  attachedTabs: Map<number, AttachedTabInfo>;
}

/** 已附加的 Tab 信息 */
export interface AttachedTabInfo {
  tabId: number;
  title: string;
  url: string;
  attachedAt: number;
}

/** 存储在 chrome.storage 中的配置 */
export interface StoredConfig extends ExtensionConfig {
  /** 上次使用时间 */
  lastUsed?: number;
}

/** 消息类型（扩展内部通信） */
export type ExtensionMessageType =
  | 'GET_STATE'
  | 'GET_CONFIG'
  | 'SET_CONFIG'
  | 'CONNECT'
  | 'DISCONNECT'
  | 'GET_TABS'
  | 'ATTACH_TAB'
  | 'DETACH_TAB';

/** 扩展内部消息 */
export interface ExtensionMessage {
  type: ExtensionMessageType;
  payload?: unknown;
}

/** 扩展内部消息响应 */
export interface ExtensionMessageResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

/** Tab 信息 */
export interface TabInfo {
  tabId: number;
  title: string;
  url: string;
  attached: boolean;
}
