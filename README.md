# Agent TodoList

一个可运行的智能待办系统：React 前端、Go API、Python Agent、PostgreSQL、Redis 和 Nginx 由 Docker Compose 统一编排。当前功能分支已实现服务端 Cookie 认证、按用户隔离的持久化 Agent 多会话、完整消息/步骤历史、安全 GFM 渲染和紧凑的助手工作区。

## 当前能力

- 待办 CRUD、搜索、筛选、排序、分页、完成/恢复和近期安排。
- Go 服务端注册、登录、刷新、退出和个人资料接口；访问与刷新凭据均使用 `HttpOnly` Cookie。
- 刷新凭据单次轮换、退出撤销、精确 Origin allowlist 和跨用户资源隐藏。
- Agent 会话创建、列表、读取、重命名、删除；会话归属由服务端从 Cookie 身份推导。
- Agent turn、用户/助手消息、执行步骤和稳定 `event_id` 持久化到 PostgreSQL，重启 Agent 后仍可恢复。
- 安全 GFM Markdown/表格、每轮可折叠执行详情、底部紧凑输入区及桌面/移动布局。
- OpenAI、Anthropic、Gemini、DeepSeek 和 OpenAI-compatible 模型适配器。

## 快速开始

```bash
cp .env.example .env
# 填写 AUTH_JWT_SECRET（至少 32 字节）和所选模型的 LLM_API_KEY
docker compose -p todolist-agent up -d --build --wait
docker compose -p todolist-agent ps
```

访问 <http://localhost:3000>。首次使用需要注册账号；升级已有数据卷时，先执行：

```bash
docker compose -p todolist-agent exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U todolist -d todolist < scripts/migrate.sql
```

迁移是幂等的并保留既有 Todo 数据。旧浏览器本地原型账号不是服务端账号，升级后需要重新注册。

## 必要安全配置

- `AUTH_JWT_SECRET` 必填且至少 32 字节；每个环境使用独立随机值，不得复用 API Key、数据库密码或示例值。
- 生产环境必须使用 HTTPS，并设置 `AUTH_COOKIE_SECURE=true`。
- `AUTH_ALLOWED_ORIGINS` 只填写实际前端的完整 Origin，禁止 `*`；多个 Origin 用逗号分隔。
- `.env`、真实模型密钥、登录 Cookie、数据库备份和 E2E trace 均不得提交。
- 浏览器 WebSocket 只携带 Cookie 和 `session_id`，不会把 JWT 放进 URL 或 localStorage。

## 模型提供商

```env
LLM_PROVIDER=deepseek
LLM_MODEL=deepseek-chat
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=replace-with-provider-api-key
```

`LLM_PROVIDER` 可选 `openai`、`anthropic`、`google`、`deepseek` 或 `openai-compatible`。兼容 OpenAI 协议的服务需要同时设置 `LLM_BASE_URL`。测试环境使用确定性的 fake provider，不代表生产模型质量或 SLA。

## 开发与验证

```bash
cd backend && go test ./... -race
cd ../agent-service && uv run pytest
cd ../frontend && corepack pnpm lint && corepack pnpm test:coverage -- --run && corepack pnpm build
cd .. && corepack pnpm --dir frontend e2e:mock
./scripts/e2e-real.sh
```

Mock E2E 使用 Playwright context transport 隔离 HTTP/WebSocket，不注册 Service Worker；当前 Chromium、Firefox、WebKit 共发现 251 项。真实 E2E 通过 Nginx → Go/Python → PostgreSQL 的 Compose 栈运行 4 项 Chromium 故事。前端当前单元/组件测试为 569 项。最终发布证据以 [发布检查清单](docs/qa/release-checklist.md) 的当次结果为准。

## 原型和实现依据

不了解前期讨论的开发者或 AI 应同时阅读：

1. [V6 设计规格](docs/superpowers/specs/2026-07-13-agent-todolist-prototype-design.md)
2. [可交互 V6 原型](.superpowers/brainstorm/40507-1783945975/content/workspace-full-flow-v6.html)
3. [架构文档](docs/ARCHITECTURE.md)
4. [API 合约](docs/API.md)
5. [E2E 覆盖矩阵](docs/qa/e2e-matrix.md)

原型用于视觉与交互参照，生产实现和安全边界以当前代码、API/架构文档及自动化测试为准。

## 技术栈

- React 19、TypeScript、Vite、TanStack Query、Playwright、Vitest
- Go、Gin、GORM、Argon2id、JWT HS256
- Python 3.12、FastAPI、asyncpg、WebSocket
- PostgreSQL 16、Redis 7、Nginx、Docker Compose

## 文档

- [项目状态](docs/STATUS.md)
- [架构](docs/ARCHITECTURE.md)
- [API](docs/API.md)
- [数据库](docs/DATABASE.md)
- [部署](docs/DEPLOY.md)
- [发布检查清单](docs/qa/release-checklist.md)

## License

MIT
