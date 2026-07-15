# Agent TodoList

融合传统待办界面与 AI 自然语言操作的全栈 MVP。用户可以直接创建、筛选和安排任务，也可以通过右侧 Agent、独立助手页或快捷输入框让 Agent 执行任务操作。

## 当前交付范围

- React 前端：任务、近期安排、智能助手、个人资料、登录和注册六个页面，以及任务、筛选、设置、头像、快捷询问和退出确认等完整浮层。
- Go API：Todo CRUD、搜索、筛选、排序、分页和健康检查。
- Python Agent：WebSocket 流式事件、工具调用、危险操作确认、失败与安全重试。
- 质量门禁：前端单元覆盖率、三浏览器 Mock E2E、Chromium 视觉回归、axe/键盘测试，以及真实 Compose 栈 E2E。

> **认证边界：** 登录、注册、资料、头像和退出是浏览器端的本地原型 adapter，用于验证产品闭环。它不是服务端认证，不提供真实的身份校验、授权、会话吊销或多用户数据隔离。密码不会明文写入 localStorage，但这仍不能替代服务端认证。

## 快速开始

### 完整本地栈

```bash
git clone <repo-url> todolist-agent
cd todolist-agent
cp .env.example .env
# 在 .env 中配置 LLM_API_KEY（真实 Agent 对话需要）
docker compose up -d --build
```

访问：

- 前端：<http://localhost:3000>
- Go API：<http://localhost:8080/api/health>
- Agent：<http://localhost:8000/api/agent/health>

停止并清理：

```bash
docker compose down
```

该命令不删除数据卷；需要清除本地数据时显式运行 `docker compose down -v`。

### 只运行高保真前端

不启动 Go、PostgreSQL 或 Agent 服务时，可使用 MSW 查看和操作完整前端：

```bash
cd frontend
corepack enable
pnpm install
VITE_ENABLE_MSW=true pnpm dev --host 127.0.0.1
```

打开 <http://127.0.0.1:3000>，先在注册页创建本地原型账号，再登录进入应用。该模式的数据和认证状态只保存在当前浏览器中。

## 为不知情的 AI 或开发者复现原型

不要只依据文字猜测界面。按以下顺序读取并核对：

1. [UI 高保真设计规格](docs/superpowers/specs/2026-07-13-agent-todolist-prototype-design.md)：产品规则、组件边界和八条验收路径。
2. [V6 可交互原型](.superpowers/brainstorm/40507-1783945975/content/workspace-full-flow-v6.html)：页面构图、动效、弹窗和 Agent 交互基准；可直接在浏览器中打开。
3. [视觉回归基准与签核](docs/qa/visual-review.md)：固定视口、设计量尺、14 张基线截图和允许的可访问性差异。
4. [产品需求](docs/PRD.md) 与 [API 文档](docs/API.md)：业务范围和真实接口契约。
5. [E2E 覆盖矩阵](docs/qa/e2e-matrix.md) 与 [发布检查清单](docs/qa/release-checklist.md)：确认实现不是只有静态外观。

视觉权威顺序为：设计规格明确规则 → V6 原型 → 已签核视觉基线（仅用于回归）→ PRD/API。WCAG 2.2 AA 可以覆盖原型低对比色，但必须在视觉签核中记录；生产实现不得直接复制单文件 HTML。

## 验证

```bash
cd frontend
pnpm lint
pnpm test:coverage
pnpm build
pnpm e2e:mock

cd ../backend
go test ./...

cd ../agent-service
uv run pytest -q

cd ..
./scripts/e2e-real.sh
```

`e2e:mock` 在 Chromium、Firefox 和 WebKit 上运行功能、键盘和 axe 检查；像素视觉基线只在 Chromium 上比较。`scripts/e2e-real.sh` 使用隔离的 `todolist-agent-e2e` Compose 项目、独立端口和数据卷，完成后自动清理。真实栈 Agent E2E 使用确定性的 fake LLM provider，但经过真实 Nginx、WebSocket、Agent 服务、Go API 和数据库链路。

完整命令、预期结果和视觉审批记录见 [发布检查清单](docs/qa/release-checklist.md)。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19、TypeScript 6、Vite 8、Tailwind CSS 4、TanStack Query |
| 后端 | Go 1.21+、Gin、GORM |
| Agent | Python 3.12、FastAPI、LangChain、LangGraph |
| 数据 | PostgreSQL 16、Redis 7 |
| 测试 | Vitest、Testing Library、Playwright、axe-core、pytest |
| 运行 | Docker、Docker Compose、Nginx |

## 文档导航

| 文档 | 用途 |
|---|---|
| [产品需求](docs/PRD.md) | MVP 功能与非 MVP 范围 |
| [UI 原型设计](docs/superpowers/specs/2026-07-13-agent-todolist-prototype-design.md) | 高保真实施蓝图 |
| [V6 可交互原型](.superpowers/brainstorm/40507-1783945975/content/workspace-full-flow-v6.html) | 可运行视觉与交互参考 |
| [视觉回归基准](docs/qa/visual-review.md) | 截图量尺与逐文件签核 |
| [E2E 覆盖矩阵](docs/qa/e2e-matrix.md) | 功能到测试和浏览器的映射 |
| [发布检查清单](docs/qa/release-checklist.md) | 发布前命令、审批与边界 |
| [开发状态](docs/STATUS.md) | 当前实现完成度 |
| [架构文档](docs/ARCHITECTURE.md) | 系统设计 |
| [API 文档](docs/API.md) | HTTP 与 WebSocket 契约 |
| [Agent 提示词](docs/AGENT_PROMPT.md) | 提示词与工具规范 |
| [部署指南](docs/DEPLOY.md) | 部署说明 |

## License

MIT
