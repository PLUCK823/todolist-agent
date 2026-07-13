# CLAUDE.md

## 项目概述

Agent TodoList 是一款融合 AI 自然语言交互的智能待办事项管理应用。用户既可以通过传统界面管理任务，也能像聊天一样用自然语言告诉 AI 助手来操作待办事项。

## 项目文档

项目文档统一存放在 `docs/` 目录下，在开发和决策过程中应优先参考这些文档：

### [架构文档](docs/ARCHITECTURE.md)

**用途：系统设计的蓝图。** 描述了项目的整体架构，包括简化版和复杂版两种方案。当你需要理解系统各层之间如何通信、技术选型依据、接口设计规范或部署架构时，参考此文档。主要包含：

- Mermaid 架构图（简化版 / 复杂版）
- 技术栈说明（前端 / 后端 / AI / 基础设施）
- REST API 接口设计（CRUD + Agent 通信）
- 数据流说明（传统模式 / Agent 模式 / 事件驱动模式）
- 部署建议与架构选择指南

### [产品需求文档 (PRD)](docs/PRD.md)

**用途：做什么、为谁做的定义。** 定义了产品的功能范围、目标用户和成功标准。当你需要确认某个功能是否在范围内、理解用户故事和验收标准、评估优先级时，参考此文档。主要包含：

- 产品愿景与核心价值主张
- 目标用户画像与痛点分析
- 功能需求分级（P0 核心 / P1 扩展 / P2 未来）
- 用户故事与验收标准
- 非功能需求（性能 / 可用性 / 安全性 / 兼容性）
- 里程碑规划（7 周 MVP 路线图）

### [代码编写工作流程](docs/WORKFLOW.md)

**用途：怎么做的操作手册。** 定义了从需求到代码到部署的完整开发流程。包含各技术栈的具体代码示例和最佳实践。当你需要了解开发规范、某个模块的编码模式、测试方法或部署步骤时，参考此文档。主要包含：

- 环境搭建指南（工具版本 / 环境变量 / Docker Compose）
- 项目目录结构详解
- 各层开发工作流：
  - **后端 (Golang)**：model → repository → service → handler 分层架构
  - **前端 (React + TypeScript)**：类型定义 → API 封装 → Hook → 组件 → 页面
  - **Agent (Python + LangChain)**：工具定义 → 提示词 → Agent 引擎 → WebSocket 接口
- 测试规范与代码审查清单
- 部署流程（Docker Compose / Nginx 反向代理）
- 常见问题排查指南

### [API 接口文档](docs/API.md)

**用途：前后端联调的契约。** 定义了所有 REST API 和 WebSocket 接口的请求/响应格式、参数说明和错误码。当你需要查询接口字段、理解返回格式或排查联调问题时，参考此文档。主要包含：

- 通用响应规范（成功/错误/分页格式）
- 待办 CRUD 接口（GET/POST/PUT/DELETE/PATCH 共 7 个端点）
- Agent 通信接口（HTTP 聊天 / WebSocket 流式推送 / 对话历史管理）
- 完整的错误码表（业务错误 / 系统错误 / 第三方错误）

### [数据库设计文档](docs/DATABASE.md)

**用途：数据层的权威定义。** 定义了 PostgreSQL 的表结构、索引策略和迁移规范。当你需要新增字段、优化查询或编写迁移脚本时，参考此文档。主要包含：

- 表结构 DDL（todos / conversations）
- ER 图
- 索引设计（含 trigram 模糊搜索索引）
- 迁移规范（命名 / 可逆性 / 禁止事项）
- 完整的数据字典

### [Agent 提示词文档](docs/AGENT_PROMPT.md)

**用途：Agent 行为的核心控制。** 定义了系统提示词、工具 docstring 规范和调优方法。当你需要调整 Agent 行为、增加新工具或排查意图理解偏差时，参考此文档。主要包含：

- 三层提示词架构（系统提示词 / 工具描述 / 对话上下文）
- 当前版本系统提示词全文
- 工具 Docstring 模板与规范
- 调优指南（常见问题 → 修复方向）
- 版本记录与迭代计划

### [部署指南](docs/DEPLOY.md)

**用途：让项目跑在生产环境。** 定义了从代码到线上运行的全部步骤。当你需要部署新版本、配置 Nginx HTTPS、设置备份策略或排查线上问题时，参考此文档。主要包含：

- 服务器要求与软件依赖
- Docker Compose 一键部署 / 更新 / 回滚
- 手动部署（systemd 管理后端进程）
- Nginx 反向代理 + HTTPS（Let's Encrypt）
- 健康检查、监控脚本、备份与恢复

### [项目开发状态](docs/STATUS.md)

**用途：一眼看清项目进度。** 记录了每个模块和具体任务的完成状态、对应 PRD 需求和里程碑进度。当你需要了解当前进展、认领待办任务或向团队汇报时，参考此文档。主要包含：

- 五大模块总体进度表
- 详细任务清单（文档 15 项 / 后端 12 项 / 前端 15 项 / Agent 8 项 / DevOps 5 项）
- 里程碑进度追踪
- 阻塞项记录

### [UI 原型设计文档](docs/superpowers/specs/2026-07-13-agent-todolist-prototype-design.md)

**用途：前端界面的高保真蓝图。** 定义了 6 个页面的布局、交互细节、弹窗规范和 Agent 多步执行状态。当你需要实现前端组件、确定交互行为或设计评审时，参考此文档。主要包含：

**视觉与交互基准：** [V6 可交互页面原型](.superpowers/brainstorm/40507-1783945975/content/workspace-full-flow-v6.html)。任何 AI 编程工具实现 UI 前都应同时阅读设计文档和该原型源文件。

- 全局布局（左侧导航 / 主工作区 / Agent 侧栏）
- 页面设计（我的任务 / 近期安排 / 智能助手 / 个人资料 / 登录注册）
- 弹窗与浮层规格（任务弹窗 / 筛选浮层 / 快捷 Agent 输入 / 头像设置）
- Agent 多步执行状态（理解意图 → 调用接口 → 等待响应 → 同步 → 完成/失败）
- 动效规范与可用性要求（`prefers-reduced-motion`）
- 组件拆分建议（12 个核心组件）

## 技术栈

| 层 | 技术 | 版本 |
| ------ | ----- | ------ |
| 前端 | React + TypeScript + Vite + TailwindCSS | React 18 / TS 5 |
| 后端 | Golang + Gin + GORM | Go 1.21+ |
| Agent | Python + FastAPI + LangChain + LangGraph | Python 3.10+ |
| 数据库 | PostgreSQL + Redis | PG 16 / Redis 7 |
| 部署 | Docker + Docker Compose + Nginx | — |

## 项目结构

```text
agent-todolist/
├── frontend/              # React 前端
├── backend/               # Golang 后端
├── agent-service/         # Python Agent 服务
├── data/                  # 数据库初始化脚本
├── docs/                  # 项目文档
│   ├── ARCHITECTURE.md    # 架构文档
│   ├── PRD.md             # 产品需求文档
│   ├── WORKFLOW.md        # 代码编写工作流程
│   ├── API.md             # API 接口文档
│   ├── DATABASE.md        # 数据库设计文档
│   ├── AGENT_PROMPT.md    # Agent 提示词文档
│   ├── DEPLOY.md          # 部署指南
│   ├── STATUS.md          # 项目开发状态
│   └── superpowers/       # Superpowers 相关文档
│       └── specs/
│           └── ...-prototype-design.md  # UI 原型设计
├── .superpowers/          # V6 可交互设计原型（非生产代码）
├── docker-compose.yml     # 开发环境编排
├── .env.example           # 环境变量模板
├── .gitignore
├── README.md
└── CLAUDE.md
```

## 常用命令

```bash
# === 启动全部服务 ===
docker-compose up -d

# === 后端 ===
cd backend
go run cmd/server/main.go          # 启动开发服务器 (:8080)
go test ./internal/... -v -cover   # 运行测试 + 覆盖率
curl -X POST localhost:8080/api/todos \
  -H 'Content-Type: application/json' \
  -d '{"title":"测试待办"}'

# === 前端 ===
cd frontend
pnpm install && pnpm dev           # 启动开发服务器 (:3000)
pnpm build                         # 生产构建
pnpm test                          # 运行测试

# === Agent ===
cd agent-service
uv sync                                         # 安装依赖
uv run uvicorn app.main:app --reload --port 8000  # 启动 Agent (:8000)
uv run pytest tests/ -v                         # 运行测试
```

## 核心概念速查

### 双模式交互

- **传统模式**：前端 → HTTP → Golang 后端 → PostgreSQL → 响应 → 更新 UI
- **Agent 模式**：前端 → WebSocket → Python Agent（理解意图 → 调用工具 → 调用后端 API）→ 流式推送 → 前端显示

### 后端分层

```text
handler（参数校验/响应格式化） → service（业务逻辑） → repository（数据库操作）
```

### Agent 工具

Agent 通过 LangChain 工具函数调用后端的标准 CRUD API，本身不直接操作数据库。每个工具函数有完整的 docstring 供 LLM 理解用途。
