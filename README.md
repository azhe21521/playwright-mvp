# Playwright MVP

基于微软官方 Playwright MCP 的远程服务扩展版，实现远程开发机与本地调试机之间的 Playwright 通信。

## 🎯 项目简介

Playwright MVP 解决了原版 Playwright MCP 的核心限制：**MCP 服务和 Chrome 浏览器必须在同一台机器上**。通过中转服务和 Chrome 扩展插件，实现跨机器的 Playwright 自动化调试。

## 📦 架构

```
┌─────────────────────────────────────────────────────────────┐
│  远端开发机                                                  │
│                                                             │
│  CodeBuddy/Cursor                                           │
│       ↓ (stdio)                                             │
│  Playwright MCP (@playwright/mcp)                           │
│       ↓ (WebSocket)                                         │
│  中转服务 (Relay Server)                                     │
└─────────────────────────────────────────────────────────────┘
                    ↓ SSH 端口转发
┌─────────────────────────────────────────────────────────────┐
│  本地物理机                                                  │
│                                                             │
│  Chrome 扩展 → 目标网页                                      │
└─────────────────────────────────────────────────────────────┘
```

## 🚀 快速开始

### 前置要求

- Node.js >= 18.0.0
- pnpm >= 8.0.0

### 安装依赖

```bash
pnpm install
```

### 开发模式

```bash
# 启动中转服务
pnpm dev:relay

# 构建扩展（watch 模式）
pnpm dev:extension
```

### 生产构建

```bash
pnpm build
```

## 📁 项目结构

```
playwright-mvp/
├── packages/
│   ├── shared/          # 共享类型和工具
│   ├── relay-server/    # 中转服务
│   └── extension/       # Chrome 扩展
├── docs/                # 文档
└── keys/                # 扩展发布密钥（不入库）
```

## 🔧 配置说明

### 中转服务配置

复制 `.env.example` 为 `.env`，配置以下环境变量：

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `RELAY_SERVER_PORT` | 服务端口 | 3000 |
| `RELAY_AUTH_TOKEN` | 身份验证 Token | - |
| `LOG_LEVEL` | 日志级别 | info |

### Chrome 扩展配置

1. 在 Chrome 扩展管理页面加载 `packages/extension/dist` 目录
2. 点击扩展图标，配置中转服务地址和 Token

## 📄 License

MIT
