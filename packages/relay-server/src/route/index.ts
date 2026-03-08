/**
 * HTTP 路由定义
 */
import { Router, type Router as RouterType } from 'express';
import { healthHandler, readyHandler, liveHandler } from '../controller/health/index.js';

const router: RouterType = Router();

// 健康检查端点
router.get('/health', healthHandler);
router.get('/ready', readyHandler);
router.get('/live', liveHandler);

// 根路径
router.get('/', (req, res) => {
  res.json({
    name: 'Playwright MVP Relay Server',
    version: '1.0.0',
    description: 'Playwright MCP 中转服务',
    endpoints: {
      health: '/health',
      ready: '/ready',
      live: '/live',
      websocket: 'ws://host:port/',
    },
  });
});

export default router;
