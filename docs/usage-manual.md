# Playwright MVP 使用手册

## 目录

- [项目简介](#项目简介)
- [系统架构](#系统架构)
- [环境要求](#环境要求)
- [快速开始](#快速开始)
- [详细配置](#详细配置)
- [使用流程](#使用流程)
- [SSH 端口转发](#ssh-端口转发)
- [白名单规则](#白名单规则)
- [故障排除](#故障排除)
- [安全建议](#安全建议)

---

## 项目简介

Playwright MVP 是一个 **CDP Bridge** 解决方案，让运行在远端服务器上的 Playwright MCP 能够控制本地物理机上的 Chrome 浏览器。

### 解决的问题

原始的 Playwright MCP 使用 `--cdp-endpoint` 时，需要 Chrome 浏览器在同一台机器上暴露调试端口。Playwright MVP 通过 Bridge Server + Chrome Extension 的方式，实现跨机器的 CDP 通信。

### 核心特性

| 特性 | 说明 |
|------|------|
| 🔌 **标准 CDP 协议** | 完全兼容 Playwright MCP 的 `--cdp-endpoint` |
| 🔐 **Token 验证** | 可选的身份验证，防止未授权访问 |
| 📋 **URL 白名单** | 限制浏览器只能访问指定网址 |
| ⚙️ **友好配置** | Chrome 扩展提供图形化配置界面 |
| 🔄 **自动重连** | 断线后自动重新连接 |

---

## 系统架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              系统架构图                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   远端开发机 (Remote Server)              本地物理机 (Local Machine)    │
│  ┌────────────────────────┐             ┌────────────────────────┐     │
│  │  AI Client             │             │     Chrome Browser      │     │
│  │  (CodeBuddy/Cursor)    │             │    ┌────────────────┐   │     │
│  │         │              │             │    │   Extension    │   │     │
│  │         ▼              │             │    │  (执行 CDP)    │   │     │
│  │  ┌────────────────┐    │   SSH 端口   │    │                │   │     │
│  │  │ Playwright MCP │    │   转发       │    │  ┌──────────┐  │   │     │
│  │  │ --cdp-endpoint │    │             │    │  │ Token ✓  │  │   │     │
│  │  │ http://127.0.0.│◄──────────────►│    │  │ 白名单 ✓ │  │   │     │
│  │  │     1:9230     │    │  Port 9230   │    │  └──────────┘  │   │     │
│  │  └────────────────┘    │             │    └────────────────┘   │     │
│  │         │              │             │             │           │     │
│  │         ▼              │             │             ▼           │     │
│  │  ┌────────────────┐    │             │    ┌────────────────┐   │     │
│  │  │ CDP Bridge     │◄──────────────►│    │ ws://localhost: │   │     │
│  │  │ Server         │    │             │    │   9230/extension│   │     │
│  │  │ (标准 CDP 端点) │    │             │    └────────────────┘   │     │
│  │  └────────────────┘    │             └────────────────────────┘     │
│  └────────────────────────┘                                             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 工作流程

```
1. Playwright MCP 发送 CDP 请求到 Bridge Server (http://localhost:9230)
      │
      ▼
2. Bridge Server 通过 WebSocket 转发到 Chrome Extension
      │
      ▼
3. Chrome Extension 使用 chrome.debugger API 执行 CDP 命令
      │
      ▼
4. 结果原路返回给 Playwright MCP
      │
      ▼
5. AI Client 收到响应，完成操作
```

---

## 环境要求

| 组件 | 版本要求 |
|------|----------|
| Node.js | >= 18.0.0 |
| pnpm | >= 8.0.0 |
| Chrome | >= 120（推荐最新版） |

---

## 快速开始

### 5 步完成部署

```bash
# ==================== 步骤 1: 远端服务器 ====================
# 克隆并构建项目
git clone <repository-url>
cd playwright-mvp
pnpm install
pnpm build

# 启动 CDP Bridge Server
node packages/relay-server/dist/cli.js --port 9230

# ==================== 步骤 2: 本地终端 ====================
# 建立 SSH 端口转发
ssh -L 9230:localhost:9230 user@remote-server

# ==================== 步骤 3: 本地 Chrome ====================
# 安装扩展：
# 1. 打开 chrome://extensions/
# 2. 开启「开发者模式」
# 3. 加载 packages/extension/dist 目录
# 4. 点击扩展图标 → 设置服务器地址 ws://localhost:9230
# 5. 点击「Connect」

# ==================== 步骤 4: 远端服务器 ====================
# 配置 AI 客户端的 MCP，添加参数：
# --cdp-endpoint http://127.0.0.1:9230

# ==================== 步骤 5: 开始使用 ====================
# AI 客户端开始对话，MCP 工具将操作本地 Chrome
```

---

## 详细配置

### CDP Bridge Server 配置

#### 命令行参数

```bash
node dist/cli.js [options]

Options:
  -p, --port <port>    监听端口 (默认: 9230)
  --host <host>        监听地址 (默认: 0.0.0.0)
  -t, --token <token>  认证 Token (可选)
  -h, --help           显示帮助
```

#### 环境变量

| 环境变量 | 说明 | 默认值 |
|----------|------|--------|
| `RELAY_SERVER_PORT` | 监听端口 | `9230` |
| `RELAY_SERVER_HOST` | 监听地址 | `0.0.0.0` |
| `RELAY_AUTH_TOKEN` | 身份验证 Token | 空（不验证） |
| `LOG_LEVEL` | 日志级别 | `info` |

#### HTTP 端点

| 端点 | 说明 |
|------|------|
| `GET /json/version` | 浏览器版本信息（CDP 标准） |
| `GET /json/list` | 可调试目标列表（CDP 标准） |
| `GET /json/protocol` | 协议定义 |
| `PUT /json/new?url=` | 打开新标签页 |
| `GET /json/activate/:id` | 激活标签页 |
| `GET /json/close/:id` | 关闭标签页 |
| `GET /health` | 服务健康状态 |

```bash
# 检查服务状态
curl http://localhost:9230/health

# 获取目标列表（需要 Extension 已连接）
curl http://localhost:9230/json/list
```

#### WebSocket 端点

| 端点 | 说明 |
|------|------|
| `/extension` | Chrome Extension 连接端点 |
| `/devtools/browser/{id}` | CDP 浏览器级别端点 |
| `/devtools/page/{id}` | CDP 页面级别端点 |
| `/cdp` | CDP 通用端点 |

### Chrome 扩展配置

在扩展的「选项」页面中配置：

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| 服务器地址 | Bridge Server 的 WebSocket 地址 | `ws://localhost:9230` |
| Token | 与 Bridge Server 配置保持一致 | 空 |
| 自动重连 | 断线后是否自动重连 | 是 |
| 白名单 | 允许访问的 URL 规则 | 空 |

---

## 使用流程

### 在 CodeBuddy/Cursor 中配置

在 MCP 配置文件中添加 `--cdp-endpoint` 参数：

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": [
        "@anthropic/playwright-mcp",
        "--cdp-endpoint",
        "http://127.0.0.1:9230"
      ]
    }
  }
}
```

### 完整使用示例

```bash
# ====== 1. 远端服务器 ======
# 启动 Bridge（可选 Token）
node dist/cli.js --port 9230 --token my-secret-token

# ====== 2. 本地终端 ======
# SSH 隧道
ssh -L 9230:localhost:9230 user@remote-server

# ====== 3. 本地 Chrome ======
# Extension 配置：
#   服务器: ws://localhost:9230
#   Token: my-secret-token
# 点击 Connect

# ====== 4. 远端 AI 客户端 ======
# 配置 MCP: --cdp-endpoint http://127.0.0.1:9230
# 开始对话！
```

---

## SSH 端口转发

### 基本用法

```bash
# 将远端 9230 端口转发到本地 9230
ssh -L 9230:localhost:9230 user@remote-server
```

### 后台运行

```bash
# 后台运行，不打开 shell
ssh -N -f -L 9230:localhost:9230 user@remote-server

# 使用 autossh 自动重连
autossh -M 0 -N -L 9230:localhost:9230 user@remote-server
```

### VSCode Remote SSH

如果使用 VSCode Remote SSH：

1. VSCode 会自动转发在远端打开的端口
2. 在远端启动 Bridge 后，端口会自动转发到本地
3. 无需手动设置 SSH 隧道

---

## 白名单规则

### 规则语法

| 模式 | 说明 | 示例 |
|------|------|------|
| 精确匹配 | 完整 URL | `https://example.com/page` |
| 域名通配 | `*.domain.com` | `*.github.com` |
| 路径通配 | `https://example.com/*` | `https://example.com/*` |
| 全通配 | `*` | `*`（允许所有，不推荐） |

### 规则示例

```json
[
  "https://github.com/*",
  "https://*.github.com/*",
  "https://example.com/app/*",
  "https://localhost:*/*"
]
```

### 注意事项

- 如果白名单为空，则允许所有 URL
- 规则区分大小写
- 导航到不在白名单的 URL 会被拦截

---

## 故障排除

### 问题 1：Extension 无法连接

**症状**: 点击 Connect 后状态显示「Error」

**排查步骤**:

1. 检查 Bridge Server 是否启动
   ```bash
   curl http://localhost:9230/health
   ```

2. 检查 SSH 端口转发是否正常
   ```bash
   nc -zv localhost 9230
   ```

3. 检查 Token 是否一致

4. 查看 Extension 控制台日志
   - `chrome://extensions/` → Service Worker

### 问题 2：Playwright MCP 连接失败

**症状**: MCP 报错 `Failed to connect to CDP endpoint`

**排查步骤**:

1. 确认 Extension 已连接（健康检查）
   ```bash
   curl http://localhost:9230/health
   # 应该显示 "extensionConnected": true
   ```

2. 检查 `/json/list` 是否返回目标
   ```bash
   curl http://localhost:9230/json/list
   ```

3. 确认 `--cdp-endpoint` 使用 `http://` 而不是 `ws://`

### 问题 3：CDP 命令执行失败

**症状**: 工具调用返回错误

**排查步骤**:

1. 检查 URL 是否在白名单中
2. 检查是否有 Tab 打开
3. 查看 Extension Service Worker 日志

### 查看日志

```bash
# Bridge Server 详细日志
LOG_LEVEL=debug node dist/cli.js --port 9230

# Extension 日志
# chrome://extensions/ → Playwright MVP → Service Worker
```

---

## 安全建议

### 1. 使用 Token 认证

```bash
# 生成随机 Token
TOKEN=$(openssl rand -hex 32)

# 启动时指定
node dist/cli.js --port 9230 --token $TOKEN
```

### 2. 限制监听地址

```bash
# 只监听本地（配合 SSH 隧道使用）
node dist/cli.js --port 9230 --host 127.0.0.1
```

### 3. 配置白名单

只添加必要的 URL，避免使用 `*`。

### 4. 使用 SSH 隧道

始终通过 SSH 端口转发访问 Bridge Server。

---

## 命令速查

| 命令 | 说明 |
|------|------|
| `pnpm install` | 安装所有依赖 |
| `pnpm build` | 构建所有包 |
| `pnpm dev:bridge` | 启动 Bridge（开发模式） |
| `pnpm start:bridge` | 启动 Bridge（生产模式） |
| `pnpm dev:extension` | 构建扩展（watch 模式） |
| `pnpm build:extension` | 构建 Chrome 扩展 |

---

## 附录

### 项目结构

```
playwright-mvp/
├── packages/
│   ├── shared/              # 共享类型和工具
│   ├── relay-server/        # CDP Bridge Server
│   │   └── src/
│   │       ├── cli.ts       # CLI 入口
│   │       ├── index.ts     # 服务主逻辑
│   │       └── config.ts    # 配置管理
│   └── extension/           # Chrome 扩展
│       └── src/
│           ├── background/  # Service Worker
│           └── ui/          # Popup/Options UI
├── docs/                    # 文档
├── .env.example             # 环境变量模板
└── package.json
```

### 与官方 Playwright MCP 的对比

| 特性 | 官方 CDP 直连 | Playwright MVP |
|------|---------------|----------------|
| 需要同机部署 | ✅ 是 | ❌ 否 |
| Token 验证 | ❌ 否 | ✅ 是 |
| URL 白名单 | ❌ 否 | ✅ 是 |
| 配置界面 | ❌ 无 | ✅ 扩展 UI |
| 连接方式 | 直连 Chrome 调试端口 | 通过扩展转发 |

### 相关链接

- [Playwright MCP 官方](https://github.com/microsoft/playwright-mcp)
- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
- [Chrome Extensions 文档](https://developer.chrome.com/docs/extensions/)

---

*文档版本: 2.0.0 | 最后更新: 2026-03-08*
