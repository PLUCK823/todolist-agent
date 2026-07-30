# Agent TodoList 前端

React 19 + TypeScript + Vite 前端。认证来源是 Go 服务端的 `HttpOnly` Cookie；浏览器不保存密码、JWT 或刷新凭据。Agent 会话与完整 turn 历史来自 Python Agent 的 PostgreSQL API。

## 运行

```bash
corepack enable
pnpm install
pnpm dev
```

开发服务器将 `/api` 代理到 Go/Agent HTTP 服务，并将 `/ws` 代理到 Agent WebSocket。完整环境推荐从仓库根目录启动 Compose。

## 认证和会话

- 注册、登录、刷新、退出和 `/me` 都通过 `credentials: 'include'` 调用服务端。
- 前端遇到 API `401` 时共享一次刷新请求，并只重试原请求一次；登录、注册、刷新和退出本身不递归刷新。
- localStorage 仅保存主题、导航等非敏感偏好，不保存认证令牌。
- Agent 会话支持列表、详情、重命名和删除；当前用户只能看到自己的会话。
- WebSocket 使用 Cookie 认证，URL 只带 `session_id`。

## 目录

```text
src/
├── app/                    # Provider、路由、Query Client
├── features/
│   ├── agent/              # 持久化会话、turn、GFM、执行详情与 WebSocket
│   ├── auth/               # Cookie API、会话上下文与受保护路由
│   ├── preferences/        # 主题、动效和 Agent 偏好
│   ├── profile/            # 头像与服务端资料
│   ├── shell/              # 导航、页头与三栏 Shell
│   └── todos/              # Todo API、卡片、弹窗、筛选与近期安排
├── pages/
├── shared/ui/
└── styles/
e2e/
├── fixtures/               # Playwright context transport 和真实栈工具
├── mock/                   # Chromium/Firefox/WebKit 功能与视觉故事
└── real/                   # 真实 Compose 栈 Chromium 故事
```

## 质量命令

```bash
pnpm lint
pnpm test
pnpm test:coverage
pnpm build
pnpm e2e:mock
pnpm e2e:real
pnpm verify:experience
```

当前基线：569 项单元/组件测试；Mock E2E 三浏览器共发现 251 项；真实栈 Chromium 4 项。Mock E2E 在 Playwright browser context 内拦截 HTTP 和 WebSocket，不依赖 MSW Service Worker，context 销毁后没有站点残留。真实栈测试不会启用 Mock transport。

视觉基线只在 Chromium 比较；Firefox/WebKit 仍运行全部功能、键盘和无障碍断言。更新截图前阅读 [视觉回归基准](../docs/qa/visual-review.md)，不得为消除失败而批量刷新。
