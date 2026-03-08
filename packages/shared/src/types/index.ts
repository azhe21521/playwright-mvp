/**
 * 共享类型定义
 * 
 * 这里只定义应用层类型，协议消息类型在 protocols/messages.ts 中定义
 */

/** 连接状态 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/** 健康状态 */
export type HealthState = 'healthy' | 'unhealthy' | 'unknown';

/** 扩展配置 */
export interface ExtensionConfig {
  /** 中转服务地址 */
  relayServerUrl: string;
  /** 身份验证 Token */
  token: string;
  /** URL 白名单列表（支持通配符） */
  whitelist: string[];
  /** 是否自动重连 */
  autoReconnect: boolean;
  /** 重连间隔（毫秒） */
  reconnectInterval: number;
  /** 最大重连次数 */
  maxReconnectAttempts: number;
}

/** 默认扩展配置 */
export const DEFAULT_EXTENSION_CONFIG: ExtensionConfig = {
  relayServerUrl: 'ws://localhost:9230',
  token: '',
  whitelist: [],
  autoReconnect: true,
  reconnectInterval: 3000,
  maxReconnectAttempts: 10,
};

/** 连接状态信息 */
export interface ConnectionStatus {
  state: ConnectionState;
  serverUrl: string;
  lastConnectedAt?: number;
  lastError?: string;
  reconnectAttempts: number;
}

/** Session 信息 */
export interface SessionInfo {
  sessionId: string;
  clientId: string;
  tabId?: number;
  createdAt: number;
}

/** 日志级别 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** 日志配置 */
export interface LogConfig {
  level: LogLevel;
  prefix: string;
}
