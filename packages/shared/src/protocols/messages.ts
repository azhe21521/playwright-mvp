/**
 * JSON-RPC 2.0 协议消息类型定义
 */

/** JSON-RPC 版本 */
export const JSONRPC_VERSION = '2.0' as const;

/** JSON-RPC 请求 */
export interface JsonRpcRequest<T = unknown> {
  jsonrpc: typeof JSONRPC_VERSION;
  id: number | string;
  method: string;
  params?: T;
}

/** JSON-RPC 响应 */
export interface JsonRpcResponse<T = unknown> {
  jsonrpc: typeof JSONRPC_VERSION;
  id: number | string;
  result?: T;
  error?: JsonRpcError;
}

/** JSON-RPC 通知（无需响应） */
export interface JsonRpcNotification<T = unknown> {
  jsonrpc: typeof JSONRPC_VERSION;
  method: string;
  params?: T;
}

/** JSON-RPC 错误 */
export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/** 标准错误码 */
export const ErrorCodes = {
  // 标准 JSON-RPC 错误
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  
  // 自定义错误码
  AUTH_FAILED: -32001,
  TOKEN_INVALID: -32002,
  SESSION_NOT_FOUND: -32003,
  TAB_NOT_FOUND: -32004,
  WHITELIST_BLOCKED: -32005,
  CONNECTION_LOST: -32006,
  CDP_ERROR: -32007,
} as const;

// ==================== 认证相关消息 ====================

/** 认证请求参数 */
export interface AuthParams {
  token: string;
  clientType: 'extension' | 'mcp';
  clientVersion?: string;
}

/** 认证响应结果 */
export interface AuthResult {
  success: boolean;
  sessionId: string;
  message?: string;
}

// ==================== CDP 相关消息 ====================

/** CDP 命令参数 */
export interface CDPCommandParams {
  sessionId?: string;
  method: string;
  params?: Record<string, unknown>;
  tabId?: number;
}

/** CDP 命令结果 */
export interface CDPCommandResult {
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

/** CDP 事件参数 */
export interface CDPEventParams {
  sessionId?: string;
  method: string;
  params?: Record<string, unknown>;
}

// ==================== Tab 管理消息 ====================

/** 连接到 Tab 请求参数 */
export interface AttachTabParams {
  tabId: number;
}

/** 连接到 Tab 响应结果 */
export interface AttachTabResult {
  success: boolean;
  tabId: number;
  sessionId: string;
}

/** 断开 Tab 连接参数 */
export interface DetachTabParams {
  tabId: number;
}

/** 获取 Tab 列表结果 */
export interface ListTabsResult {
  tabs: Array<{
    tabId: number;
    title: string;
    url: string;
    attached: boolean;
  }>;
}

// ==================== 健康检查消息 ====================

/** 健康检查结果 */
export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy';
  latency: number;
  uptime: number;
  version: string;
  connectedClients: {
    extensions: number;
    mcp: number;
  };
}

/** 获取 Tools 列表结果 */
export interface ListToolsResult {
  tools: Array<{
    name: string;
    description: string;
    inputSchema?: Record<string, unknown>;
  }>;
}

// ==================== 协议方法名常量 ====================

export const Methods = {
  // 认证
  AUTH: 'auth',
  
  // CDP 相关
  CDP_COMMAND: 'cdp.command',
  CDP_EVENT: 'cdp.event',
  
  // Tab 管理
  TAB_ATTACH: 'tab.attach',
  TAB_DETACH: 'tab.detach',
  TAB_LIST: 'tab.list',
  
  // 健康检查
  HEALTH_CHECK: 'health.check',
  TOOLS_LIST: 'tools.list',
  
  // 心跳
  PING: 'ping',
  PONG: 'pong',
} as const;

// ==================== 类型守卫和工具函数 ====================

/** 判断是否为 JSON-RPC 请求 */
export function isJsonRpcRequest(msg: unknown): msg is JsonRpcRequest {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'jsonrpc' in msg &&
    (msg as JsonRpcRequest).jsonrpc === JSONRPC_VERSION &&
    'id' in msg &&
    'method' in msg
  );
}

/** 判断是否为 JSON-RPC 响应 */
export function isJsonRpcResponse(msg: unknown): msg is JsonRpcResponse {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'jsonrpc' in msg &&
    (msg as JsonRpcResponse).jsonrpc === JSONRPC_VERSION &&
    'id' in msg &&
    ('result' in msg || 'error' in msg)
  );
}

/** 判断是否为 JSON-RPC 通知 */
export function isJsonRpcNotification(msg: unknown): msg is JsonRpcNotification {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'jsonrpc' in msg &&
    (msg as JsonRpcNotification).jsonrpc === JSONRPC_VERSION &&
    'method' in msg &&
    !('id' in msg)
  );
}

/** 创建 JSON-RPC 请求 */
export function createRequest<T>(id: number | string, method: string, params?: T): JsonRpcRequest<T> {
  return {
    jsonrpc: JSONRPC_VERSION,
    id,
    method,
    ...(params !== undefined && { params }),
  };
}

/** 创建 JSON-RPC 成功响应 */
export function createResponse<T>(id: number | string, result: T): JsonRpcResponse<T> {
  return {
    jsonrpc: JSONRPC_VERSION,
    id,
    result,
  };
}

/** 创建 JSON-RPC 错误响应 */
export function createErrorResponse(id: number | string, code: number, message: string, data?: unknown): JsonRpcResponse {
  return {
    jsonrpc: JSONRPC_VERSION,
    id,
    error: { code, message, ...(data !== undefined && { data }) },
  };
}

/** 创建 JSON-RPC 通知 */
export function createNotification<T>(method: string, params?: T): JsonRpcNotification<T> {
  return {
    jsonrpc: JSONRPC_VERSION,
    method,
    ...(params !== undefined && { params }),
  };
}
