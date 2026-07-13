# Agent TodoList

融合 AI 自然语言交互的智能待办事项管理应用 — 用传统界面管理任务，或像聊天一样用自然语言告诉 AI 助手来操作。

## 两种交互模式

| 模式 | 说明 | 适用场景 |
|------|------|---------|
| **传统模式** | 标准 CRUD 表单操作界面 | 快速管理任务，无需学习 |
| **Agent 模式** | 自然语言聊天，AI 理解意图并执行 | 想法来了直接说，不用填表 |

## 快速开始

```bash
# 1. 克隆仓库
git clone <repo-url> && cd agent-todolist

# 2. 复制环境变量
cp .env.example .env
# 编辑 .env，填入 LLM API Key

# 3. 一键启动
docker-compose up -d

# 4. 访问
# 前端: http://localhost:3000
# 后端 API: http://localhost:8080
# Agent 服务: http://localhost:8000
```

## 技术栈

| 层 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript + Vite + TailwindCSS |
| 后端 | Go 1.21+ / Gin / GORM |
| Agent | Python 3.10+ / FastAPI / LangChain / LangGraph |
| 数据库 | PostgreSQL 16 + Redis 7 |
| 部署 | Docker + Docker Compose + Nginx |

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
│   └── superpowers/specs/ # UI 原型设计规格
├── .superpowers/          # 可交互设计原型（非生产代码）
├── docker-compose.yml     # 服务编排
├── .env.example           # 环境变量模板
├── .gitignore
├── README.md
└── CLAUDE.md
```

## 文档导航

| 文档 | 用途 | 适合谁 |
|------|------|--------|
| [PRD](docs/PRD.md) | 产品需求定义 | 所有人 |
| [UI 原型设计](docs/superpowers/specs/2026-07-13-agent-todolist-prototype-design.md) | 界面高保真蓝图 | 前端 / 设计 |
| [V6 可交互原型](.superpowers/brainstorm/40507-1783945975/content/workspace-full-flow-v6.html) | 可运行的视觉与交互基准 | 前端 / 设计 / AI 工具 |
| [架构文档](docs/ARCHITECTURE.md) | 系统设计蓝图 | 开发者 |
| [工作流程](docs/WORKFLOW.md) | 代码编写手册 | 开发者 |
| [API 文档](docs/API.md) | 接口规范 | 前后端联调 |
| [数据库设计](docs/DATABASE.md) | 表结构与迁移 | 后端 |
| [Agent 提示词](docs/AGENT_PROMPT.md) | 提示词调优 | Agent 开发者 |
| [部署指南](docs/DEPLOY.md) | 部署步骤 | DevOps |
| [开发状态](docs/STATUS.md) | 进度追踪 | 所有人 |

## License

MIT
