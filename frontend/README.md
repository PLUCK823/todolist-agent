# Agent TodoList 前端

React 19 + TypeScript 6 + Vite 8 的生产前端。当前实现覆盖任务、近期安排、Agent、认证原型、资料和设置完整流程，并以 V6 可交互原型和固定视觉截图作为回归基准。

## 设计与实现依据

首次接手的开发者或 AI 必须按顺序阅读：

1. [UI 高保真设计规格](../docs/superpowers/specs/2026-07-13-agent-todolist-prototype-design.md)
2. [V6 可交互页面原型](../.superpowers/brainstorm/40507-1783945975/content/workspace-full-flow-v6.html)
3. [视觉回归基准](../docs/qa/visual-review.md)
4. [产品需求](../docs/PRD.md) 与 [API 契约](../docs/API.md)
5. [E2E 覆盖矩阵](../docs/qa/e2e-matrix.md)

设计规格规定产品规则，V6 原型规定视觉与交互手感，`e2e/snapshots/` 是已签核的 Chromium 基线。`.superpowers/` 是设计资产，不是生产代码；不得把单文件 HTML 直接复制进 `src/`。

## 运行方式

```bash
corepack enable
pnpm install
pnpm dev
```

普通开发模式会将 `/api` 代理到 `http://localhost:8080`，将 `/ws` 代理到 `ws://localhost:8000`。

只查看和操作前端原型时使用 Mock Service Worker：

```bash
VITE_ENABLE_MSW=true pnpm dev --host 127.0.0.1
```

打开 <http://127.0.0.1:3000>，注册本地账号后登录。不要在生产环境设置 `VITE_ENABLE_MSW=true`。

## 认证边界

`src/features/auth/auth.storage.ts` 是可替换的浏览器本地 adapter：

- 账号、摘要凭据和会话保存在浏览器存储中，资料和头像也只对当前浏览器生效。
- 密码经过带盐 SHA-256 摘要后保存，不存储明文。
- 该实现只用于高保真原型和导航闭环，**不是服务端认证**，没有真实授权、多用户隔离、令牌过期、找回密码或跨设备同步。
- 接入真实认证时应替换 `AuthStorageAdapter`，并由服务端保护 Todo 与 Agent 接口。

## 目录

```text
src/
├── app/                    # Provider、路由、Query Client
├── features/
│   ├── agent/              # WebSocket 会话、侧栏、快捷询问、执行时间线
│   ├── auth/               # 本地认证 adapter 与受保护路由
│   ├── preferences/        # 主题、动效和 Agent 启动偏好
│   ├── profile/            # 头像与资料
│   ├── shell/              # 导航、页头与三栏 Shell
│   └── todos/              # Todo API、查询、卡片、弹窗、筛选、近期安排
├── pages/                  # 六个路由页面
├── shared/ui/              # Dialog、Popover、Button、Toast 等原语
├── mocks/                  # 仅开发与测试启用的 MSW handler
└── styles/                 # Token、全局样式和动效
e2e/
├── fixtures/               # 固定时间、认证、Todo API、Agent 流式场景
├── mock/                   # 三浏览器功能、axe、键盘与 Chromium 视觉测试
├── real/                   # 真实 Compose 栈 Chromium 测试
└── snapshots/              # 已签核视觉基线
```

## 质量命令

```bash
pnpm lint                 # ESLint
pnpm test                 # Vitest 单元/组件测试
pnpm test:coverage        # 覆盖率：行/函数/语句 85%，分支 80%
pnpm build                # TypeScript + Vite 生产构建
pnpm e2e:mock             # Chromium、Firefox、WebKit；视觉仅 Chromium
pnpm e2e:real             # 已启动真实栈时运行 @real Chromium 项目
```

从仓库根目录执行 `./scripts/e2e-real.sh` 可构建隔离 Compose 栈、运行真实 Chromium E2E 并自动清理。

更新截图前必须先阅读 [视觉回归基准](../docs/qa/visual-review.md)，逐张确认差异；`pnpm e2e:update` 不是修复视觉回归的手段。
审批后的更新顺序是：先让对应功能测试通过，逐张与 V6 原型核对，再运行 `pnpm e2e:update --project=chromium`，检查所有 PNG diff 并同步视觉签核文档。
