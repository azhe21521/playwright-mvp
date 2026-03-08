/**
 * 测试客户端
 * 模拟 MCP 客户端发送请求到中转服务
 */
import { WebSocket } from 'ws';
import {
  createRequest,
  Methods,
  JSONRPC_VERSION,
} from '@playwright-mvp/shared';

const RELAY_SERVER_URL = process.env.RELAY_SERVER_URL || 'ws://localhost:3000';
const AUTH_TOKEN = process.env.RELAY_AUTH_TOKEN || '';

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTest(): Promise<void> {
  console.log('🧪 开始测试中转服务...');
  console.log(`   服务地址: ${RELAY_SERVER_URL}`);
  console.log(`   Token: ${AUTH_TOKEN ? '已配置' : '未配置'}`);
  console.log('');

  // 创建 WebSocket 连接
  const ws = new WebSocket(RELAY_SERVER_URL);
  let requestId = 0;

  const sendRequest = (method: string, params?: unknown): Promise<unknown> => {
    return new Promise((resolve, reject) => {
      const id = ++requestId;
      const request = createRequest(id, method, params);
      
      const timeout = setTimeout(() => {
        reject(new Error(`请求超时: ${method}`));
      }, 10000);

      const handler = (data: Buffer) => {
        const message = JSON.parse(data.toString());
        if (message.id === id) {
          clearTimeout(timeout);
          ws.off('message', handler);
          if (message.error) {
            reject(new Error(message.error.message));
          } else {
            resolve(message.result);
          }
        }
      };

      ws.on('message', handler);
      ws.send(JSON.stringify(request));
    });
  };

  ws.on('open', async () => {
    console.log('✓ WebSocket 连接成功');

    // 测试 1: 认证
    console.log('\n📋 测试 1: 认证');
    try {
      const authResult = await sendRequest(Methods.AUTH, {
        token: AUTH_TOKEN,
        clientType: 'mcp',
        clientVersion: '1.0.0',
      });
      console.log('✓ 认证成功:', authResult);
    } catch (error) {
      console.log('✗ 认证失败:', (error as Error).message);
      ws.close();
      return;
    }

    // 测试 2: 健康检查
    console.log('\n📋 测试 2: 健康检查');
    try {
      const healthResult = await sendRequest(Methods.HEALTH_CHECK);
      console.log('✓ 健康检查成功:', healthResult);
    } catch (error) {
      console.log('✗ 健康检查失败:', (error as Error).message);
    }

    // 测试 3: 获取 Tools 列表
    console.log('\n📋 测试 3: 获取 Tools 列表');
    try {
      const toolsResult = await sendRequest(Methods.TOOLS_LIST) as { tools: Array<{ name: string }> };
      console.log(`✓ 获取 Tools 成功: ${toolsResult.tools.length} 个工具`);
      toolsResult.tools.slice(0, 3).forEach((tool) => {
        console.log(`   - ${tool.name}`);
      });
      if (toolsResult.tools.length > 3) {
        console.log(`   ... 还有 ${toolsResult.tools.length - 3} 个`);
      }
    } catch (error) {
      console.log('✗ 获取 Tools 失败:', (error as Error).message);
    }

    // 测试 4: Ping
    console.log('\n📋 测试 4: Ping');
    try {
      const pingResult = await sendRequest(Methods.PING);
      console.log('✓ Ping 成功:', pingResult);
    } catch (error) {
      console.log('✗ Ping 失败:', (error as Error).message);
    }

    // 测试 5: 获取 Tab 列表（如果扩展已连接）
    console.log('\n📋 测试 5: 获取 Tab 列表');
    try {
      const tabsResult = await sendRequest(Methods.TAB_LIST);
      console.log('✓ 获取 Tab 列表成功:', tabsResult);
    } catch (error) {
      console.log('✗ 获取 Tab 列表失败（扩展可能未连接）:', (error as Error).message);
    }

    console.log('\n✅ 测试完成');
    ws.close();
  });

  ws.on('error', (error) => {
    console.error('✗ WebSocket 错误:', error.message);
  });

  ws.on('close', (code, reason) => {
    console.log(`\n连接关闭: code=${code}, reason=${reason.toString()}`);
    process.exit(0);
  });
}

runTest().catch((error) => {
  console.error('测试失败:', error);
  process.exit(1);
});
