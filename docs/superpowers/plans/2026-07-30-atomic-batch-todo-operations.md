# Atomic Batch Todo Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add atomic 1–100 item Todo batch operations to the Go API, Agent tools, and traditional task UI, with one confirmation for batch deletion.

**Architecture:** The Go service exposes five dedicated batch endpoints and delegates each write to a repository-controlled PostgreSQL transaction. Agent tools call those endpoints once per batch and reuse the durable confirmation protocol for destructive batches. React Query exposes batch mutations to a selection-aware task dashboard with focused dialogs and one result notification.

**Tech Stack:** Go 1.24, Gin, GORM, PostgreSQL, Python 3.12, FastAPI/LangChain, React 19, TypeScript 6, TanStack Query, Vitest, pytest, Playwright, Docker Compose.

---

### Task 1: Backend batch domain contract and validation

**Files:**
- Create: `backend/internal/service/todo_batch_service.go`
- Create: `backend/internal/service/todo_batch_service_test.go`
- Modify: `backend/internal/service/todo_service.go`

- [ ] **Step 1: Write failing service tests**

Add table-driven tests for empty input, 101 items, duplicate IDs, independent update patches, invalid resulting todos, missing IDs, response order, and all-or-nothing behavior. Use the following public request types in assertions:

```go
type BatchIDsRequest struct { IDs []uint `json:"ids"` }
type BatchCreateRequest struct { Items []CreateTodoRequest `json:"items"` }
type BatchUpdateItem struct {
    ID uint `json:"id"`
    UpdateTodoRequest
}
type BatchUpdateRequest struct { Items []BatchUpdateItem `json:"items"` }
type BatchStatusRequest struct {
    IDs []uint `json:"ids"`
    Completed bool `json:"completed"`
}
type BatchTodosResponse struct {
    Items []model.Todo `json:"items"`
    Count int `json:"count"`
}
```

- [ ] **Step 2: Verify RED**

Run: `cd backend && go test ./internal/service -run Batch -count=1`

Expected: compilation fails because the batch request types and methods do not exist.

- [ ] **Step 3: Implement validation and service methods**

Define `ErrInvalidBatch`, `BatchItemError`, the 1–100 cardinality helper, positive unique ID validation, and `BatchCreate`, `BatchGet`, `BatchUpdate`, `BatchSetStatus`, and `BatchDelete`. Extend `TodoRepository` with explicit batch methods. Preserve request ordering in every response.

- [ ] **Step 4: Verify GREEN**

Run: `cd backend && go test ./internal/service -run Batch -count=1`

Expected: all batch service tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/service/todo_service.go backend/internal/service/todo_batch_service.go backend/internal/service/todo_batch_service_test.go
git commit -m "feat(backend): define atomic todo batch service"
git push origin master
```

### Task 2: Repository transactions and row ordering

**Files:**
- Create: `backend/internal/repository/todo_batch_repo.go`
- Create: `backend/internal/repository/todo_batch_repo_test.go`
- Modify: `backend/internal/repository/todo_repo.go`

- [ ] **Step 1: Write failing repository tests**

Cover batch create, ordered get, transactional update, status update, delete snapshots, a missing target rollback, and 100-item success. For update, assert a callback failure leaves every row unchanged. For delete, assert returned snapshots follow request order.

- [ ] **Step 2: Verify RED**

Run: `cd backend && go test ./internal/repository -run Batch -count=1`

Expected: compilation fails because batch repository methods do not exist.

- [ ] **Step 3: Implement repository transactions**

Add methods with these responsibilities:

```go
func (r *TodoRepository) CreateBatch(todos []*model.Todo) error
func (r *TodoRepository) GetByIDs(ids []uint) ([]model.Todo, error)
func (r *TodoRepository) UpdateBatch(ids []uint, mutate func(map[uint]*model.Todo) error) ([]model.Todo, error)
func (r *TodoRepository) SetCompletedBatch(ids []uint, completed bool) ([]model.Todo, error)
func (r *TodoRepository) DeleteBatch(ids []uint) ([]model.Todo, error)
```

Every write uses `db.Transaction`. Update, status, and delete sort a copy of IDs and use `clause.Locking{Strength: "UPDATE"}` before mutation. Return `gorm.ErrRecordNotFound` when the loaded count differs from the requested count. Reconstruct output using the original request order.

- [ ] **Step 4: Verify GREEN and regression**

Run: `cd backend && go test ./internal/repository ./internal/service -count=1`

Expected: repository and service suites pass.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/repository backend/internal/service
git commit -m "feat(backend): transact todo batch writes"
git push origin master
```

### Task 3: Batch HTTP handlers and route contract

**Files:**
- Create: `backend/internal/handler/todo_batch_handler.go`
- Create: `backend/internal/handler/todo_batch_handler_test.go`
- Modify: `backend/internal/handler/todo_handler.go`
- Modify: `backend/cmd/server/main_test.go`

- [ ] **Step 1: Write failing handler and integration tests**

Test all five endpoints, structured `40002` errors, `40401`, `201` for batch create, ordered response items, and one real SQLite-backed create→get→update→status→delete flow.

- [ ] **Step 2: Verify RED**

Run: `cd backend && go test ./internal/handler ./cmd/server -run Batch -count=1`

Expected: requests return 404 because batch routes are missing.

- [ ] **Step 3: Register routes before `/:id` routes**

Register the static batch paths before parameterized routes:

```go
todoGroup.POST("/batch", h.BatchCreateTodos)
todoGroup.POST("/batch/get", h.BatchGetTodos)
todoGroup.PUT("/batch", h.BatchUpdateTodos)
todoGroup.PATCH("/batch/status", h.BatchSetTodoStatus)
todoGroup.DELETE("/batch", h.BatchDeleteTodos)
```

Map `BatchItemError` to code `40002` with `data.index`, `data.id`, and `data.field`; map missing todos to `40401`; preserve existing internal errors.

- [ ] **Step 4: Verify GREEN and full backend**

Run: `cd backend && go test ./... -count=1`

Expected: all backend tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/handler backend/cmd/server/main_test.go
git commit -m "feat(backend): expose todo batch endpoints"
git push origin master
```

### Task 4: Agent batch tools and prompt routing

**Files:**
- Modify: `agent-service/app/tools.py`
- Modify: `agent-service/app/agent.py`
- Modify: `agent-service/app/prompts.py`
- Modify: `agent-service/tests/test_tools.py`
- Modify: `agent-service/tests/test_agent.py`

- [ ] **Step 1: Write failing tool tests**

For each batch function, assert exactly one HTTP request with the correct method, path, and body. Add boundary tests for empty and 101-item arrays. Add Agent tests that bind the five new LangChain tools and execute a model-produced batch call as one action.

- [ ] **Step 2: Verify RED**

Run: `cd agent-service && uv run pytest tests/test_tools.py tests/test_agent.py -k batch -q`

Expected: imports fail because batch tools do not exist.

- [ ] **Step 3: Implement tools and binding**

Add typed tools that call `/todos/batch`, `/todos/batch/get`, and `/todos/batch/status` once. Register them in `_tool_defs`, include `batch_get_todos` in `READ_ONLY_RETRY_TOOLS`, and update the system prompt: one target uses a single tool; two or more targets use a batch tool.

- [ ] **Step 4: Verify GREEN**

Run: `cd agent-service && uv run pytest tests/test_tools.py tests/test_agent.py -k batch -q`

Expected: all batch tool and routing tests pass.

- [ ] **Step 5: Commit**

```bash
git add agent-service/app agent-service/tests/test_tools.py agent-service/tests/test_agent.py
git commit -m "feat(agent): add todo batch tools"
git push origin master
```

### Task 5: One-confirmation batch delete and durable events

**Files:**
- Modify: `agent-service/app/agent.py`
- Modify: `agent-service/tests/test_agent.py`
- Modify: `agent-service/tests/test_durable_stream.py`
- Modify: `frontend/src/features/agent/agent.types.ts`
- Modify: `frontend/src/features/agent/agent.schema.ts`
- Modify: `frontend/src/features/agent/__tests__/useAgentSession.test.tsx`

- [ ] **Step 1: Write failing confirmation tests**

Assert `batch_delete_todos` emits one `confirmation_required`, approval invokes the tool once, rejection invokes it zero times, the confirmed `action_completed` event carries confirmation metadata, and replay after a post-dispatch transport fault never invokes the write twice.

- [ ] **Step 2: Verify RED**

Run: `cd agent-service && uv run pytest tests/test_agent.py tests/test_durable_stream.py -k batch_delete -q`

Expected: batch delete runs without the required confirmation path.

- [ ] **Step 3: Generalize destructive-tool confirmation**

Replace direct `name == "delete_todo"` checks with a destructive-tool set containing `delete_todo` and `batch_delete_todos`. Build batch confirmation text from the request count and bounded ID preview. Keep a single confirmation ID bound to the complete tool call.

- [ ] **Step 4: Verify Agent and frontend contract**

Run:

```bash
cd agent-service && uv run pytest tests/test_agent.py tests/test_durable_stream.py -k 'batch_delete or confirmation' -q
cd ../frontend && pnpm test src/features/agent/__tests__/useAgentSession.test.tsx
```

Expected: confirmation and frontend event-contract tests pass.

- [ ] **Step 5: Commit**

```bash
git add agent-service frontend/src/features/agent
git commit -m "feat(agent): confirm batch deletes once"
git push origin master
```

### Task 6: Frontend batch API and React Query mutations

**Files:**
- Modify: `frontend/src/features/todos/todo.types.ts`
- Modify: `frontend/src/features/todos/todo.api.ts`
- Modify: `frontend/src/features/todos/todo.queries.ts`
- Modify: `frontend/src/features/todos/__tests__/todo.queries.test.ts`

- [ ] **Step 1: Write failing API and mutation tests**

Cover five endpoint calls, strict response validation, structured batch errors, list/detail invalidation, and selection-safe mutation rejection.

- [ ] **Step 2: Verify RED**

Run: `cd frontend && pnpm test src/features/todos/__tests__/todo.queries.test.ts`

Expected: batch API functions and hooks are missing.

- [ ] **Step 3: Implement batch DTOs, validators, and hooks**

Add `BatchTodoResponse`, `BatchUpdateTodoDTO`, and `BatchErrorData`; allow `ApiError` to retain validated batch error data. Add `batchCreateTodos`, `batchGetTodos`, `batchUpdateTodos`, `batchSetTodoStatus`, `batchDeleteTodos` plus corresponding hooks. Invalidate todo list and detail keys only after success.

- [ ] **Step 4: Verify GREEN**

Run: `cd frontend && pnpm test src/features/todos/__tests__/todo.queries.test.ts`

Expected: Todo API/query tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/todos
git commit -m "feat(frontend): add todo batch data hooks"
git push origin master
```

### Task 7: Task-page selection and batch UI

**Files:**
- Create: `frontend/src/features/todos/BatchActionBar.tsx`
- Create: `frontend/src/features/todos/BatchEditDialog.tsx`
- Create: `frontend/src/features/todos/__tests__/BatchEditDialog.test.tsx`
- Modify: `frontend/src/features/todos/TaskCard.tsx`
- Modify: `frontend/src/features/todos/TaskDashboard.tsx`
- Modify: `frontend/src/features/todos/__tests__/TaskDashboard.test.tsx`

- [ ] **Step 1: Write failing interaction tests**

Test entering selection mode, selecting one task, selecting the current page, retaining selections across pagination, the 100-item cap, clearing on search/filter/sort change, applying opted-in fields, one delete confirmation, pending-state locking, clearing after success, and preserving selection after failure.

- [ ] **Step 2: Verify RED**

Run: `cd frontend && pnpm test src/features/todos/__tests__/TaskDashboard.test.tsx src/features/todos/__tests__/BatchEditDialog.test.tsx`

Expected: selection controls and batch dialogs are absent.

- [ ] **Step 3: Implement selection UI**

Store selected todos as `Map<number, Todo>` so cross-page labels remain available. Add a header “选择/退出选择” control, current-page checkbox, card checkboxes in selection mode, fixed `BatchActionBar`, field-opt-in `BatchEditDialog`, and one batch-delete `ConfirmDialog`. Clear selection when the query definition changes but not when only `page` changes.

- [ ] **Step 4: Verify GREEN, accessibility, and build**

Run:

```bash
cd frontend
pnpm test src/features/todos/__tests__/TaskDashboard.test.tsx src/features/todos/__tests__/BatchEditDialog.test.tsx
pnpm lint
pnpm build
```

Expected: interaction tests, lint, and production build pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/todos
git commit -m "feat(frontend): add task batch actions"
git push origin master
```

### Task 8: Mock transport, documentation, full verification, and deployment

**Files:**
- Modify: `frontend/src/mocks/handlers.ts`
- Modify: `frontend/e2e/fixtures/mock-transport.ts`
- Create: `frontend/e2e/mock/todo-batch.spec.ts`
- Create: `frontend/e2e/real/todo-batch.real.spec.ts`
- Modify: `docs/API.md`
- Modify: `docs/AGENT_PROMPT.md`
- Modify: `docs/PRD.md`
- Modify: `docs/STATUS.md`
- Modify: `README.md`

- [ ] **Step 1: Write failing mock and real E2E scenarios**

The mock test selects across pages, batch edits, restores, and deletes with one dialog. The authenticated real test creates three uniquely named todos through one Agent batch call, gets them once, applies different updates once, completes/restores them once, and deletes them after one confirmation.

- [ ] **Step 2: Implement mock routes and fixtures**

Mirror all five backend endpoints with the same 1–100 validation and atomic failure behavior. Make mock Agent fixtures emit a single step for each batch tool.

- [ ] **Step 3: Update documentation**

Document endpoint schemas, atomicity, Agent tool selection, confirmation behavior, task-page interaction, and release status in the five listed documents.

- [ ] **Step 4: Run complete verification**

Run:

```bash
cd backend && go test ./... -count=1
cd ../agent-service && uv run pytest
cd ../frontend && pnpm test && pnpm lint && pnpm build && pnpm e2e:mock
```

Expected: every suite exits zero with no failed tests.

- [ ] **Step 5: Commit and push release**

```bash
git add README.md docs frontend
git commit -m "test: verify atomic todo batch workflows"
git push origin master
```

- [ ] **Step 6: Rebuild and verify Docker stack**

Run:

```bash
docker compose --env-file .env -p todolist-agent build backend agent frontend
docker compose --env-file .env -p todolist-agent up -d --force-recreate --wait
docker compose --env-file .env -p todolist-agent ps
```

Expected: postgres, redis, backend, agent, and frontend are all running and healthy. Execute the real browser batch flow, confirm one request per operation, and confirm no console errors.
