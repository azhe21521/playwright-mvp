/**
 * 会话管理服务
 * 管理 MCP 客户端和扩展客户端的会话
 */
import { createLogger, type SessionInfo } from '@playwright-mvp/shared';
import type { WebSocket } from 'ws';
import { config } from '../config.js';

const logger = createLogger('SessionService', config.logLevel);

/** 客户端类型 */
export type ClientType = 'extension' | 'mcp';

/** 客户端会话 */
export interface ClientSession extends SessionInfo {
  ws: WebSocket;
  clientType: ClientType;
  lastHeartbeat: number;
}

/** 会话存储 */
class SessionStore {
  /** 所有会话，按 sessionId 索引 */
  private sessions = new Map<string, ClientSession>();
  
  /** 扩展会话（只有一个扩展连接有效） */
  private extensionSession: ClientSession | null = null;
  
  /** MCP 会话列表 */
  private mcpSessions = new Map<string, ClientSession>();
  
  /**
   * 生成唯一的会话 ID
   */
  generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
  
  /**
   * 生成客户端 ID
   */
  generateClientId(clientType: ClientType): string {
    return `${clientType}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  }
  
  /**
   * 创建会话
   */
  createSession(ws: WebSocket, clientType: ClientType): ClientSession {
    const sessionId = this.generateSessionId();
    const clientId = this.generateClientId(clientType);
    const now = Date.now();
    
    const session: ClientSession = {
      sessionId,
      clientId,
      ws,
      clientType,
      createdAt: now,
      lastHeartbeat: now,
    };
    
    this.sessions.set(sessionId, session);
    
    if (clientType === 'extension') {
      // 如果已有扩展连接，关闭旧连接
      if (this.extensionSession) {
        logger.warn(`新扩展连接，关闭旧连接: ${this.extensionSession.sessionId}`);
        this.removeSession(this.extensionSession.sessionId);
      }
      this.extensionSession = session;
      logger.info(`扩展已连接: ${sessionId}`);
    } else {
      this.mcpSessions.set(sessionId, session);
      logger.info(`MCP 客户端已连接: ${sessionId}`);
    }
    
    return session;
  }
  
  /**
   * 获取会话
   */
  getSession(sessionId: string): ClientSession | undefined {
    return this.sessions.get(sessionId);
  }
  
  /**
   * 根据 WebSocket 获取会话
   */
  getSessionByWs(ws: WebSocket): ClientSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.ws === ws) {
        return session;
      }
    }
    return undefined;
  }
  
  /**
   * 获取扩展会话
   */
  getExtensionSession(): ClientSession | null {
    return this.extensionSession;
  }
  
  /**
   * 获取所有 MCP 会话
   */
  getMcpSessions(): ClientSession[] {
    return Array.from(this.mcpSessions.values());
  }
  
  /**
   * 更新心跳时间
   */
  updateHeartbeat(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastHeartbeat = Date.now();
    }
  }
  
  /**
   * 设置会话的 Tab ID
   */
  setTabId(sessionId: string, tabId: number): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.tabId = tabId;
    }
  }
  
  /**
   * 移除会话
   */
  removeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    
    if (session.clientType === 'extension') {
      if (this.extensionSession?.sessionId === sessionId) {
        this.extensionSession = null;
      }
      logger.info(`扩展已断开: ${sessionId}`);
    } else {
      this.mcpSessions.delete(sessionId);
      logger.info(`MCP 客户端已断开: ${sessionId}`);
    }
    
    this.sessions.delete(sessionId);
    
    // 关闭 WebSocket 连接
    if (session.ws.readyState === 1) { // OPEN
      session.ws.close();
    }
  }
  
  /**
   * 清理超时会话
   */
  cleanupTimeoutSessions(timeout: number): number {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [sessionId, session] of this.sessions) {
      if (now - session.lastHeartbeat > timeout) {
        logger.warn(`会话超时，清理: ${sessionId}`);
        this.removeSession(sessionId);
        cleaned++;
      }
    }
    
    return cleaned;
  }
  
  /**
   * 获取统计信息
   */
  getStats() {
    return {
      total: this.sessions.size,
      extensions: this.extensionSession ? 1 : 0,
      mcp: this.mcpSessions.size,
    };
  }
  
  /**
   * 清空所有会话
   */
  clear(): void {
    for (const sessionId of this.sessions.keys()) {
      this.removeSession(sessionId);
    }
  }
}

/** 会话存储单例 */
export const sessionStore = new SessionStore();
