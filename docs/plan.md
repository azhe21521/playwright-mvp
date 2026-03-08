# Playwright MVP 实施计划

## 产品概述

基于微软官方开源的 Playwright MCP 进行二次开发，构建一个**中转服务 + Chrome 扩展插件**系统，打通远程开发机与本地调试机的 Playwright 通信限制。

## 核心功能

### 1. 中转服务 (Relay Server)

- 运行在可被远端和本地访问的位置（通过 SSH 端口转发）
- 接收来自远端 MCP 服务的 WebSocket 连接
- 转发请求到本地 Chrome 扩展

### 2. Chrome 扩展插件 (Extension)

- **Token 身份验证**: 与远端 MCP 服务之间进行身份校验，token 支持动态更改
- **双向通信**: 实现与远端 MCP 服务的实时双向通信
- **白名单管控**: 仅允许访问白名单内的网址，其他网址一律拦截
- **健康监控面板**: 查看远端 MCP 的连接状态、可用 tools 列表及简介
- **配置管理界面**: 可视化配置白名单、token 等参数
- **可发布**: 提供私钥文件支持插件发布到 Chrome Web Store

## 通信架构

```
┌─────────────────────────────────────────────────────────────┐
│  远端开发机                                                  │
│                                                             │
│  CodeBuddy/Cursor                                           │
│       ↓ (stdio/进程内通信)                                   │
│  Playwright MCP 服务 (@playwright/mcp) [原版，不改动]        │
│       ↓ (WebSocket ws://localhost:3000)                     │
│  中转服务 (Relay Server) [监听 :3000]                        │
└─────────────────────────────────────────────────────────────┘
                    ↓ SSH 端口转发 (VSCode: 3000 → 3000)
┌─────────────────────────────────────────────────────────────┐
│  本地物理机                                                  │
│                                                             │
│  Chrome 扩展 → ws://localhost:3000 (实际连到远端中转服务)    │
│       ↓ CDP (Chrome DevTools Protocol)                      │
│  目标网页                                                    │
└─────────────────────────────────────────────────────────────┘
```

**说明**：

- MCP 服务和中转服务都运行在**远端开发机**
- 使用 VSCode SSH 端口转发，本地 Chrome 扩展连接 `localhost:3000` 实际会转发到远端
- 原版 Playwright MCP 不需要改动，只需配置连接到中转服务即可

## 技术栈

| 组件 | 技术选型 |
| --- | --- |
| 中转服务 | Node.js + TypeScript + Express + ws |
| Chrome 扩展 | TypeScript + **Vue 3** + Vite + Manifest V3 |
| 参数校验 | Zod |
| 通信协议 | WebSocket + JSON-RPC |
| 构建工具 | pnpm + monorepo |


## 实现方案

### 整体架构

采用 **monorepo** 结构管理三个核心包：

1. `packages/relay-server` - 中转服务
2. `packages/extension` - Chrome 扩展插件
3. `packages/shared` - 共享类型定义和工具函数

### 核心技术决策

**1. WebSocket 双向通信**

- 中转服务同时作为 WebSocket Server（面向扩展）和 WebSocket Client Proxy（面向远端 MCP）
- 使用 JSON-RPC 2.0 协议规范消息格式，便于扩展和调试

**2. Token 身份验证机制**

- 扩展连接中转服务时携带 Token 进行握手验证
- Token 存储在 `chrome.storage.local`，支持用户随时更改
- 中转服务维护已验证连接的 Session 映射

**3. 白名单拦截实现**

- 使用 `chrome.webRequest.onBeforeRequest` API 拦截请求
- 在 CDP 命令执行前校验目标 URL
- 白名单规则支持通配符匹配（如 `*.example.com`）

**4. 健康检查与 Tools 发现**

- 定义 `getHealth` 和 `listTools` 协议方法
- 扩展定期发送心跳，中转服务响应健康状态和 tools 列表

## 目录结构

```
playwright-mvp/
├── packages/
│   ├── relay-server/          # 中转服务
│   ├── extension/             # Chrome 扩展插件
│   └── shared/                # 共享类型和工具
├── docs/                      # 文档
├── keys/                      # 扩展发布密钥（不入库）
├── package.json               # 根配置
├── pnpm-workspace.yaml        # workspace 配置
├── tsconfig.base.json         # 基础 TS 配置
├── .env.example               # 环境变量示例
└── README.md                  # 项目说明
```

## 快速开始

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

### 加载扩展

1. 在 Chrome 地址栏输入 `chrome://extensions/`
2. 开启 "开发者模式"
3. 点击 "加载已解压的扩展程序"
4. 选择 `packages/extension/dist` 目录

## 配置说明

### 中转服务配置

复制 `.env.example` 为 `.env`，配置以下环境变量：

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `RELAY_SERVER_PORT` | 服务端口 | 3000 |
| `RELAY_AUTH_TOKEN` | 身份验证 Token | - |
| `LOG_LEVEL` | 日志级别 | info |

### Chrome 扩展配置

1. 点击扩展图标，进入配置页面
2. 配置中转服务地址和 Token
3. 设置白名单规则
