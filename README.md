# Playwright MVP - 跨机远程浏览器自动化

基于微软官方 Playwright MCP 的远程服务扩展版，打破 MCP 必须与浏览器同机运行的限制，实现远程开发机与本地调试机（物理机）之间的 Playwright 自动化通信。

## 🎯 项目简介

### 问题解决

原版 Playwright MCP 存在核心限制：**MCP 服务和 Chrome 浏览器必须在同一台机器上**。这限制了分布式调试场景。

Playwright MVP 通过以下方案解决：
- **中转服务 (Relay Server)**：部署在远端开发机，接收 MCP 命令并转发
- **Chrome 扩展**：运行在本地物理机，直接控制 Chrome 浏览器
- **SSH 端口转发**：建立安全通道连接两个网络隔离的环境

### 典型使用场景

```
远端开发机(腾讯云)         本地物理机(办公电脑)
CodeBuddy/Cursor   ←SSH→   Chrome Browser
        ↓                          ↑
  中转服务(中继)  ←WebSocket→  扩展插件
```

## 📦 系统架构

```
┌────────────────────────────────────────────────────────────────────┐
│  远端开发机（腾讯云 CVM 或其他云服务器）                             │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  AI IDE 客户端 (CodeBuddy / Cursor)                         │  │
│  │  - 调用 Playwright MCP 工具（browser_navigate 等）          │  │
│  └──────────────────┬──────────────────────────────────────────┘  │
│                     │ stdio                                        │
│  ┌──────────────────▼──────────────────────────────────────────┐  │
│  │  Playwright MCP (@playwright/mcp)                           │  │
│  │  - 标准 CDP 协议实现                                         │  │
│  │  - 连接中转服务                                             │  │
│  └──────────────────┬──────────────────────────────────────────┘  │
│                     │ WebSocket (TCP 9230)                         │
│  ┌──────────────────▼──────────────────────────────────────────┐  │
│  │  CDP Bridge Relay Server (本项目)                           │  │
│  │  - 接收 CDP 命令                                            │  │
│  │  - Token 身份验证                                           │  │
│  │  - 转发到扩展                                              │  │
│  │  - 返回执行结果                                            │  │
│  └──────────────────┬──────────────────────────────────────────┘  │
│                     │                                              │
└─────────────────────┼──────────────────────────────────────────────┘
                      │ SSH 端口转发
                      │ ssh -L 9230:localhost:9230 user@remote
                      │
┌─────────────────────▼──────────────────────────────────────────────┐
│  本地物理机（个人电脑 / 笔记本电脑）                                 │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  Chrome 浏览器                                               │ │
│  │  ┌────────────────────────────────────────────────────────┐ │ │
│  │  │  Playwright Bridge Chrome 扩展 (本项目)                │ │ │
│  │  │  - WebSocket 连接到中转服务                           │ │ │
│  │  │  - 接收 CDP 命令                                      │ │ │
│  │  │  - 直接操控浏览器标签页                               │ │ │
│  │  │  - 返回执行结果和事件                                 │ │ │
│  │  │  - 网站白名单检查                                     │ │ │
│  │  └────────────────────────────────────────────────────────┘ │ │
│  │  - 访问目标网站                                             │ │
│  │  - 执行导航、截图等自动化操作                             │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

## 🚀 快速开始

### 前置要求

- Node.js >= 18.0.0
- pnpm >= 8.0.0
- 远端服务器上有网络连接能力
- 本地电脑安装了 Chrome 浏览器

### 第 1 步：安装依赖

在工作目录根目录执行：

```bash
pnpm install
```

### 第 2 步：配置环境变量

复制并编辑 `.env` 文件：

```bash
# 位置：项目根目录下的 .env
RELAY_SERVER_PORT=9230              # 中转服务监听端口
RELAY_SERVER_HOST=0.0.0.0           # 中转服务绑定地址
RELAY_AUTH_TOKEN=your-token-here    # 认证 Token（见下文详细说明）
LOG_LEVEL=info                       # 日志级别
HEARTBEAT_INTERVAL=30000            # 心跳间隔（毫秒）
CONNECTION_TIMEOUT=60000            # 连接超时（毫秒）
```

### 第 3 步：启动中转服务（Relay Server）

#### 开发模式（带代码热重载）

在项目根目录执行：

```bash
pnpm dev:bridge
```

说明：
- 此命令在 `/playwright-mvp` 目录执行
- 会自动监听代码变化并重新加载
- 适合开发调试阶段

#### 生产模式（需要先编译）

```bash
# 第一次需要编译，或代码修改后重新编译
pnpm build:bridge

# 启动编译后的服务
pnpm start:bridge
```

说明：
- `pnpm build:bridge` 会将 TypeScript 代码编译到 `packages/relay-server/dist` 目录
- `pnpm start:bridge` 在项目根目录执行，会启动编译后的 Node.js 应用
- 启动成功后会输出端口号和 WebSocket 端点信息

### 第 4 步：本地配置与启动扩展

#### 开发模式（构建扩展）

在项目根目录执行：

```bash
pnpm dev:extension
```

或者直接构建：

```bash
pnpm build:extension
```

说明：
- 会输出到 `packages/extension/dist` 目录
- 若为开发模式，会监听文件变化并增量构建

#### 在 Chrome 中加载扩展

1. 打开 Chrome，访问 `chrome://extensions`
2. 开启「开发者模式」（右上角）
3. 点击「加载已解压的扩展程序」
4. 选择 `/data/tencent/playwright-mvp/packages/extension/dist` 目录
5. 扩展加载完毕，点击扩展图标进入配置

#### 扩展配置

点击扩展图标，进行以下配置：

**1. 中转服务连接**
- 服务地址：输入中转服务的地址和端口
  - 本地测试：`http://localhost:9230`
  - 远端服务（通过 SSH 端口转发）：`http://localhost:9230`

**2. Token 认证**
- Token：输入环境变量 `RELAY_AUTH_TOKEN` 的值
- 确保与服务器端的 Token 一致

**3. 网站白名单**
- 可选项，用于限制访问的网站
- 支持域名和 URL 模式匹配
- 详见「白名单配置」章节

## 📁 项目结构

```
playwright-mvp/                     # 项目根目录
├── packages/
│   ├── shared/                    # 共享代码包
│   │   ├── src/
│   │   │   ├── types/            # TypeScript 类型定义
│   │   │   ├── utils/            # 工具函数（URL 白名单匹配等）
│   │   │   └── logger/           # 日志工具
│   │   └── dist/                 # 编译产物
│   │
│   ├── relay-server/              # CDP 中转服务（部署在远端）
│   │   ├── src/
│   │   │   ├── index.ts          # 主服务文件
│   │   │   ├── config.ts         # 配置管理
│   │   │   ├── cli.ts            # 命令行入口
│   │   │   └── ...
│   │   ├── dist/                 # 编译产物
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── extension/                 # Chrome 扩展（部署在本地）
│       ├── src/
│       │   ├── background/       # Service Worker 逻辑
│       │   │   ├── index.ts      # 主业务逻辑
│       │   │   ├── whitelist.ts  # 白名单检查
│       │   │   ├── cdp-handler.ts # CDP 命令处理
│       │   │   └── relay-connection.ts # WebSocket 连接
│       │   ├── ui/
│       │   │   ├── options/      # 扩展选项页面
│       │   │   │   └── components/TokenConfig.vue # Token 配置
│       │   │   │   └── components/WhitelistConfig.vue # 白名单配置
│       │   │   └── popup/        # 扩展 Popup 页面
│       │   ├── manifest.json     # 扩展清单
│       │   └── ...
│       ├── dist/                 # 构建产物
│       └── package.json
│
├── docs/                          # 文档
│   ├── target.md                 # 设计目标
│   └── debugging.md              # 调试指南
├── .env                          # 环境变量配置
├── .env.example                  # 环境变量示例
├── package.json                  # 根工作区配置
├── pnpm-workspace.yaml           # pnpm 工作区定义
├── tsconfig.base.json            # TypeScript 基础配置
└── README.md                     # 本文件
```

## 🔧 详细配置说明

### 环境变量配置

编辑项目根目录下的 `.env` 文件：

| 变量名 | 说明 | 默认值 | 示例 |
|--------|------|--------|------|
| `RELAY_SERVER_PORT` | 中转服务监听端口 | 9230 | 9230 |
| `RELAY_SERVER_HOST` | 中转服务绑定地址 | 0.0.0.0 | 0.0.0.0 (所有网卡) / 127.0.0.1 (本地) |
| `RELAY_AUTH_TOKEN` | 身份验证 Token（生产必须） | - | `kls6e3EbaMEzQybLT2PcyLtCJ92ajWzB` |
| `LOG_LEVEL` | 日志级别 | info | debug / info / warn / error / trace |
| `HEARTBEAT_INTERVAL` | 心跳间隔（毫秒） | 30000 | 30000 |
| `CONNECTION_TIMEOUT` | 连接超时（毫秒） | 60000 | 60000 |

### Token 认证详细说明

#### 为什么需要 Token？

Token 是一个共享密钥，用于防止未授权的客户端连接到中转服务。在生产环境中，**必须设置强随机的 Token**。

#### Token 设置步骤

**1. 生成强随机 Token**

使用以下命令生成 32 字符的随机 Token：

```bash
# 在 Linux/Mac 上
openssl rand -base64 24

# 或使用 Python
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

**2. 配置服务器端**

编辑 `.env` 文件：

```env
RELAY_AUTH_TOKEN=your-generated-token-here
```

**3. 配置扩展端**

在 Chrome 扩展选项页面输入相同的 Token。

#### Token 验证流程

1. 扩展启动时，发送 WebSocket 连接到中转服务
2. 中转服务暂停连接，等待 Token 认证
3. 扩展发送 `{ action: "auth", token: "your-token" }`
4. 服务器验证 Token 是否匹配
5. 匹配则建立连接，不匹配则拒绝连接

#### 注意事项

- **生产环境必须启用 Token**：避免任何人都能连接到服务
- **Token 要保密**：不要在代码中硬编码，使用环境变量
- **定期轮换**：建议每 3-6 个月更换一次 Token
- **无认证模式**：如果 `RELAY_AUTH_TOKEN` 为空，任何客户端都可以连接（仅用于本地测试）

### 网站白名单配置

#### 为什么需要白名单？

白名单用于限制自动化脚本只能访问特定的网站，防止意外访问不安全或不想要的网站。

#### 白名单格式

在 Chrome 扩展选项页面配置，支持两种格式：

**1. 域名模式**

```
*.example.com      # 匹配 example.com 及其所有子域名
*.baidu.com        # 匹配 baidu.com 及其所有子域名
localhost          # 精确匹配本地
```

**2. URL 前缀模式**

```
https://github.com/  # 仅允许 https://github.com/* 下的 URL
http://localhost:3000/api  # 允许特定路径
```

#### 使用示例

假设要限制脚本只能访问 Baidu 和 GitHub：

```
*.baidu.com
github.com
*.github.io
```

#### 白名单检查原理

1. 在扩展的 `background/whitelist.ts` 中实现
2. 每次执行导航命令（`Page.navigate`）前检查
3. 如果 URL 不在白名单中，返回错误
4. **空白名单表示允许所有网站**（仅用于测试）

#### 启用/禁用白名单

- 白名单为空时：允许所有网站
- 白名单有内容时：只允许白名单中的网站
- 通过扩展 UI 动态修改白名单，无需重启服务

## 🎮 使用 Playwright MCP 工具

安装完成后，在 CodeBuddy/Cursor 中就可以使用 Playwright MCP 提供的浏览器自动化工具：

### 常见工具

| 工具 | 说明 | 示例 |
|------|------|------|
| `browser_navigate` | 导航到指定 URL | `browser_navigate("https://example.com")` |
| `browser_take_screenshot` | 截图当前页面 | `browser_take_screenshot()` |
| `browser_click` | 点击页面元素 | `browser_click("button.submit")` |
| `browser_fill_form` | 填充表单 | `browser_fill_form([{"selector": "input", "value": "text"}])` |
| `browser_evaluate` | 执行 JavaScript | `browser_evaluate("document.title")` |
| `browser_wait_for` | 等待元素出现 | `browser_wait_for("text=Loading")` |

### 工具链调用示例

```python
# 这是 Python 伪代码示例，实际使用通过 MCP 工具调用
1. browser_navigate("https://example.com")  # 导航到网站
2. browser_wait_for("text=Login")           # 等待登录表单加载
3. browser_fill_form([
     {"selector": "input#username", "value": "user"},
     {"selector": "input#password", "value": "pass"}
   ])                                        # 填充表单
4. browser_click("button.login")             # 点击登录按钮
5. browser_wait_for("text=Dashboard")       # 等待登录完成
6. browser_take_screenshot()                 # 截图
```

## 🔍 故障排查

### 常见问题

#### 1. 扩展无法连接到中转服务

**症状**：扩展显示「未连接」红色状态

**排查步骤**：

```bash
# 1. 检查中转服务是否正在运行
netstat -tlnp | grep 9230

# 2. 检查防火墙
# Linux 上允许 9230 端口
sudo ufw allow 9230/tcp

# 3. 检查 .env 配置
cat .env | grep RELAY_

# 4. 查看服务日志
# 开发模式下会直接输出到控制台
# 生产模式下查看日志文件
tail -f logs/*.log
```

**解决方案**：
- 确保中转服务已启动：`pnpm start:bridge`
- 确保端口未被占用
- 检查防火墙规则允许该端口
- 验证 Token 配置一致

#### 2. Token 认证失败

**症状**：错误 "Auth failed" 或 "Auth timeout"

**排查步骤**：

```bash
# 1. 检查服务端 Token 配置
grep RELAY_AUTH_TOKEN .env

# 2. 确认扩展中输入的 Token 与服务端一致
# 在扩展选项页面查看
```

**解决方案**：
- 确保两端 Token 完全一致
- Token 区分大小写
- 复制粘贴时注意不要包含空格

#### 3. 白名单阻止访问

**症状**：脚本执行导航命令时被拒绝

**解决方案**：
- 检查扩展中的白名单设置
- 确保目标 URL 域名在白名单中
- 暂时清空白名单测试（仅用于开发）

#### 4. 扩展找不到标签页

**症状**：执行操作时出现 "No tab connected" 错误

**排查步骤**：

```bash
# 查看中转服务日志
# 开发模式下实时输出
pnpm dev:bridge

# 查看是否有标签页已附加
# 日志中会输出: "已附加到 Tab"
```

**解决方案**：
- 确保 Chrome 中有打开的标签页
- 重启扩展：在 `chrome://extensions` 中禁用再启用
- 清除扩展数据：`chrome://extensions` → 详情 → 清除数据

### 调试模式

启用详细日志输出：

```bash
# 编辑 .env
LOG_LEVEL=debug    # 或 trace（更详细）

# 或通过命令行临时设置
LOG_LEVEL=debug pnpm start:bridge
```

调试日志会输出：
- 所有 WebSocket 消息
- CDP 命令的参数和结果
- 扩展和服务间的通信过程

## 📚 核心命令参考

### 工作区根目录命令

所有以下命令都在项目根目录 `/data/tencent/playwright-mvp` 执行：

```bash
# 开发调试
pnpm dev:bridge          # 开发模式启动中转服务（带热重载）
pnpm dev:extension       # 开发模式构建扩展（带热重载）

# 生产编译
pnpm build               # 编译所有包
pnpm build:bridge        # 仅编译中转服务
pnpm build:extension     # 仅编译扩展

# 生产运行
pnpm start:bridge        # 启动已编译的中转服务

# 维护
pnpm lint                # 代码检查
pnpm clean               # 清理编译产物
```

### 编译与运行流程

#### 完整的生产部署流程

```bash
# 1. 安装依赖（第一次或有新依赖时）
pnpm install

# 2. 构建所有包
pnpm build

# 3. 启动中转服务（后台运行）
nohup pnpm start:bridge > relay-server.log 2>&1 &

# 4. 构建并加载扩展到本地 Chrome（手动操作）
# a. 执行编译
pnpm build:extension

# b. 在 Chrome 中加载 packages/extension/dist 目录

# 5. 配置并测试
# 在扩展中输入服务地址和 Token
```

#### 开发调试流程

```bash
# 终端 1：启动中转服务（开发模式）
pnpm dev:bridge

# 终端 2：构建扩展（开发模式）
pnpm dev:extension

# 此时 packages/extension/dist 会自动更新
# 在 Chrome 中按 F5 刷新扩展，加载最新代码
```

## 🌐 远程部署指南

### 部署到云服务器

#### 1. SSH 端口转发

在本地电脑上建立 SSH 隧道，将远端服务转发到本地：

```bash
# 打开一个新终端窗口，持续运行此命令
ssh -L 9230:localhost:9230 user@remote-server-ip
```

说明：
- 将远端的 `localhost:9230` 转发到本地的 `localhost:9230`
- 保持此连接打开，中转才能正常工作
- 关闭此连接后转发停止

#### 2. 扩展配置

在扩展选项中配置：

```
服务地址: http://localhost:9230
Token: 与服务器端 .env 中的 RELAY_AUTH_TOKEN 一致
```

#### 3. 测试连接

```bash
# 在远端服务器上
curl http://localhost:9230/health

# 输出示例
{
  "status": "waiting_extension",
  "version": "1.0.0",
  "uptime": 120,
  "extensionConnected": false,
  "playwrightConnected": false,
  "activeSessions": 0
}
```

### 生产环境最佳实践

1. **安全性**
   - 使用强随机 Token（至少 32 个字符）
   - 启用 HTTPS（使用 nginx 反向代理）
   - 限制防火墙，只开放给特定 IP

2. **可靠性**
   - 使用进程管理工具（PM2、systemd 等）保证服务始终运行
   - 定期检查服务状态：`curl http://localhost:9230/health`
   - 配置日志文件保存和轮转

3. **性能**
   - 调整 `HEARTBEAT_INTERVAL` 和 `CONNECTION_TIMEOUT`
   - 根据使用情况调整日志级别（生产用 `info` 或 `warn`）

## 📄 License

MIT
