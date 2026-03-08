/**
 * 消息转发服务
 * 处理 MCP 和扩展之间的消息转发
 */
import {
  createLogger,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcResponse,
  isJsonRpcNotification,
  createResponse,
  createErrorResponse,
  createNotification,
  ErrorCodes,
  Methods,
} from '@playwright-mvp/shared';
import type { WebSocket } from 'ws';
import { config } from '../config.js';
import { sessionStore, type ClientSession } from './session-service.js';

const logger = createLogger('RelayService', config.logLevel);

/**
 * 发送 JSON 消息到 WebSocket
 */
export function sendMessage(ws: WebSocket, message: unknown): void {
  if (ws.readyState !== 1) { // OPEN
    logger.warn('WebSocket 未就绪，无法发送消息');
    return;
  }
  
  const data = JSON.stringify(message);
  ws.send(data);
  logger.debug(`发送消息: ${data.substring(0, 200)}...`);
}

/**
 * 转发 MCP 请求到扩展
 */
export function forwardToExtension(
  request: JsonRpcRequest,
  mcpSession: ClientSession
): boolean {
  const extensionSession = sessionStore.getExtensionSession();
  
  if (!extensionSession) {
    logger.warn('没有可用的扩展连接');
    // 返回错误响应给 MCP
    const errorResponse = createErrorResponse(
      request.id,
      ErrorCodes.CONNECTION_LOST,
      '扩展未连接'
    );
    sendMessage(mcpSession.ws, errorResponse);
    return false;
  }
  
  // 在请求中添加 MCP 会话信息，以便扩展返回响应时可以路由
  const forwardRequest = {
    ...request,
    _mcpSessionId: mcpSession.sessionId,
  };
  
  logger.debug(`转发 MCP 请求到扩展: ${request.method}`);
  sendMessage(extensionSession.ws, forwardRequest);
  return true;
}

/**
 * 转发扩展响应到 MCP
 */
export function forwardToMcp(
  response: JsonRpcResponse & { _mcpSessionId?: string }
): boolean {
  const mcpSessionId = response._mcpSessionId;
  
  if (!mcpSessionId) {
    // 如果没有指定 MCP 会话，广播到所有 MCP
    const mcpSessions = sessionStore.getMcpSessions();
    if (mcpSessions.length === 0) {
      logger.warn('没有可用的 MCP 连接');
      return false;
    }
    
    // 清除内部路由字段
    const cleanResponse = { ...response };
    delete cleanResponse._mcpSessionId;
    
    for (const session of mcpSessions) {
      sendMessage(session.ws, cleanResponse);
    }
    return true;
  }
  
  const mcpSession = sessionStore.getSession(mcpSessionId);
  if (!mcpSession) {
    logger.warn(`MCP 会话不存在: ${mcpSessionId}`);
    return false;
  }
  
  // 清除内部路由字段
  const cleanResponse = { ...response };
  delete cleanResponse._mcpSessionId;
  
  logger.debug(`转发扩展响应到 MCP: ${mcpSessionId}`);
  sendMessage(mcpSession.ws, cleanResponse);
  return true;
}

/**
 * 广播 CDP 事件到所有 MCP 客户端
 */
export function broadcastCdpEvent(event: JsonRpcNotification): void {
  const mcpSessions = sessionStore.getMcpSessions();
  
  if (mcpSessions.length === 0) {
    logger.debug('没有 MCP 客户端，跳过事件广播');
    return;
  }
  
  logger.debug(`广播 CDP 事件到 ${mcpSessions.length} 个 MCP 客户端: ${event.method}`);
  
  for (const session of mcpSessions) {
    sendMessage(session.ws, event);
  }
}

/**
 * 处理健康检查请求
 */
export function handleHealthCheck(request: JsonRpcRequest, session: ClientSession): void {
  const stats = sessionStore.getStats();
  const uptime = process.uptime();
  
  const response = createResponse(request.id, {
    status: 'healthy',
    latency: 0, // 本地响应，延迟为 0
    uptime: Math.floor(uptime),
    version: config.version,
    connectedClients: {
      extensions: stats.extensions,
      mcp: stats.mcp,
    },
  });
  
  sendMessage(session.ws, response);
}

/**
 * 处理 Tools 列表请求
 */
export function handleListTools(request: JsonRpcRequest, session: ClientSession): void {
  // 返回 Playwright MCP 支持的 tools 列表（这是静态列表）
  const tools = [
    { name: 'browser_navigate', description: '导航到指定 URL' },
    { name: 'browser_click', description: '点击页面元素' },
    { name: 'browser_type', description: '在输入框中输入文本' },
    { name: 'browser_screenshot', description: '截取页面截图' },
    { name: 'browser_snapshot', description: '获取页面可访问性快照' },
    { name: 'browser_evaluate', description: '在页面中执行 JavaScript' },
    { name: 'browser_wait', description: '等待指定条件' },
    { name: 'browser_press_key', description: '按下键盘按键' },
    { name: 'browser_select_option', description: '选择下拉框选项' },
    { name: 'browser_hover', description: '悬停在元素上' },
    { name: 'browser_drag', description: '拖拽元素' },
    { name: 'browser_resize', description: '调整浏览器窗口大小' },
    { name: 'browser_file_upload', description: '上传文件' },
    { name: 'browser_handle_dialog', description: '处理对话框' },
    { name: 'browser_tab_list', description: '获取 Tab 列表' },
    { name: 'browser_tab_new', description: '创建新 Tab' },
    { name: 'browser_tab_select', description: '切换 Tab' },
    { name: 'browser_tab_close', description: '关闭 Tab' },
  ];
  
  const response = createResponse(request.id, { tools });
  sendMessage(session.ws, response);
}

/**
 * 处理 Ping 请求
 */
export function handlePing(request: JsonRpcRequest, session: ClientSession): void {
  sessionStore.updateHeartbeat(session.sessionId);
  const response = createResponse(request.id, { pong: true, timestamp: Date.now() });
  sendMessage(session.ws, response);
}

/**
 * 处理来自 MCP 的消息
 */
export function handleMcpMessage(message: unknown, session: ClientSession): void {
  if (isJsonRpcRequest(message)) {
    const request = message;
    
    // 处理中转服务自身的请求
    switch (request.method) {
      case Methods.HEALTH_CHECK:
        handleHealthCheck(request, session);
        return;
      case Methods.TOOLS_LIST:
        handleListTools(request, session);
        return;
      case Methods.PING:
        handlePing(request, session);
        return;
    }
    
    // 其他请求转发到扩展
    forwardToExtension(request, session);
    
  } else if (isJsonRpcNotification(message)) {
    // 通知消息直接转发
    const extensionSession = sessionStore.getExtensionSession();
    if (extensionSession) {
      sendMessage(extensionSession.ws, message);
    }
  } else {
    logger.warn('收到无效的 MCP 消息格式');
  }
}

/**
 * 处理来自扩展的消息
 */
export function handleExtensionMessage(message: unknown, session: ClientSession): void {
  if (isJsonRpcResponse(message)) {
    // 响应消息转发到对应的 MCP
    forwardToMcp(message as JsonRpcResponse & { _mcpSessionId?: string });
    
  } else if (isJsonRpcNotification(message)) {
    const notification = message;
    
    // CDP 事件广播到所有 MCP
    if (notification.method === Methods.CDP_EVENT) {
      broadcastCdpEvent(notification);
    }
    
  } else if (isJsonRpcRequest(message)) {
    const request = message;
    
    // 处理扩展的内部请求
    switch (request.method) {
      case Methods.HEALTH_CHECK:
        handleHealthCheck(request, session);
        return;
      case Methods.PING:
        handlePing(request, session);
        return;
    }
    
    logger.warn(`扩展发送了未知请求: ${request.method}`);
  } else {
    logger.warn('收到无效的扩展消息格式');
  }
}
