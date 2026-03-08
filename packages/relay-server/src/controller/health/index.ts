/**
 * 健康检查控制器
 * 提供 HTTP 健康检查端点
 */
import type { Request, Response } from 'express';
import { sessionStore } from '../../services/session-service.js';
import { config } from '../../config.js';

/**
 * 健康检查处理器
 */
export function healthHandler(req: Request, res: Response): void {
  const stats = sessionStore.getStats();
  const uptime = process.uptime();
  
  res.json({
    status: 'healthy',
    version: config.version,
    uptime: Math.floor(uptime),
    connectedClients: {
      extensions: stats.extensions,
      mcp: stats.mcp,
      total: stats.total,
    },
    timestamp: Date.now(),
  });
}

/**
 * 就绪检查处理器
 */
export function readyHandler(req: Request, res: Response): void {
  // 只要服务启动就认为就绪
  res.json({
    ready: true,
    timestamp: Date.now(),
  });
}

/**
 * 存活检查处理器
 */
export function liveHandler(req: Request, res: Response): void {
  res.json({
    alive: true,
    timestamp: Date.now(),
  });
}
