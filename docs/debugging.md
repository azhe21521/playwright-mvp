# Playwright-MVP 调试指南

本文档介绍如何调试 CDP Bridge Server 和 Chrome Extension 之间的通信问题。

## 日志系统

### 日志级别

从最详细到最简略：
- `trace`: 高频事件（CDP 事件转发、网络请求等），仅在排查详细问题时使用
- `debug`: 开发调试信息（命令/响应流程、附加/分离详情等）
- `info`: 关键生命周期事件（连接、断开、启动等），默认级别
- `warn`: 已知限制或降级状态
- `error`: 意外错误

### CDP Bridge Server (relay-server)

#### 环境变量

```bash
# 设置日志级别（默认: info）
export LOG_LEVEL=trace|debug|info|warn|error

# 启用文件日志
export LOG_TO_FILE=1

# 指定日志目录（默认: ./logs）
export LOG_DIR=/path/to/logs

# 旧版兼容：启用调试日志
export CDP_BRIDGE_DEBUG=1
```

#### 启动方式

```bash
# 默认启动（info 级别）
cd packages/relay-server
pnpm start

# 调试模式启动
LOG_LEVEL=debug pnpm start

# 详细追踪模式
LOG_LEVEL=trace LOG_TO_FILE=1 pnpm start

# 指定端口
LOG_LEVEL=debug pnpm start -- --port 9230
```

#### 日志输出示例

```
[2026-03-09 10:30:45.123] [INFO ] [CDPBridge] ========================================
[2026-03-09 10:30:45.124] [INFO ] [CDPBridge] CDP Bridge Server 正在初始化...
[2026-03-09 10:30:45.125] [INFO ] [CDPBridge] 日志级别: debug
[2026-03-09 10:30:45.126] [INFO ] [CDPBridge] 文件日志: 已启用
[2026-03-09 10:30:45.127] [INFO ] [CDPBridge] ========================================
```

### Chrome Extension

Extension 使用浏览器控制台输出日志。

#### 查看日志

1. 打开 `chrome://extensions/`
2. 找到 "Playwright MVP Bridge" 扩展
3. 点击 "Service Worker" 链接（如果显示）或 "检查视图"
4. 在打开的 DevTools 中查看 Console

#### 设置日志级别

在 Service Worker 控制台执行：

```javascript
// 设置为 trace 级别（最详细）
RelayConnectionDebug.setLogLevel('trace');

// 设置为 debug 级别
RelayConnectionDebug.setLogLevel('debug');

// 查看当前日志级别
RelayConnectionDebug.getLogLevel();

// 查看当前连接状态
RelayConnectionDebug.getState();
```

#### 日志输出示例

```
[10:30:45.123] [INFO ] [RelayConnection] ========================================
[10:30:45.124] [INFO ] [RelayConnection] 🔌 开始连接到 CDP Bridge Server
[10:30:45.125] [INFO ] [RelayConnection] ========================================
[10:30:45.200] [INFO ] [RelayConnection] ✅ WebSocket 连接已建立
[10:30:45.250] [DEBUG] [RelayConnection] ← Bridge [1]: attachToTab (id=1)
```

## 常见问题排查

### 1. Extension 无法连接到 Bridge

**症状**：Extension 显示 "连接失败" 或红色 Badge

**排查步骤**：

1. **检查 Bridge 是否启动**
   ```bash
   curl http://localhost:9230/health
   ```
   预期输出：
   ```json
   {"status":"waiting_extension","version":"1.0.0",...}
   ```

2. **检查端口是否正确**
   - Bridge 默认端口：9230
   - Extension 配置的服务器地址应为 `ws://localhost:9230` 或 `ws://localhost:9230/extension`

3. **检查 SSH 隧道**（如果使用远程开发机）
   ```bash
   # 在本地物理机执行
   ssh -L 9230:localhost:9230 远程服务器
   ```

4. **查看 Bridge 日志**
   - 启用 debug 日志：`LOG_LEVEL=debug pnpm start`
   - 观察是否有 WebSocket 升级请求

### 2. Playwright MCP 无法执行命令

**症状**：MCP 工具调用超时或返回错误

**排查步骤**：

1. **检查 Extension 是否已连接**
   ```bash
   curl http://localhost:9230/health
   ```
   确认 `extensionConnected: true`

2. **检查是否有已附加的 Tab**
   ```bash
   curl http://localhost:9230/json/list
   ```
   应返回已附加的 Tab 列表

3. **查看 Bridge 详细日志**
   ```bash
   LOG_LEVEL=trace pnpm start
   ```
   观察：
   - `← Playwright:` 开头的行：收到的 CDP 命令
   - `→ Extension:` 开头的行：发送给 Extension 的命令
   - `← Extension:` 开头的行：Extension 的响应

4. **在 Extension 控制台查看**
   ```javascript
   RelayConnectionDebug.setLogLevel('trace');
   RelayConnectionDebug.getState();
   ```

### 3. CDP 命令执行失败

**症状**：Bridge 日志显示 "CDP 命令处理失败"

**常见原因**：

1. **Tab 未附加**
   - 错误信息：`Tab xxx 未附加`
   - 解决：确保 Extension 已连接，且有 Tab 被自动附加

2. **Session 不存在**
   - 错误信息：`Unknown CDP sessionId: xxx`
   - 解决：可能是 Tab 已关闭或分离，检查 Extension 状态

3. **导航被白名单阻止**
   - 错误信息包含 "白名单"
   - 解决：在 Extension 设置中添加目标 URL 到白名单

### 4. Token 认证失败

**症状**：Extension 连接后立即断开

**排查步骤**：

1. **检查 Bridge 配置的 Token**
   ```bash
   echo $RELAY_AUTH_TOKEN
   # 或启动时指定
   pnpm start -- --token your-secret-token
   ```

2. **检查 Extension 配置的 Token**
   - 在 Extension Popup 中点击设置
   - 确认 Token 与 Bridge 配置一致

3. **查看认证日志**
   ```bash
   LOG_LEVEL=debug pnpm start
   ```
   观察：
   - `Extension 认证失败` 或 `Token 不匹配`

## 调试工具

### 1. 健康检查端点

```bash
# 基本状态
curl http://localhost:9230/health

# 响应示例
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime": 120,
  "extensionConnected": true,
  "playwrightConnected": true,
  "activeSessions": 1
}
```

### 2. 目标列表端点

```bash
# 获取已附加的 Tab 列表
curl http://localhost:9230/json/list

# 响应示例
[
  {
    "id": "123",
    "type": "page",
    "title": "Example Page",
    "url": "https://example.com",
    "webSocketDebuggerUrl": "ws://localhost:9230/devtools/page/pw-tab-1"
  }
]
```

### 3. 版本信息端点

```bash
curl http://localhost:9230/json/version
```

## 日志文件

启用文件日志后，日志文件位于：

- **Bridge**: `packages/relay-server/logs/cdpbridge-YYYY-MM-DD.log`
- **Extension**: 仅输出到控制台

## 完整调试流程示例

1. **启动 Bridge（详细模式）**
   ```bash
   cd packages/relay-server
   LOG_LEVEL=trace LOG_TO_FILE=1 pnpm start
   ```

2. **建立 SSH 隧道**（如果需要）
   ```bash
   ssh -L 9230:localhost:9230 remote-server
   ```

3. **验证健康状态**
   ```bash
   curl http://localhost:9230/health
   ```

4. **配置并连接 Extension**
   - 设置服务器地址：`ws://localhost:9230`
   - 点击 Connect

5. **启用 Extension 详细日志**
   ```javascript
   // 在 Service Worker 控制台
   RelayConnectionDebug.setLogLevel('trace');
   ```

6. **配置 Playwright MCP**
   ```json
   {
     "mcpServers": {
       "playwright": {
         "command": "npx",
         "args": ["@playwright/mcp", "--cdp-endpoint", "http://localhost:9230"]
       }
     }
   }
   ```

7. **测试 MCP 调用**
   - 在 AI 客户端中使用 `browser_navigate` 等工具
   - 观察 Bridge 和 Extension 日志

## 注意事项

- `trace` 级别会产生大量日志，仅在排查问题时使用
- 文件日志会持续增长，定期清理
- 生产环境建议使用 `info` 级别
