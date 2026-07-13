# Frontend Full Rebuild and End-to-End Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有可运行但低保真的 MVP 前端重构为与 V6 原型一致的完整交互产品，补齐 Agent、快捷指令、设置、头像、认证原型等缺失模块，并用 Mock 与真实服务两层端到端测试覆盖全部用户路径。

**Architecture:** 保留 React 19、TypeScript 6、Vite 8、TailwindCSS 4、React Router 7 和 TanStack Query 5。按 `app / shared / features / pages` 拆分职责；Todo 与 Agent 使用真实 HTTP/WebSocket 适配器，登录注册继续遵守 PRD 的 P2 边界，使用可替换的本地会话适配器完成原型闭环。Playwright 负责浏览器流程、视觉回归、可访问性和真实三服务联调，Vitest/RTL 继续承担组件与状态单元测试。

**Tech Stack:** React 19.2、TypeScript 6、Vite 8、TailwindCSS 4、React Router 7、TanStack Query 5、Axios、Vitest、Testing Library、MSW 2、Playwright、axe-core、Go/Gin、FastAPI/WebSocket。

---

## 0. 执行约束与当前基线

权威输入：

- `docs/superpowers/specs/2026-07-13-agent-todolist-prototype-design.md`
- `.superpowers/brainstorm/40507-1783945975/content/workspace-full-flow-v6.html`
- `docs/PRD.md`
- `docs/API.md`

当前验证基线：

- `frontend`: 17 个测试文件、179 个测试通过。
- `frontend`: `pnpm build` 通过。
- `frontend`: `pnpm lint` 失败，存在 7 个错误。
- `backend`: `go test ./...` 失败，删除接口返回 200，集成测试与 API 契约要求 204。
- `agent-service`: 57 个测试通过，总覆盖率 92%。
- 当前 workspace 没有 `.git` 元数据。下列 commit 命令应在正式 Git checkout 中执行；若执行环境仍无 `.git`，跳过 commit 命令并在执行报告中逐项记录变更集。

范围边界：

- Todo CRUD 与 Agent 对话接真实后端/Agent 服务。
- 登录、注册、头像、设置使用浏览器本地适配器，不新增用户表、JWT 或认证后端。
- 桌面端 `>= 1000px` 是像素级验收范围；小桌面必须可用，移动端重排不是本计划交付目标。

## 1. 目标文件结构

```text
frontend/
  playwright.config.ts
  e2e/
    fixtures/
      app.fixture.ts
      api.fixture.ts
      agent.fixture.ts
    mock/
      auth.spec.ts
      navigation.spec.ts
      tasks.spec.ts
      upcoming.spec.ts
      assistant.spec.ts
      profile-settings.spec.ts
      accessibility.spec.ts
      visual.spec.ts
    real/
      health.spec.ts
      todo-lifecycle.spec.ts
      agent-stream.spec.ts
    snapshots/
  src/
    app/
      AppProviders.tsx
      AppRouter.tsx
      queryClient.ts
    shared/
      api/httpClient.ts
      hooks/useLocalStorage.ts
      ui/Button.tsx
      ui/Dialog.tsx
      ui/IconButton.tsx
      ui/Popover.tsx
      ui/TextField.tsx
      ui/ToastProvider.tsx
    features/
      shell/
        ShellContext.tsx
        AppShell.tsx
        NavigationRail.tsx
      todos/
        todo.types.ts
        todo.api.ts
        todo.queries.ts
        TaskDashboard.tsx
        TaskCard.tsx
        TaskDialog.tsx
        TaskDetailDialog.tsx
        TaskFilters.tsx
      agent/
        agent.types.ts
        agent.api.ts
        useAgentSession.ts
        AgentPanel.tsx
        AgentStepTimeline.tsx
        CommandPalette.tsx
      preferences/
        preferences.types.ts
        PreferencesContext.tsx
        SettingsDialog.tsx
      auth/
        auth.types.ts
        auth.storage.ts
        AuthContext.tsx
        RequireSession.tsx
      profile/
        AvatarDialog.tsx
    pages/
      MyTasksPage.tsx
      UpcomingPage.tsx
      AssistantPage.tsx
      ProfilePage.tsx
      AuthPage.tsx
    styles/
      tokens.css
      global.css
      motion.css
    test/
      render.tsx
      setup.ts
```

职责规则：

- `shared/ui` 只处理通用行为、语义和视觉，不读取业务 API。
- `features/*` 公开类型和组件，不互相读取内部文件。
- `pages` 只组装 feature，不实现请求和持久化。
- `AppShell` 只管理布局；Agent 会话由 `features/agent` 管理。
- MSW 仅在 `VITE_ENABLE_MSW=true` 时启动，开发默认连接真实服务。

---

### Task 1: 修复基线契约与质量门禁

**Files:**
- Modify: `backend/internal/handler/todo_handler.go:159`
- Modify: `backend/internal/handler/todo_handler_test.go`
- Modify: `frontend/eslint.config.js`
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/components/common/ConfirmDialog.tsx`
- Modify: `frontend/src/components/common/ToastRegion.tsx`
- Modify: `frontend/src/components/todo/FilterPopover.tsx`
- Modify: `frontend/src/components/todo/TaskDialog.tsx`
- Modify: `frontend/src/testUtils.tsx`
- Modify: `frontend/src/vitest.setup.ts`

- [ ] **Step 1: 为删除接口补充 204 响应测试**

在 handler 测试中断言成功删除没有 JSON body：

```go
func TestDeleteTodo_ReturnsNoContent(t *testing.T) {
    // 使用现有 mock service 和 Gin 测试路由
    req := httptest.NewRequest(http.MethodDelete, "/api/todos/1", nil)
    rec := httptest.NewRecorder()
    router.ServeHTTP(rec, req)

    require.Equal(t, http.StatusNoContent, rec.Code)
    require.Empty(t, rec.Body.String())
}
```

- [ ] **Step 2: 验证测试先失败**

Run: `cd backend && go test ./internal/handler ./cmd/server -run DeleteTodo -v`

Expected: FAIL，实际状态码为 200。

- [ ] **Step 3: 按 API 契约返回 204**

将成功分支改为：

```go
c.Status(http.StatusNoContent)
```

禁止通过 `success()` 写入 JSON body。

- [ ] **Step 4: 清理前端 ESLint 阻塞**

执行以下重构：

```ts
// eslint.config.js
globalIgnores(['dist', 'coverage', 'public/mockServiceWorker.js'])
```

- 将 `ToastContext`、`useToast` 移到 `shared/ui/toast-context.ts`，组件文件只导出组件。
- 将测试 provider 移到 `src/test/render.tsx`，并在 ESLint 中对 `src/test/**` 关闭 `react-refresh/only-export-components`。
- `ConfirmDialog` 和 `TaskDialog` 改为在父组件用 `key` 重建表单/动效状态，不在 effect 中同步调用 setter。
- `FilterPopover` 改为打开时从 props 创建 draft reducer，或由父组件传入完整 draft，取消 effect 同步 setter。
- 将 `vitest.setup.ts` 中的 `any` 改为 `Window & typeof globalThis` 的显式类型。

- [ ] **Step 5: 让 MSW 变成显式开关**

```ts
if (import.meta.env.VITE_ENABLE_MSW === 'true') {
  const { worker } = await import('./mocks/browser')
  await worker.start({ onUnhandledRequest: 'error' })
}
```

新增 `.env.development.example`：

```dotenv
VITE_ENABLE_MSW=false
VITE_API_BASE_URL=/api
VITE_AGENT_WS_URL=ws://localhost:8000/api/agent/stream
```

- [ ] **Step 6: 验证全仓基线**

Run:

```bash
cd frontend && pnpm lint && pnpm test && pnpm build
cd ../backend && go test ./...
cd ../agent-service && uv run pytest -q
```

Expected: 所有命令退出码为 0；前端仍为 179 个或更多测试通过。

- [ ] **Step 7: Commit**

```bash
git add backend frontend
git commit -m "fix: restore quality gates and API contract"
```

---

### Task 2: 建立设计令牌、全局样式与通用 UI 原语

**Files:**
- Create: `frontend/src/styles/tokens.css`
- Create: `frontend/src/styles/global.css`
- Create: `frontend/src/styles/motion.css`
- Create: `frontend/src/shared/ui/Button.tsx`
- Create: `frontend/src/shared/ui/IconButton.tsx`
- Create: `frontend/src/shared/ui/TextField.tsx`
- Create: `frontend/src/shared/ui/Dialog.tsx`
- Create: `frontend/src/shared/ui/Popover.tsx`
- Create: `frontend/src/shared/ui/__tests__/Dialog.test.tsx`
- Create: `frontend/src/shared/ui/__tests__/Popover.test.tsx`
- Modify: `frontend/src/main.tsx`
- Replace: `frontend/src/index.css`

- [ ] **Step 1: 为 Dialog 写失败测试**

```tsx
it('traps focus and restores it to the trigger', async () => {
  const user = userEvent.setup()
  render(<DialogHarness />)
  await user.click(screen.getByRole('button', { name: '打开' }))
  expect(screen.getByRole('dialog')).toHaveFocus()
  await user.keyboard('{Escape}')
  expect(screen.getByRole('button', { name: '打开' })).toHaveFocus()
})
```

- [ ] **Step 2: 为 Popover 写失败测试**

```tsx
it('closes on outside click and Escape', async () => {
  const user = userEvent.setup()
  render(<PopoverHarness />)
  await user.click(screen.getByRole('button', { name: '筛选' }))
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
```

- [ ] **Step 3: 实现规格中的令牌**

`tokens.css` 至少定义：

```css
:root {
  --app-bg: #f7f7f9;
  --page-bg: #e9ebf0;
  --nav-bg: #202538;
  --agent-bg: #262b3d;
  --text: #222738;
  --text-muted: #898e9d;
  --primary: #7165ea;
  --primary-hover: #5f54d9;
  --border: #e3e5eb;
  --success: #54ad82;
  --danger: #d9574c;
  --radius-shell: 20px;
  --radius-panel: 14px;
  --motion-shell: 480ms cubic-bezier(.22, 1, .36, 1);
  --motion-overlay: 300ms cubic-bezier(.16, 1, .3, 1);
}
```

- [ ] **Step 4: 实现可访问的通用原语**

公共接口固定为：

```ts
export interface DialogProps {
  open: boolean
  title: string
  description?: string
  onOpenChange(open: boolean): void
  children: React.ReactNode
  footer?: React.ReactNode
}

export interface PopoverProps {
  open: boolean
  anchorRef: React.RefObject<HTMLElement | null>
  onOpenChange(open: boolean): void
  children: React.ReactNode
}
```

Dialog 通过 portal 渲染，具备 `aria-modal`、焦点环、Escape、遮罩关闭、关闭后恢复焦点；提交中由调用方禁用关闭。

- [ ] **Step 5: 加入 reduced-motion 降级**

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    animation-duration: 1ms !important;
    transition-duration: 1ms !important;
  }
}
```

- [ ] **Step 6: 验证**

Run: `cd frontend && pnpm test -- src/shared/ui && pnpm lint && pnpm build`

Expected: UI 原语测试通过，无 lint 错误。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/shared frontend/src/styles frontend/src/main.tsx frontend/src/index.css
git commit -m "feat(frontend): establish V6 design foundation"
```

---

### Task 3: 重构 App Provider、路由与三栏 Shell

**Files:**
- Create: `frontend/src/app/queryClient.ts`
- Create: `frontend/src/app/AppProviders.tsx`
- Create: `frontend/src/app/AppRouter.tsx`
- Create: `frontend/src/features/shell/ShellContext.tsx`
- Create: `frontend/src/features/shell/AppShell.tsx`
- Create: `frontend/src/features/shell/NavigationRail.tsx`
- Create: `frontend/src/features/shell/__tests__/ShellContext.test.tsx`
- Create: `frontend/src/features/shell/__tests__/AppShell.test.tsx`
- Modify: `frontend/src/App.tsx`
- Remove after migration: `frontend/src/components/layout/AppShell.tsx`
- Remove after migration: `frontend/src/components/layout/NavigationRail.tsx`

- [ ] **Step 1: 写 Shell 状态失败测试**

```tsx
it('persists nav and agent collapsed state', async () => {
  const user = userEvent.setup()
  render(<ShellHarness />)
  await user.click(screen.getByRole('button', { name: '展开导航' }))
  await user.click(screen.getByRole('button', { name: '收起智能助手' }))
  expect(localStorage.getItem('todolist:shell')).toContain('"navExpanded":true')
  expect(screen.queryByLabelText('智能助手面板')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: 定义 ShellContext 接口**

```ts
interface ShellState {
  navExpanded: boolean
  agentExpanded: boolean
}

interface ShellContextValue extends ShellState {
  toggleNav(): void
  openAgent(): void
  closeAgent(): void
}
```

默认 `navExpanded=false`、`agentExpanded=true`，使用 `todolist:shell` 持久化。

- [ ] **Step 3: 实现与 V6 一致的网格**

```css
.app-shell {
  display: grid;
  grid-template-columns: var(--nav-width) minmax(0, 1fr) var(--agent-width);
  transition: grid-template-columns var(--motion-shell);
}
```

- 导航：68px / 210px。
- Agent：340px / 0px。
- Agent 收起后不保留深色窄栏。
- 页面外边距 14px，shell 圆角 20px。

- [ ] **Step 4: 实现真正可展开的 NavigationRail**

导航顺序固定：我的任务、近期安排、智能助手、设置、用户头像、展开/收起。收起时只有图形；展开时显示文字与用户信息。使用 `NavLink` 保留路由选中状态。

- [ ] **Step 5: 拆分 providers 与 router**

```tsx
export default function App() {
  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  )
}
```

QueryClient 只创建一次，Toast、Auth、Preferences、Shell providers 的顺序固定在 `AppProviders`。

- [ ] **Step 6: 验证 Shell 行为**

Run: `cd frontend && pnpm test -- src/features/shell && pnpm build`

Expected: 展开/收起、路由选中、持久化和键盘焦点测试通过。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app frontend/src/features/shell frontend/src/App.tsx
git commit -m "feat(frontend): rebuild adaptive application shell"
```

---

### Task 4: 重构任务域与完整任务交互

**Files:**
- Create: `frontend/src/features/todos/todo.types.ts`
- Create: `frontend/src/features/todos/todo.api.ts`
- Create: `frontend/src/features/todos/todo.queries.ts`
- Create: `frontend/src/features/todos/TaskDashboard.tsx`
- Create: `frontend/src/features/todos/TaskCard.tsx`
- Create: `frontend/src/features/todos/TaskDialog.tsx`
- Create: `frontend/src/features/todos/TaskDetailDialog.tsx`
- Create: `frontend/src/features/todos/TaskFilters.tsx`
- Create: `frontend/src/features/todos/__tests__/TaskDashboard.test.tsx`
- Create: `frontend/src/features/todos/__tests__/TaskDialog.test.tsx`
- Create: `frontend/src/features/todos/__tests__/TaskFilters.test.tsx`
- Modify: `frontend/src/pages/MyTasksPage.tsx`
- Remove after migration: `frontend/src/components/todo/*`
- Remove after migration: `frontend/src/hooks/useTodos.ts`
- Remove after migration: `frontend/src/services/todoApi.ts`
- Remove after migration: `frontend/src/types/todo.ts`

- [ ] **Step 1: 写任务首页信息层级测试**

```tsx
it('renders V6 summary, grouped tasks and Chinese controls', async () => {
  renderApp('/tasks')
  expect(await screen.findByRole('heading', { name: '今天，保持专注' })).toBeVisible()
  expect(screen.getByText('全部任务')).toBeVisible()
  expect(screen.getByRole('button', { name: '新建任务' })).toBeVisible()
  expect(screen.getByRole('button', { name: '全部状态' })).toBeVisible()
  expect(screen.getByRole('button', { name: '优先级' })).toBeVisible()
})
```

- [ ] **Step 2: 写 CRUD 闭环测试**

覆盖：新建、详情、编辑、完成、取消完成、删除二次确认、保存失败保留表单。

```tsx
it('keeps form values when create fails', async () => {
  server.use(http.post('/api/todos', () => HttpResponse.json(error500, { status: 500 })))
  const user = userEvent.setup()
  renderApp('/tasks')
  await user.click(screen.getByRole('button', { name: '新建任务' }))
  await user.type(screen.getByLabelText('任务标题'), '失败时保留')
  await user.click(screen.getByRole('button', { name: '创建任务' }))
  expect(await screen.findByDisplayValue('失败时保留')).toBeVisible()
  expect(screen.getByRole('alert')).toHaveTextContent('创建失败')
})
```

- [ ] **Step 3: 统一 API 错误类型**

```ts
export interface ApiErrorPayload {
  code: number
  message: string
  data: null
}

export class ApiError extends Error {
  constructor(public code: number, message: string, public status: number) {
    super(message)
  }
}
```

Axios interceptor 将后端错误转换为 `ApiError`，组件不读取 Axios 内部结构。

- [ ] **Step 4: 实现 V6 任务首页**

- 中文化全部控件与状态。
- 摘要卡显示全部、进行中、已完成。
- 状态和优先级使用两个独立 Popover，打开一个自动关闭另一个。
- 任务按“即将到期”“稍后处理”“已完成”分组。
- 详情和编辑分离；删除使用 ConfirmDialog，不使用三秒内二次点击。
- 加载、空列表、筛选无结果、请求失败均有独立状态。

- [ ] **Step 5: 加入乐观完成状态与可靠回滚**

`complete`/`uncomplete` 在 `onMutate` 更新 cache，在 `onError` 恢复 snapshot，在 `onSettled` 重新校验。创建、编辑、删除成功后显示 Toast。

- [ ] **Step 6: 验证任务域**

Run: `cd frontend && pnpm test -- src/features/todos src/pages/__tests__/MyTasksPage.test.tsx`

Expected: CRUD、筛选、排序、分页、错误和空状态全部通过。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/todos frontend/src/pages/MyTasksPage.tsx
git commit -m "feat(frontend): rebuild complete task workflow"
```

---

### Task 5: 补齐近期安排页面

**Files:**
- Create: `frontend/src/features/todos/UpcomingTimeline.tsx`
- Create: `frontend/src/features/todos/__tests__/UpcomingTimeline.test.tsx`
- Modify: `frontend/src/pages/UpcomingPage.tsx`
- Modify: `frontend/src/pages/__tests__/UpcomingPage.test.tsx`

- [ ] **Step 1: 写日期选择与时间线失败测试**

```tsx
it('switches the timeline when a day is selected', async () => {
  const user = userEvent.setup()
  renderApp('/upcoming')
  await user.click(await screen.findByRole('button', { name: /7月14日/ }))
  expect(screen.getByRole('heading', { name: /7 月 14 日/ })).toBeVisible()
})
```

- [ ] **Step 2: 写空日期与已完成开关测试**

断言无安排日期显示“当天暂无安排”，打开“显示已完成”后出现完成任务。

- [ ] **Step 3: 实现七日日期条和时间线**

使用本地时区生成连续七天；同一天按 `due_date` 升序。每个事件复用 TaskDetailDialog 和完成/取消完成 mutation。新增“添加安排”复用 TaskDialog，并预填选中日期。

- [ ] **Step 4: 验证**

Run: `cd frontend && pnpm test -- UpcomingPage UpcomingTimeline`

Expected: 日期、空状态、完成开关、创建安排和详情交互通过。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/todos/UpcomingTimeline.tsx frontend/src/pages/UpcomingPage.tsx
git commit -m "feat(frontend): complete upcoming timeline experience"
```

---

### Task 6: 实现 Agent WebSocket 客户端与状态机

**Files:**
- Create: `frontend/src/features/agent/agent.types.ts`
- Create: `frontend/src/features/agent/agent.api.ts`
- Create: `frontend/src/features/agent/agent.reducer.ts`
- Create: `frontend/src/features/agent/useAgentSession.ts`
- Create: `frontend/src/features/agent/__tests__/agent.reducer.test.ts`
- Create: `frontend/src/features/agent/__tests__/useAgentSession.test.tsx`
- Modify: `frontend/src/mocks/handlers.ts`

- [ ] **Step 1: 定义与 API 文档一致的事件联合类型**

```ts
export type AgentEvent =
  | { type: 'step_started'; step_id: string; label: string; tool?: string; args?: Record<string, unknown>; started_at?: string }
  | { type: 'step_completed'; step_id: string; duration_ms: number }
  | { type: 'step_failed'; step_id: string; error_code: string; message: string; retryable: boolean; duration_ms: number }
  | { type: 'confirmation_required'; step_id: string; message: string; confirmation_id: string }
  | { type: 'action_completed'; step_id: string; action: string; result: Record<string, unknown>; duration_ms: number }
  | { type: 'reply'; content: string }
  | { type: 'done' }
```

- [ ] **Step 2: 写 reducer 顺序与失败测试**

```ts
it('moves a step from running to failed and preserves retry metadata', () => {
  const started = reduceAgent(initialState, stepStarted)
  const failed = reduceAgent(started, stepFailed)
  expect(failed.steps[0]).toMatchObject({ status: 'failed', retryable: true })
})
```

- [ ] **Step 3: 写 WebSocket 生命周期测试**

使用可注入 `WebSocketFactory`，验证：连接、发送 JSON、逐事件 dispatch、done 关闭、异常断线、重试、组件卸载清理。

- [ ] **Step 4: 实现 agent.api.ts**

```ts
export interface AgentStreamClient {
  send(input: { message: string; session_id?: string }, handlers: AgentHandlers): () => void
}
```

返回取消函数；不在组件中直接 new WebSocket。URL 从 `VITE_AGENT_WS_URL` 读取，默认 `/api/agent/stream`。

- [ ] **Step 5: 实现 useAgentSession**

Hook 暴露：

```ts
interface AgentSessionValue {
  sessionId?: string
  messages: AgentMessage[]
  steps: AgentStep[]
  status: 'idle' | 'connecting' | 'running' | 'waiting_confirmation' | 'failed' | 'done'
  send(message: string): void
  retry(stepId: string): void
  confirm(confirmationId: string): void
  cancel(): void
  clear(): Promise<void>
}
```

- [ ] **Step 6: 更新 MSW/测试事件 fixture**

提供 success、timeout、validation error、confirmation required 四套确定性事件序列，延迟与设计规格第 12.8 节一致。

- [ ] **Step 7: 验证**

Run: `cd frontend && pnpm test -- src/features/agent`

Expected: reducer 与 WebSocket 生命周期测试通过。

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/agent frontend/src/mocks
git commit -m "feat(frontend): add typed agent streaming state machine"
```

---

### Task 7: 将 Agent 服务改为真实逐步流式协议

**Files:**
- Modify: `agent-service/app/agent.py`
- Modify: `agent-service/app/main.py`
- Modify: `agent-service/app/schemas.py`
- Modify: `agent-service/tests/test_agent.py`
- Modify: `agent-service/tests/test_api.py`
- Modify: `docs/API.md`

- [ ] **Step 1: 写事件时序失败测试**

当前服务先完成整个 `process_message()`，再补发工具事件，无法真实展示接口等待时间。新增测试要求事件按真实执行时间发出：

```python
def test_stream_emits_tool_started_before_tool_finishes(client, fake_slow_tool):
    with client.websocket_connect("/api/agent/stream") as ws:
        ws.send_json({"message": "创建任务：慢请求"})
        assert ws.receive_json()["type"] == "step_started"
        tool_started = ws.receive_json()
        assert tool_started["type"] == "step_started"
        assert tool_started["tool"] == "create_todo"
        fake_slow_tool.release()
        assert ws.receive_json()["type"] == "action_completed"
```

- [ ] **Step 2: 为 Agent 执行增加事件 sink**

```python
AgentEventSink = Callable[[dict[str, Any]], Awaitable[None]]

async def process_message(
    session_id: Optional[str],
    message: str,
    on_event: Optional[AgentEventSink] = None,
) -> tuple[str, list[dict[str, Any]], str]:
    ...
```

在调用 LLM 前发送 `step_started(understand)`；LLM 产出 tool call 后完成 understand；每个 tool 调用前发送 `step_started(tool)`，await 返回后立即发送 `action_completed` 或 `step_failed`。事件 sink 为空时保持 REST API 与现有单元测试兼容。

- [ ] **Step 3: 阻止未确认的删除工具执行**

```python
class PendingConfirmation(BaseModel):
    confirmation_id: str
    session_id: str
    tool: str
    args: dict[str, Any]
    message: str
```

当模型请求 `delete_todo` 时，先发送 `confirmation_required` 并暂停该 tool。WebSocket 接受：

```json
{"type":"confirmation_response","confirmation_id":"confirm-123","approved":true}
```

`approved=false` 时生成取消结果并继续回复；`approved=true` 时才执行删除。confirmation ID 必须绑定 session 和 tool args，使用一次后删除。

- [ ] **Step 4: 让 WebSocket 直接转发实时事件**

`main.py` 不再根据最终 `actions` 伪造 tool 步骤，而是把 `on_event=ws.send_json` 传给 Agent。最终只负责流式 reply、done、断线取消和 confirmation response。

- [ ] **Step 5: 补齐超时和断线测试**

覆盖：后端超时产生 `step_failed(retryable=true)`；客户端在 tool 运行中断线不会继续写 WebSocket；删除拒绝不调用 backend；删除确认只执行一次。

- [ ] **Step 6: 同步 API 文档**

在 `docs/API.md` 写明 `confirmation_response` 客户端事件、真实事件顺序和 WebSocket 一次会话可进行多轮确认。

- [ ] **Step 7: 验证**

Run: `cd agent-service && uv run pytest -q`

Expected: 现有 57 个测试和新增流式/确认测试全部通过，覆盖率不低于 90%。

- [ ] **Step 8: Commit**

```bash
git add agent-service docs/API.md
git commit -m "feat(agent): stream real tool progress and confirmations"
```

---

### Task 8: 重构 Agent 侧栏、独立工作区与快捷指令

**Files:**
- Create: `frontend/src/features/agent/AgentPanel.tsx`
- Create: `frontend/src/features/agent/AgentStepTimeline.tsx`
- Create: `frontend/src/features/agent/CommandPalette.tsx`
- Create: `frontend/src/features/agent/__tests__/AgentPanel.test.tsx`
- Create: `frontend/src/features/agent/__tests__/CommandPalette.test.tsx`
- Modify: `frontend/src/features/shell/AppShell.tsx`
- Modify: `frontend/src/pages/AssistantPage.tsx`
- Remove after migration: `frontend/src/components/layout/AgentPanel.tsx`

- [ ] **Step 1: 写 Agent 面板收放测试**

```tsx
it('removes the dark column when collapsed and moves the spark button to the task header', async () => {
  const user = userEvent.setup()
  renderApp('/tasks')
  await user.click(screen.getByRole('button', { name: '收起智能助手' }))
  expect(screen.queryByLabelText('智能助手面板')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '展开智能助手' })).toBeVisible()
})
```

- [ ] **Step 2: 写 Command+K / Alt+K 测试**

```tsx
await user.keyboard('{Meta>}k{/Meta}')
expect(screen.getByRole('dialog', { name: '快速询问' })).toBeVisible()
expect(screen.getByPlaceholderText('告诉智能助手你想完成什么…')).toHaveFocus()
```

同时覆盖 Windows/Linux 的 `Alt+K`、Escape、遮罩关闭和焦点恢复。

- [ ] **Step 3: 实现 AgentStepTimeline**

展示 `waiting/running/completed/failed/confirmation_required`；运行步骤显示累计耗时，失败显示重试，确认步骤显示取消与确认，完成显示结构化 action card。

- [ ] **Step 4: 实现 V6 AgentPanel**

- 340px 深色栏。
- 紫色 `✦` 自身负责收起。
- 建议指令、消息、步骤轨迹、结果卡和输入区。
- 新 action 完成时使 Todo query 失效。
- 离线、超时、部分成功均保留用户消息。

- [ ] **Step 5: 实现独立 AssistantPage**

页面包含会话列表、当前对话、工具连接状态、步骤轨迹、大输入框和清空历史。进入页面自动收起右侧 Agent，离开后恢复之前状态。

- [ ] **Step 6: 实现 CommandPalette**

快捷框发送后关闭浮层并打开 Agent 侧栏；输入内容交给同一个 `useAgentSession`，不得创建第二套会话状态。

- [ ] **Step 7: 验证**

Run: `cd frontend && pnpm test -- AgentPanel CommandPalette AssistantPage && pnpm build`

Expected: 收放、快捷键、步骤状态、失败重试和页面会话通过。

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/agent frontend/src/features/shell frontend/src/pages/AssistantPage.tsx
git commit -m "feat(frontend): complete agent interaction surfaces"
```

---

### Task 9: 补齐设置、认证原型、头像和账户闭环

**Files:**
- Create: `frontend/src/features/preferences/preferences.types.ts`
- Create: `frontend/src/features/preferences/PreferencesContext.tsx`
- Create: `frontend/src/features/preferences/SettingsDialog.tsx`
- Create: `frontend/src/features/auth/auth.types.ts`
- Create: `frontend/src/features/auth/auth.storage.ts`
- Create: `frontend/src/features/auth/AuthContext.tsx`
- Create: `frontend/src/features/auth/RequireSession.tsx`
- Create: `frontend/src/features/profile/AvatarDialog.tsx`
- Create: `frontend/src/features/auth/__tests__/AuthContext.test.tsx`
- Create: `frontend/src/features/profile/__tests__/AvatarDialog.test.tsx`
- Modify: `frontend/src/pages/AuthPage.tsx`
- Modify: `frontend/src/pages/ProfilePage.tsx`
- Modify: `frontend/src/app/AppRouter.tsx`

- [ ] **Step 1: 写本地会话 adapter 测试**

```ts
it('registers, logs in and logs out with a replaceable storage adapter', async () => {
  const account = await authStorage.register({ name: 'Plucky HZ', email: 'plucky@example.com', password: 'password1' })
  expect(await authStorage.login({ email: account.email, password: 'password1' })).toMatchObject({ email: account.email })
  await authStorage.logout()
  expect(await authStorage.getSession()).toBeNull()
})
```

密码只用于原型校验，不写入 localStorage；storage 保存演示账户资料和 session 标记。

- [ ] **Step 2: 写受保护路由测试**

未登录访问 `/tasks` 重定向 `/login`；登录后回到原目标；退出确认后使用 `navigate('/login', { replace: true })`。

- [ ] **Step 3: 实现登录/注册页面**

复刻 V6 左右分栏。注册校验：名称非空、合法邮箱、密码至少 8 位；注册成功回登录页并预填邮箱。登录失败展示字段外错误，成功进入 `/tasks`。

- [ ] **Step 4: 实现 ProfilePage**

显示头像、名称、邮箱、时区、任务统计、Agent 会话次数。保存资料通过 adapter 持久化并 Toast。退出登录必须经过 ConfirmDialog。

- [ ] **Step 5: 实现 AvatarDialog**

四个预设头像可选；上传只接受 PNG/JPEG 且不超过 5MB；使用 `URL.createObjectURL` 预览，关闭时 revoke；保存后同步导航头像和资料页。

- [ ] **Step 6: 实现 PreferencesContext 与 SettingsDialog**

持久化：语言、主题、Agent 启动状态、reduced motion override。主题至少支持 `system/light/dark`，本轮所有用户文案使用中文；语言切换作为持久化设置，不扩展完整英文翻译。

- [ ] **Step 7: 验证**

Run: `cd frontend && pnpm test -- Auth Profile Settings Avatar && pnpm build`

Expected: 注册、登录、受保护路由、头像、资料、设置、退出闭环通过。

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/auth frontend/src/features/profile frontend/src/features/preferences frontend/src/pages frontend/src/app
git commit -m "feat(frontend): complete account and preference prototype flows"
```

---

### Task 10: 建立 Playwright、axe 与可复用 E2E fixtures

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/pnpm-lock.yaml`
- Create: `frontend/playwright.config.ts`
- Create: `frontend/e2e/fixtures/app.fixture.ts`
- Create: `frontend/e2e/fixtures/api.fixture.ts`
- Create: `frontend/e2e/fixtures/agent.fixture.ts`
- Create: `frontend/e2e/global.setup.ts`

- [ ] **Step 1: 安装端到端依赖**

Run:

```bash
cd frontend
pnpm add -D @playwright/test @axe-core/playwright
pnpm exec playwright install chromium firefox webkit
```

在 scripts 中加入：

```json
{
  "e2e": "playwright test",
  "e2e:mock": "playwright test --grep-invert @real",
  "e2e:real": "playwright test --grep @real --project=real-chromium",
  "e2e:update": "playwright test e2e/mock/visual.spec.ts --update-snapshots"
}
```

- [ ] **Step 2: 配置浏览器项目**

```ts
projects: [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  { name: 'real-chromium', grep: /@real/, use: { ...devices['Desktop Chrome'] } },
]
```

Mock 项目启动 `VITE_ENABLE_MSW=true pnpm dev --host 127.0.0.1`；真实项目读取 `E2E_BASE_URL`，不自行启动 MSW。

- [ ] **Step 3: 实现 app fixture**

fixture 在每个测试前：

- 清理 localStorage。
- 设置固定时间 `2026-07-13T10:00:00+08:00`。
- 创建演示 session。
- 关闭非目标动画，视觉测试单独恢复标准动效。

- [ ] **Step 4: 实现 API 与 Agent fixtures**

`api.fixture.ts` 提供 `seedTodos()`、`failNextTodoRequest()`；`agent.fixture.ts` 提供 success、timeout、confirmation 事件序列。fixture 不依赖测试执行顺序。

- [ ] **Step 5: 写第一个 smoke E2E**

```ts
test('loads the authenticated task dashboard', async ({ page, login }) => {
  await login()
  await page.goto('/tasks')
  await expect(page.getByRole('heading', { name: '今天，保持专注' })).toBeVisible()
})
```

- [ ] **Step 6: 验证**

Run: `cd frontend && pnpm e2e:mock --project=chromium --grep "authenticated task dashboard"`

Expected: 1 passed。

- [ ] **Step 7: Commit**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml frontend/playwright.config.ts frontend/e2e
git commit -m "test(frontend): establish browser test harness"
```

---

### Task 11: 编写 Mock 全功能 E2E 套件

**Files:**
- Create: `frontend/e2e/mock/auth.spec.ts`
- Create: `frontend/e2e/mock/navigation.spec.ts`
- Create: `frontend/e2e/mock/tasks.spec.ts`
- Create: `frontend/e2e/mock/upcoming.spec.ts`
- Create: `frontend/e2e/mock/assistant.spec.ts`
- Create: `frontend/e2e/mock/profile-settings.spec.ts`

- [ ] **Step 1: 覆盖认证与账户流程**

`auth.spec.ts` 覆盖：注册校验、注册成功回登录、登录失败、登录成功、受保护路由、退出取消、确认退出回登录。

- [ ] **Step 2: 覆盖导航与 Shell**

`navigation.spec.ts` 覆盖：四页面切换、左栏图标/文字状态、左栏状态持久化、Agent 完全收起、紫色按钮位置、Command/Alt+K、Escape 与焦点恢复。

- [ ] **Step 3: 覆盖任务全生命周期**

`tasks.spec.ts` 按独立测试覆盖：

```ts
test('creates, edits, completes, reopens and deletes a task', async ({ page, login }) => {
  await login()
  await page.goto('/tasks')
  await page.getByRole('button', { name: '新建任务' }).click()
  await page.getByLabel('任务标题').fill('端到端任务')
  await page.getByRole('button', { name: '创建任务' }).click()
  await expect(page.getByText('端到端任务')).toBeVisible()
  // 继续详情、编辑、完成、取消完成、删除确认
})
```

另覆盖搜索防抖、状态筛选、优先级筛选、排序、分页、加载骨架、空列表、无结果、500 重试、提交失败保留表单。

- [ ] **Step 4: 覆盖近期安排**

日期切换、空日期、显示已完成、添加安排、查看详情、完成任务。

- [ ] **Step 5: 覆盖 Agent 全状态**

侧栏和独立工作区分别覆盖：成功多步、等待计时、工具失败、重试、删除确认、Action 完成刷新 Todo、断线和清空历史。

- [ ] **Step 6: 覆盖资料与设置**

名称/时区保存、预设头像、非法上传、合法头像预览、主题选择、Agent 默认状态、退出登录。

- [ ] **Step 7: 运行 Chromium Mock 全量**

Run: `cd frontend && pnpm e2e:mock --project=chromium`

Expected: 全部通过，无 flaky retry。

- [ ] **Step 8: Commit**

```bash
git add frontend/e2e/mock
git commit -m "test(frontend): cover all product flows with deterministic E2E"
```

---

### Task 12: 视觉回归、键盘与可访问性验证

**Files:**
- Create: `frontend/e2e/mock/visual.spec.ts`
- Create: `frontend/e2e/mock/accessibility.spec.ts`
- Create: `frontend/e2e/snapshots/`
- Create: `docs/qa/visual-review.md`

- [ ] **Step 1: 建立 V6 视觉基准清单**

在 `visual-review.md` 记录六个页面和十种弹窗/浮层的基准视口、原型对应状态和截图文件名。不得只写“看起来一致”，必须列出导航宽度、Agent 宽度、按钮顺序、弹窗尺寸和关键颜色。

- [ ] **Step 2: 写桌面截图测试**

```ts
await expect(page).toHaveScreenshot('tasks-agent-expanded.png', {
  fullPage: true,
  animations: 'disabled',
  maxDiffPixelRatio: 0.01,
})
```

截图覆盖：任务 Agent 展开/收起、近期安排、助手、资料、登录、注册、任务弹窗、删除确认、设置、头像、快捷输入、Agent 运行/失败。

- [ ] **Step 3: 写 axe 测试**

```ts
const results = await new AxeBuilder({ page }).analyze()
expect(results.violations).toEqual([])
```

对六个页面与所有 modal 状态执行。对确实无法即时消除的第三方规则不得直接全局 disable；必须按具体 rule 和 DOM 记录原因。

- [ ] **Step 4: 写键盘流程测试**

仅用 Tab/Shift+Tab/Enter/Space/Escape 完成新建任务、筛选、打开/关闭 Agent、打开快捷询问和退出确认。断言焦点不逃出 Dialog。

- [ ] **Step 5: 写 reduced-motion 测试**

使用 `page.emulateMedia({ reducedMotion: 'reduce' })`，断言 Shell 与 Dialog 的计算样式动画时长不超过 1ms。

- [ ] **Step 6: 人工批准截图基线**

Run: `cd frontend && pnpm e2e:update --project=chromium`

逐张与 V6 原型对照后才提交 snapshot；禁止在功能失败时批量刷新基线。

- [ ] **Step 7: Commit**

```bash
git add frontend/e2e/mock frontend/e2e/snapshots docs/qa/visual-review.md
git commit -m "test(frontend): add visual and accessibility gates"
```

---

### Task 13: 建立真实服务端到端测试与确定性数据

**Files:**
- Create: `docker-compose.e2e.yml`
- Create: `data/e2e-init.sql`
- Create: `frontend/e2e/real/health.spec.ts`
- Create: `frontend/e2e/real/todo-lifecycle.spec.ts`
- Create: `frontend/e2e/real/agent-stream.spec.ts`
- Modify: `docker-compose.yml`
- Modify: `frontend/nginx.conf`
- Modify: `frontend/Dockerfile`

- [ ] **Step 1: 新增独立 E2E Compose**

`docker-compose.e2e.yml` 使用独立 volume 和端口，注入确定性测试数据，并将前端 `/api/todos` 代理到 Go 服务、`/api/agent` 与 WebSocket 代理到 Agent 服务。所有服务增加 healthcheck。

- [ ] **Step 2: 创建幂等种子数据**

`data/e2e-init.sql` 使用固定 ID 与 `ON CONFLICT DO UPDATE`，包含四条设计规格示例任务；每次套件启动前销毁 E2E volume，避免测试相互污染。

- [ ] **Step 3: 写真实健康检查测试**

```ts
test('@real all services are healthy', async ({ request }) => {
  await expect((await request.get('/api/health')).ok()).toBeTruthy()
  await expect((await request.get('/api/agent/health')).ok()).toBeTruthy()
})
```

- [ ] **Step 4: 写真实 Todo 生命周期**

通过浏览器 UI 创建、搜索、编辑、完成、取消完成和删除，并用 Playwright `request` 验证数据库背后的 API 状态变化。不得直接依赖 MSW。

- [ ] **Step 5: 写真实 Agent 流测试**

使用测试模型配置或 Agent 的确定性 fake LLM provider，发送“创建高优先级任务：真实联调任务”，断言页面收到 `step_started`、`action_completed`、`reply`、`done`，并在 Todo API 中查询到创建结果。

- [ ] **Step 6: 一键运行真实 E2E**

Run:

```bash
docker compose -f docker-compose.yml -f docker-compose.e2e.yml down -v
docker compose -f docker-compose.yml -f docker-compose.e2e.yml up -d --build --wait
cd frontend && E2E_BASE_URL=http://127.0.0.1:3000 pnpm e2e:real
docker compose -f ../docker-compose.yml -f ../docker-compose.e2e.yml down -v
```

Expected: health、Todo 生命周期、Agent stream 全部通过。

- [ ] **Step 7: Commit**

```bash
git add docker-compose.e2e.yml data/e2e-init.sql frontend/e2e/real frontend/nginx.conf frontend/Dockerfile docker-compose.yml
git commit -m "test: add real-stack end-to-end verification"
```

---

### Task 14: 跨浏览器、覆盖率、性能与文档收口

**Files:**
- Modify: `frontend/vite.config.ts`
- Modify: `frontend/package.json`
- Modify: `README.md`
- Modify: `frontend/README.md`
- Modify: `docs/STATUS.md`
- Create: `docs/qa/e2e-matrix.md`
- Create: `docs/qa/release-checklist.md`

- [ ] **Step 1: 设定单元覆盖率门禁**

```ts
coverage: {
  provider: 'v8',
  thresholds: { lines: 85, functions: 85, branches: 80, statements: 85 },
  exclude: ['src/mocks/**', 'src/test/**'],
}
```

- [ ] **Step 2: 运行三浏览器 Mock E2E**

Run: `cd frontend && pnpm e2e:mock`

Expected: Chromium、Firefox、WebKit 全部通过；不允许用 browser-specific skip 隐藏产品缺陷。

- [ ] **Step 3: 运行最终质量矩阵**

```bash
cd frontend
pnpm lint
pnpm test:coverage
pnpm build
pnpm e2e:mock
cd ../backend && go test ./...
cd ../agent-service && uv run pytest -q
```

Expected: 全部退出码为 0，覆盖率达到门禁。

- [ ] **Step 4: 验证包体与关键体验**

- Vite 首屏入口 gzip 目标 `< 100KB`，路由继续懒加载。
- `/tasks` 在本地生产构建下首次可交互 `< 2s`。
- Shell 展开/收起无横向溢出。
- Agent 运行时任务页面仍可滚动和操作非冲突控件。

- [ ] **Step 5: 更新文档**

`e2e-matrix.md` 用表格列出每条产品功能对应的单元测试、Mock E2E、真实 E2E 和浏览器。`release-checklist.md` 记录最终命令、预期输出、截图审批和已知非 MVP 范围。

更新 STATUS：

- 前端页面与交互完成度。
- Agent 前端联调完成度。
- E2E 浏览器矩阵。
- 认证仍为本地原型适配器，不宣称服务端认证完成。

- [ ] **Step 6: 最终人工验收**

按设计规格第 11 节八条完整路径，在 `1223 × 1227px` 视口手动走查。每条路径记录 PASS、截图和执行时间；任何无响应按钮都视为失败。

- [ ] **Step 7: Commit**

```bash
git add frontend README.md docs
git commit -m "docs: finalize frontend rebuild verification"
```

---

## 最终完成标准

只有同时满足以下条件才可宣布重构完成：

1. V6 原型中六个页面、十类弹窗/浮层和三种 Agent 入口全部存在并可交互。
2. Todo CRUD、搜索、筛选、排序、分页、完成/取消完成全部连接真实 Go API。
3. Agent 侧栏和独立工作区连接真实 WebSocket，完整展示多步状态、失败、重试和确认。
4. 登录、注册、资料、头像、设置和退出使用本地 adapter 形成闭环，并明确不等同于服务端认证。
5. 前端 lint、单元测试、覆盖率和 build 全绿。
6. 后端与 Agent 测试全绿。
7. Mock E2E 在 Chromium、Firefox、WebKit 全绿。
8. 真实 Chromium E2E 覆盖健康检查、Todo 生命周期和 Agent 创建任务。
9. axe 无未解释违规，键盘路径可完成关键操作。
10. 视觉截图经人工与 V6 基准逐张确认，没有通过刷新基线掩盖回归。
