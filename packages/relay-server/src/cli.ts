#!/usr/bin/env node
/**
 * CDP Bridge CLI 入口
 * 
 * 使用方式:
 *   npx playwright-mvp-bridge --port 9230
 *   node dist/cli.js --port 9230
 */
import { config as dotenvConfig } from 'dotenv';

// 加载环境变量
dotenvConfig();

// 解析命令行参数
function parseArgs(): { port?: number; host?: string; token?: string; help?: boolean } {
  const args = process.argv.slice(2);
  const result: { port?: number; host?: string; token?: string; help?: boolean } = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--port' || arg === '-p') {
      result.port = parseInt(args[++i], 10);
    } else if (arg === '--host') {
      result.host = args[++i];
    } else if (arg === '--token' || arg === '-t') {
      result.token = args[++i];
    }
  }
  
  return result;
}

const args = parseArgs();

// 显示帮助
if (args.help) {
  console.log(`
Playwright MVP CDP Bridge Server

Usage:
  node dist/cli.js [options]

Options:
  -p, --port <port>    监听端口 (默认: 9230)
  --host <host>        监听地址 (默认: 0.0.0.0)
  -t, --token <token>  认证 Token (可选)
  -h, --help           显示帮助

Environment Variables:
  RELAY_SERVER_PORT    监听端口
  RELAY_SERVER_HOST    监听地址
  RELAY_AUTH_TOKEN     认证 Token
  LOG_LEVEL            日志级别 (debug|info|warn|error)

Examples:
  # 启动服务（默认端口 9230）
  node dist/cli.js

  # 指定端口
  node dist/cli.js --port 9222

  # 使用 Token 认证
  node dist/cli.js --port 9230 --token my-secret-token

  # 配合 Playwright MCP 使用
  # 1. 启动 Bridge: node dist/cli.js --port 9230
  # 2. SSH 端口转发: ssh -L 9230:localhost:9230 remote-server
  # 3. Chrome Extension 连接: ws://localhost:9230/extension
  # 4. MCP 配置: --cdp-endpoint http://localhost:9230
`);
  process.exit(0);
}

// 设置环境变量（命令行参数覆盖）
if (args.port) {
  process.env.RELAY_SERVER_PORT = String(args.port);
}
if (args.host) {
  process.env.RELAY_SERVER_HOST = args.host;
}
if (args.token) {
  process.env.RELAY_AUTH_TOKEN = args.token;
}

// 设置默认端口为 9230
if (!process.env.RELAY_SERVER_PORT) {
  process.env.RELAY_SERVER_PORT = '9230';
}

// 启动服务器
import('./index.js');
