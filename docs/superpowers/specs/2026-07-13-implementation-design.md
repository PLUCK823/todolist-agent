# Agent TodoList 实施设计文档

> 基于已批准开发计划的技术决策记录

**日期：** 2026-07-13

---

## 1. 版本决策

| 技术 | 原文档目标 | 实际采用 | 原因 |
|------|-----------|---------|------|
| React | 18 | **19.2.7** | 以项目脚手架为准 |
| TypeScript | 5.x | **~6.0** | 以项目脚手架为准 |
| Vite | 5.x | **8.1.1** | 以项目脚手架为准 |
| Go | - | **1.26.5** | 以项目 go.mod 为准 |
| TailwindCSS | 3.x | **4.x** | 最新版，CSS-first 配置更简洁 |
| TailwindCSS 配置 | tailwind.config.js | **@tailwindcss/vite plugin** | v4 不需要 JS 配置文件 |

---

## 2. 开发顺序

1. **阶段 1：基础设施** — 目录骨架、依赖安装、配置调通
2. **阶段 2：后端+前端并行** — 多 Agent，TDD 驱动
3. **阶段 3：前后端联调** — 替换 mock 为真实 API
4. **阶段 4：Agent 服务** — TDD 驱动
5. **阶段 5：集成 + DevOps** — 全链路 + Docker

## 3. TDD 策略

每层 Red → Green → Refactor：

| 层 | 测试工具 | Mock 策略 |
|---|---------|----------|
| Go model | `testing` + `testify` | 直接测试 |
| Go repository | `testing` + `testify` | SQLite 内存库 |
| Go service | `testing` + `testify` | mock repository |
| Go handler | `httptest` | mock service |
| React 组件 | Vitest + RTL | MSW |
| React hooks | Vitest + `renderHook` | MSW |
| Python tools | pytest + pytest-httpx | mock HTTP |
| Python agent | pytest | mock LLM + mock tools |
| Python API | FastAPI TestClient | mock agent |

覆盖率目标：每层 ≥ 80%

---

## 4. API 契约摘要

基础路径 `/api`，统一响应格式 `{code, message, data}`。

**7 个 CRUD 端点：**
- `GET /api/todos` — 列表（分页、筛选、排序、搜索）
- `GET /api/todos/:id` — 单条
- `POST /api/todos` — 创建（201）
- `PUT /api/todos/:id` — 更新
- `DELETE /api/todos/:id` — 删除（204）
- `PATCH /api/todos/:id/complete` — 完成
- `PATCH /api/todos/:id/uncomplete` — 取消完成

**Agent 端点：**
- `POST /api/agent/chat` — 同步对话
- `WS /api/agent/stream` — 流式推送
- `GET /api/agent/history` — 历史
- `DELETE /api/agent/history` — 清除历史

详见 [API.md](../API.md)

---

## 5. 数据库

PostgreSQL 16，两张表（todos、conversations），`pg_trgm` 扩展用于标题模糊搜索。`data/init.sql` 已生成。

---

## 6. 前端架构

```
src/
  types/todo.ts           — TypeScript 类型
  services/todoApi.ts     — Axios 封装（7 CRUD）
  services/agentApi.ts    — Agent WebSocket 客户端
  mocks/handlers.ts       — MSW mock API
  hooks/useTodos.ts       — React Query hooks
  hooks/useDebounce.ts    — 防抖 hook
  components/
    layout/AppShell.tsx        — 三栏布局
    layout/NavigationRail.tsx  — 左侧导航
    layout/AgentPanel.tsx      — 右侧 Agent 面板
    todo/TaskDashboard.tsx     — 主工作区
    todo/TaskCard.tsx          — 任务卡片
    todo/TaskDialog.tsx        — 创建/编辑弹窗
    todo/FilterPopover.tsx     — 筛选浮层
    common/ConfirmDialog.tsx   — 确认弹窗
    common/ToastRegion.tsx     — 通知
    common/CommandPalette.tsx  — Cmd+K 面板
  pages/                  — 5 个页面
```

路由：`/tasks`（默认）、`/upcoming`、`/assistant`、`/profile`、`/login`、`/register`

V6 原型对标文件：`.superpowers/brainstorm/40507-1783945975/content/workspace-full-flow-v6.html`

---

## 7. 后端架构

```
cmd/server/main.go                   — 入口
internal/
  model/todo.go                       — GORM model
  repository/todo_repo.go             — 数据库操作
  service/todo_service.go             — 业务逻辑
  handler/todo_handler.go             — HTTP handler
  middleware/cors.go                  — CORS
  middleware/logger.go                — Zap 日志
  database/db.go                      — DB 连接
```

---

## 8. Agent 架构

```
agent-service/
  app/main.py             — FastAPI + WebSocket
  app/agent.py            — LangGraph React Agent
  app/tools.py            — 6 个 tool 函数
  app/prompts.py          — 系统提示词
  app/schemas.py          — Pydantic 模型
  pyproject.toml
```

Agent 不直接操作数据库，通过调用后端 CRUD API 完成任务。
