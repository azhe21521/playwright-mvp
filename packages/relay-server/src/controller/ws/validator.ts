/**
 * WebSocket 消息校验器
 */
import { z } from 'zod';
import {
  jsonRpcRequestSchema,
  jsonRpcResponseSchema,
  jsonRpcNotificationSchema,
  authParamsSchema,
} from '@playwright-mvp/shared';

/**
 * 解析 JSON 消息
 */
export function parseJsonMessage(data: string): { success: true; data: unknown } | { success: false; error: string } {
  try {
    const parsed = JSON.parse(data);
    return { success: true, data: parsed };
  } catch (e) {
    return { success: false, error: '无效的 JSON 格式' };
  }
}

/**
 * 校验 JSON-RPC 请求
 */
export function validateRequest(data: unknown) {
  return jsonRpcRequestSchema.safeParse(data);
}

/**
 * 校验 JSON-RPC 响应
 */
export function validateResponse(data: unknown) {
  return jsonRpcResponseSchema.safeParse(data);
}

/**
 * 校验 JSON-RPC 通知
 */
export function validateNotification(data: unknown) {
  return jsonRpcNotificationSchema.safeParse(data);
}

/**
 * 校验认证参数
 */
export function validateAuthParams(data: unknown) {
  return authParamsSchema.safeParse(data);
}

/**
 * 判断消息类型
 */
export function getMessageType(data: unknown): 'request' | 'response' | 'notification' | 'unknown' {
  if (typeof data !== 'object' || data === null) {
    return 'unknown';
  }
  
  const obj = data as Record<string, unknown>;
  
  // 有 id 和 method 是请求
  if ('id' in obj && 'method' in obj) {
    return 'request';
  }
  
  // 有 id 但没有 method，有 result 或 error 是响应
  if ('id' in obj && ('result' in obj || 'error' in obj)) {
    return 'response';
  }
  
  // 只有 method 没有 id 是通知
  if ('method' in obj && !('id' in obj)) {
    return 'notification';
  }
  
  return 'unknown';
}
