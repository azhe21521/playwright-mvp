# CLAUDE.md - 基于playwright的远程服务扩展版本

## 项目概述

**项目名称**: playwright-mvp
**技术栈**: Node.js + TypeScript

本项目是基于微软官方开源的playwright的二次开发版本，旨在打通远程开发机与本地调试机的playwright通信限制。

## 规则文件

详细规范见 `.claude/rules/` 目录:

- **代码规范**: [.claude/rules/coding-style.md](.claude/rules/coding-style.md) — 语言规范、编码习惯、文件组织
- **安全规则**: [.claude/rules/security.md](.claude/rules/security.md) — 密钥管理、接口安全、编码安全

## 项目文档

**Context 文档位置**: `./docs/`


## 核心业务流程

### 中转服务+扩展服务（插件）

- **目标**: 通过中转服务+扩展服务（插件）实现远程开发机与本地调试机的playwright通信限制[./docs/target.md](./docs/target.md) — 设计方案、预期目标


## Plan Mode

- 对于任何非 trivial 的改动（涉及 3 个以上文件，或有架构变更），先进入 Plan Mode 分析，输出方案让用户确认后再执行。

## Compact Instructions

使用 `/compact` 时：

**保留**：

- 所有架构决策和 API 变更
- 测试命令和测试结果
- 已修改的文件列表和关键 diff

**丢弃**：

- 冗长的日志输出
- 探索性搜索的死胡同
- 文件读取的原始内容（可以重新读）

