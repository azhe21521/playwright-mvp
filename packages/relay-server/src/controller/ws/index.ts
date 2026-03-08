/**
 * WebSocket 控制器
 * 处理 WebSocket 连接和消息
 */
import type { WebSocket, RawData } from 'ws';
import {
  createLogger,
  createErrorResponse,
  createResponse,
  ErrorCodes,
  Methods,
} from '@playwright-mvp/shared';
import { config } from '../../config.js';
import { validateToken } from '../../services/auth-service.js';
import { sessionStore, type ClientType, type ClientSession } from '../../services/session-service.js';
import { handleMcpMessage, handleExtensionMessage, sendMessage } from '../../services/relay-service.js';
import { parseJsonMessage, validateAuthParams, getMessageType } from './validator.js';

const logger = createLogger('WsController', config.logLevel);

/** 待认证的连接 */
const pendingConnections = new Map<WebSocket, NodeJS.Timeout>();

/** 认证超时时间 */
const AUTH_TIMEOUT = 30000;

/**
 * 处理新的 WebSocket 连接
 */
export function handleConnection(ws: WebSocket): void {
  logger.info('新的 WebSocket 连接');
  
  // 设置认证超时
  const timeout = setTimeout(() => {
    if (pendingConnections.has(ws)) {
      logger.warn('连接认证超时，断开连接');
      pendingConnections.delete(ws);
      ws.close(4001, '认证超时');
    }
  }, AUTH_TIMEOUT);
  
  pendingConnections.set(ws, timeout);
  
  // 监听消息
  ws.on('message', (data: RawData) => {
    handleMessage(ws, data);
  });
  
  // 监听关闭
  ws.on('close', (code: number, reason: Buffer) => {
    handleClose(ws, code, reason.toString());
  });
  
  // 监听错误
  ws.on('error', (error: Error) => {
    handleError(ws, error);
  });
}

/**
 * 处理 WebSocket 消息
 */
function handleMessage(ws: WebSocket, data: RawData): void {
  const rawMessage = data.toString();
  logger.debug(`收到消息: ${rawMessage.substring(0, 200)}...`);
  
  // 解析 JSON
  const parseResult = parseJsonMessage(rawMessage);
  if (!parseResult.success) {
    sendMessage(ws, createErrorResponse(0, ErrorCodes.PARSE_ERROR, parseResult.error));
    return;
  }
  
  const message = parseResult.data;
  
  // 检查是否已认证
  const session = sessionStore.getSessionByWs(ws);
  
  if (!session) {
    // 未认证，只接受认证请求
    handleAuthMessage(ws, message);
    return;
  }
  
  // 已认证，根据客户端类型处理消息
  if (session.clientType === 'mcp') {
    handleMcpMessage(message, session);
  } else {
    handleExtensionMessage(message, session);
  }
}

/**
 * 处理认证消息
 */
function handleAuthMessage(ws: WebSocket, message: unknown): void {
  const messageType = getMessageType(message);
  
  if (messageType !== 'request') {
    sendMessage(ws, createErrorResponse(0, ErrorCodes.INVALID_REQUEST, '请先进行认证'));
    return;
  }
  
  const request = message as { id: number | string; method: string; params?: unknown };
  
  if (request.method !== Methods.AUTH) {
    sendMessage(ws, createErrorResponse(request.id, ErrorCodes.INVALID_REQUEST, '请先进行认证'));
    return;
  }
  
  // 校验认证参数
  const paramsResult = validateAuthParams(request.params);
  if (!paramsResult.success) {
    sendMessage(ws, createErrorResponse(request.id, ErrorCodes.INVALID_PARAMS, '认证参数无效'));
    return;
  }
  
  const { token, clientType } = paramsResult.data;
  
  // 验证 Token
  const authResult = validateToken(token);
  if (!authResult.valid) {
    sendMessage(ws, createErrorResponse(
      request.id,
      ErrorCodes.AUTH_FAILED,
      authResult.message ?? '认证失败'
    ));
    ws.close(4002, '认证失败');
    return;
  }
  
  // 清除认证超时
  const timeout = pendingConnections.get(ws);
  if (timeout) {
    clearTimeout(timeout);
    pendingConnections.delete(ws);
  }
  
  // 创建会话
  const session = sessionStore.createSession(ws, clientType as ClientType);
  
  // 返回认证成功
  sendMessage(ws, createResponse(request.id, {
    success: true,
    sessionId: session.sessionId,
    message: '认证成功',
  }));
  
  logger.info(`客户端认证成功: ${session.sessionId} (${clientType})`);
}

/**
 * 处理连接关闭
 */
function handleClose(ws: WebSocket, code: number, reason: string): void {
  logger.info(`WebSocket 连接关闭: code=${code}, reason=${reason}`);
  
  // 清除待认证超时
  const timeout = pendingConnections.get(ws);
  if (timeout) {
    clearTimeout(timeout);
    pendingConnections.delete(ws);
  }
  
  // 移除会话
  const session = sessionStore.getSessionByWs(ws);
  if (session) {
    sessionStore.removeSession(session.sessionId);
  }
}

/**
 * 处理连接错误
 */
function handleError(ws: WebSocket, error: Error): void {
  logger.error(`WebSocket 错误: ${error.message}`);
}

/**
 * 获取连接统计
 */
export function getConnectionStats() {
  return {
    pending: pendingConnections.size,
    ...sessionStore.getStats(),
  };
}
