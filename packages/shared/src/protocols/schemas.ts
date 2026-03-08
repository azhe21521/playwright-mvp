/**
 * Zod 消息校验 Schema
 */
import { z } from 'zod';

/** JSON-RPC 版本 Schema */
const jsonrpcVersionSchema = z.literal('2.0');

/** JSON-RPC 基础请求 Schema */
export const jsonRpcRequestSchema = z.object({
  jsonrpc: jsonrpcVersionSchema,
  id: z.union([z.number(), z.string()]),
  method: z.string().min(1),
  params: z.unknown().optional(),
});

/** JSON-RPC 响应 Schema */
export const jsonRpcResponseSchema = z.object({
  jsonrpc: jsonrpcVersionSchema,
  id: z.union([z.number(), z.string()]),
  result: z.unknown().optional(),
  error: z.object({
    code: z.number(),
    message: z.string(),
    data: z.unknown().optional(),
  }).optional(),
});

/** JSON-RPC 通知 Schema */
export const jsonRpcNotificationSchema = z.object({
  jsonrpc: jsonrpcVersionSchema,
  method: z.string().min(1),
  params: z.unknown().optional(),
});

// ==================== 认证 Schema ====================

/** 认证参数 Schema */
export const authParamsSchema = z.object({
  token: z.string().min(1, 'Token 不能为空'),
  clientType: z.enum(['extension', 'mcp']),
  clientVersion: z.string().optional(),
});

/** 认证结果 Schema */
export const authResultSchema = z.object({
  success: z.boolean(),
  sessionId: z.string(),
  message: z.string().optional(),
});

// ==================== CDP Schema ====================

/** CDP 命令参数 Schema */
export const cdpCommandParamsSchema = z.object({
  sessionId: z.string().optional(),
  method: z.string().min(1, 'CDP 方法名不能为空'),
  params: z.record(z.unknown()).optional(),
  tabId: z.number().int().positive().optional(),
});

/** CDP 事件参数 Schema */
export const cdpEventParamsSchema = z.object({
  sessionId: z.string().optional(),
  method: z.string().min(1),
  params: z.record(z.unknown()).optional(),
});

// ==================== Tab 管理 Schema ====================

/** 连接 Tab 参数 Schema */
export const attachTabParamsSchema = z.object({
  tabId: z.number().int().positive('Tab ID 必须是正整数'),
});

/** 断开 Tab 参数 Schema */
export const detachTabParamsSchema = z.object({
  tabId: z.number().int().positive('Tab ID 必须是正整数'),
});

/** Tab 信息 Schema */
export const tabInfoSchema = z.object({
  tabId: z.number(),
  title: z.string(),
  url: z.string(),
  attached: z.boolean(),
});

/** Tab 列表结果 Schema */
export const listTabsResultSchema = z.object({
  tabs: z.array(tabInfoSchema),
});

// ==================== 健康检查 Schema ====================

/** 健康检查结果 Schema */
export const healthCheckResultSchema = z.object({
  status: z.enum(['healthy', 'unhealthy']),
  latency: z.number(),
  uptime: z.number(),
  version: z.string(),
  connectedClients: z.object({
    extensions: z.number(),
    mcp: z.number(),
  }),
});

/** Tool 信息 Schema */
export const toolInfoSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.record(z.unknown()).optional(),
});

/** Tools 列表结果 Schema */
export const listToolsResultSchema = z.object({
  tools: z.array(toolInfoSchema),
});

// ==================== 扩展配置 Schema ====================

/** 扩展配置 Schema */
export const extensionConfigSchema = z.object({
  relayServerUrl: z.string().url('请输入有效的 WebSocket URL').refine(
    (url) => url.startsWith('ws://') || url.startsWith('wss://'),
    'URL 必须以 ws:// 或 wss:// 开头'
  ),
  token: z.string(),
  whitelist: z.array(z.string()),
  autoReconnect: z.boolean(),
  reconnectInterval: z.number().int().min(1000).max(60000),
  maxReconnectAttempts: z.number().int().min(1).max(100),
});

/** 白名单规则 Schema */
export const whitelistRuleSchema = z.string().min(1, '白名单规则不能为空');

// ==================== Schema 推断类型（内部使用） ====================
// 注意：这些类型与 messages.ts 和 types/index.ts 中的接口定义保持一致
// 使用 Schema 进行运行时验证，使用接口定义进行类型检查

/** 从 Schema 推断的类型，用于验证函数的返回类型 */
export type InferredJsonRpcRequest = z.infer<typeof jsonRpcRequestSchema>;
export type InferredJsonRpcResponse = z.infer<typeof jsonRpcResponseSchema>;
export type InferredJsonRpcNotification = z.infer<typeof jsonRpcNotificationSchema>;
export type InferredAuthParams = z.infer<typeof authParamsSchema>;
export type InferredAuthResult = z.infer<typeof authResultSchema>;
export type InferredCDPCommandParams = z.infer<typeof cdpCommandParamsSchema>;
export type InferredCDPEventParams = z.infer<typeof cdpEventParamsSchema>;
export type InferredAttachTabParams = z.infer<typeof attachTabParamsSchema>;
export type InferredDetachTabParams = z.infer<typeof detachTabParamsSchema>;
export type InferredTabInfo = z.infer<typeof tabInfoSchema>;
export type InferredListTabsResult = z.infer<typeof listTabsResultSchema>;
export type InferredHealthCheckResult = z.infer<typeof healthCheckResultSchema>;
export type InferredToolInfo = z.infer<typeof toolInfoSchema>;
export type InferredListToolsResult = z.infer<typeof listToolsResultSchema>;
export type InferredExtensionConfig = z.infer<typeof extensionConfigSchema>;
