# Durable Assistant History and Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build trusted server-side authentication, user-isolated durable Agent sessions with complete turn history, and a focused Assistant workspace with safe GFM Markdown, per-turn collapsible execution details, and a compact bottom composer.

**Architecture:** The Go Backend issues and revokes HttpOnly cookie sessions. The Python Agent validates the same access JWT, owns PostgreSQL persistence for Agent sessions/turns/messages/steps, and commits a final reply before emitting `done`. The React client consumes authenticated session APIs, models history as turns, renders safe GFM, and keeps the composer outside the only scroll container.

**Tech Stack:** Go 1.26, Gin, GORM, PostgreSQL 16, JWT HS256, Argon2id, Python 3.12, FastAPI, asyncpg, PyJWT, React 19, TanStack Query, react-markdown, remark-gfm, Vitest, pytest, Playwright, Docker Compose.

---

## File map

### Database and deployment

- Modify `data/init.sql`: production schema for auth and Agent history.
- Modify `data/e2e-init.sql`: deterministic E2E users/session fixtures only where a test cannot create them through public APIs.
- Create `scripts/migrate.sql`: idempotent migration for an already-populated PostgreSQL volume.
- Modify `docker-compose.yml`: shared auth and database settings for Backend and Agent.
- Modify `.env.example`: non-secret configuration names and safe development defaults.

### Go Backend authentication

- Create `backend/internal/model/user.go`: User and AuthSession persistence models.
- Create `backend/internal/repository/auth_repo.go`: user/session database boundary.
- Create `backend/internal/service/auth_service.go`: password hashing, login, refresh and revocation.
- Create `backend/internal/middleware/auth.go`: JWT validation and authenticated user context.
- Create `backend/internal/handler/auth_handler.go`: auth HTTP contract and Cookie management.
- Modify `backend/internal/database/db.go`: migrate auth models.
- Modify `backend/cmd/server/main.go`: wire auth dependencies and config.
- Modify `backend/internal/handler/todo_handler.go`: register auth routes separately while preserving Todo API behavior.

### Python Agent persistence

- Create `agent-service/app/auth.py`: access Cookie/JWT and Origin validation.
- Create `agent-service/app/history_models.py`: typed session/turn/message/step records.
- Create `agent-service/app/history_repository.py`: asyncpg repository and transaction boundary.
- Create `agent-service/app/history_service.py`: ownership, title, truncation, interruption and deletion rules.
- Modify `agent-service/app/main.py`: lifespan pool, authenticated REST/WS endpoints.
- Modify `agent-service/app/agent.py`: durable turn lifecycle and per-event checkpoint hooks.
- Modify `agent-service/app/schemas.py`: session/history response models and stable event IDs.
- Modify `agent-service/pyproject.toml` and `agent-service/uv.lock`: asyncpg and PyJWT.

### React frontend

- Create `frontend/src/features/auth/auth.api.ts`: Cookie-based auth adapter with one refresh retry.
- Modify `frontend/src/features/auth/AuthContext.tsx`, `auth.types.ts`, `auth-context.ts`: server session source of truth.
- Retire credential persistence from `frontend/src/features/auth/auth.storage.ts`; keep only non-sensitive profile presentation storage where required.
- Create `frontend/src/features/agent/AgentMarkdown.tsx`: safe GFM renderer.
- Create `frontend/src/features/agent/AgentTurn.tsx`: message pair and owned timeline disclosure.
- Create `frontend/src/features/agent/AgentSessionList.tsx`: grouped session navigation and CRUD controls.
- Create `frontend/src/features/agent/agent-history.api.ts`: session list/detail CRUD.
- Modify `frontend/src/features/agent/agent.types.ts`, `agent.schema.ts`, `agent.reducer.ts`, `useAgentSession.ts`, `AgentSessionContext.tsx`: turn-oriented durable state.
- Modify `frontend/src/pages/AssistantPage.tsx`: focused stream and compact fixed composer.
- Modify `frontend/src/styles/global.css`: Markdown, table, disclosure, session list and layout styles.

### Tests and documentation

- Create focused Go, pytest and Vitest test files named in each task below.
- Modify `frontend/e2e/mock/assistant.spec.ts` and create `frontend/e2e/real/assistant-history.spec.ts`.
- Modify `docs/API.md`, `docs/ARCHITECTURE.md`, `README.md` and deployment examples.

---

## Task 1: Add the durable schema and shared configuration

**Files:**
- Modify: `data/init.sql`
- Create: `scripts/migrate.sql`
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Test: `backend/internal/database/db_test.go`

- [ ] **Step 1: Write a failing schema contract test**

Add a test that initializes SQLite through `database.InitDB` and asserts all six new tables exist:

```go
func TestInitDBMigratesAuthModels(t *testing.T) {
    db, err := InitDB(Config{Driver: "sqlite", DSN: ":memory:"})
    require.NoError(t, err)
    for _, table := range []string{"users", "auth_sessions"} {
        assert.True(t, db.Migrator().HasTable(table), table)
    }
}
```

The Agent repository integration test added in Task 5 will assert `agent_sessions`, `agent_turns`, `agent_messages`, and `agent_steps` in PostgreSQL.

- [ ] **Step 2: Run the test and verify RED**

Run: `cd backend && go test ./internal/database -run TestInitDBMigratesAuthModels -v`

Expected: FAIL because auth models/tables do not exist.

- [ ] **Step 3: Add the production schema**

Use UUID keys, cascading foreign keys, status checks, and ownership indexes. The migration must contain these invariants:

```sql
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email CITEXT UNIQUE NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash CHAR(64) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_sessions (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(160) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_owner_recent
  ON agent_sessions(owner_id, last_message_at DESC);
```

Add `agent_turns`, `agent_messages`, and `agent_steps` exactly as specified in the approved design, including unique `(session_id, ordinal)`, unique `event_id`, JSONB fields, status checks and cascading deletion. `scripts/migrate.sql` must be idempotent and drop the unused `conversations` table only after all new tables are created.

- [ ] **Step 4: Add Compose configuration**

Pass the same settings to Backend and Agent without embedding secrets in images:

```yaml
AUTH_JWT_SECRET: ${AUTH_JWT_SECRET:?AUTH_JWT_SECRET is required}
AUTH_ACCESS_COOKIE: ${AUTH_ACCESS_COOKIE:-todolist_access}
AUTH_REFRESH_COOKIE: ${AUTH_REFRESH_COOKIE:-todolist_refresh}
AUTH_ALLOWED_ORIGINS: ${AUTH_ALLOWED_ORIGINS:-http://localhost:3000}
DATABASE_URL: postgresql://${POSTGRES_USER:-todolist}:${POSTGRES_PASSWORD:-changeme}@postgres:5432/${POSTGRES_DB:-todolist}
```

Add `postgres` as an Agent dependency with `condition: service_healthy`. Add safe names and generation guidance to `.env.example`; never add a real secret.

- [ ] **Step 5: Run formatting and schema tests**

Run: `cd backend && gofmt -w internal/database/db_test.go && go test ./internal/database -v`

Expected: PASS after Task 2 adds the GORM models and migration list. Until then, keep this test red and commit only together with Task 2.

- [ ] **Step 6: Commit and push the schema node after Task 2 turns it green**

```bash
git add data/init.sql scripts/migrate.sql docker-compose.yml .env.example backend/internal/database
git commit -m "feat: add durable auth and agent history schema"
git push -u origin codex/assistant-history-workspace
```

## Task 2: Implement Backend auth models and repository

**Files:**
- Create: `backend/internal/model/user.go`
- Create: `backend/internal/repository/auth_repo.go`
- Create: `backend/internal/repository/auth_repo_test.go`
- Modify: `backend/internal/database/db.go`
- Modify: `backend/go.mod`
- Modify: `backend/go.sum`

- [ ] **Step 1: Write repository tests**

Cover normalized email uniqueness, refresh lookup, revocation and expiry:

```go
func TestAuthRepositoryFindsNormalizedEmailAndRevokesSession(t *testing.T) {
    db := testDB(t)
    repo := NewAuthRepository(db)
    user := &model.User{ID: uuid.NewString(), Email: "person@example.com", DisplayName: "Person", PasswordHash: "hash"}
    require.NoError(t, repo.CreateUser(context.Background(), user))
    found, err := repo.FindUserByEmail(context.Background(), "PERSON@example.com")
    require.NoError(t, err)
    assert.Equal(t, user.ID, found.ID)
    session := &model.AuthSession{ID: uuid.NewString(), UserID: user.ID, RefreshTokenHash: "hash-token", ExpiresAt: time.Now().Add(time.Hour)}
    require.NoError(t, repo.CreateSession(context.Background(), session))
    require.NoError(t, repo.RevokeSession(context.Background(), session.ID, time.Now()))
}
```

- [ ] **Step 2: Verify RED**

Run: `cd backend && go test ./internal/repository ./internal/database -run 'Auth|MigratesAuth' -v`

Expected: compile failure for missing auth models and repository.

- [ ] **Step 3: Implement focused persistence models**

Define string UUID IDs and explicit table names:

```go
type User struct {
    ID string `gorm:"type:uuid;primaryKey" json:"id"`
    Email string `gorm:"type:citext;uniqueIndex;not null" json:"email"`
    DisplayName string `gorm:"size:120;not null" json:"name"`
    PasswordHash string `gorm:"not null" json:"-"`
    CreatedAt time.Time `json:"created_at"`
    UpdatedAt time.Time `json:"updated_at"`
}

type AuthSession struct {
    ID string `gorm:"type:uuid;primaryKey"`
    UserID string `gorm:"type:uuid;not null;index"`
    RefreshTokenHash string `gorm:"size:64;uniqueIndex;not null"`
    ExpiresAt time.Time
    RevokedAt *time.Time
    CreatedAt time.Time
    LastUsedAt time.Time
}
```

Repository methods must accept `context.Context` and return `gorm.ErrRecordNotFound` unchanged for service-level mapping.

Add `github.com/google/uuid` and use `uuid.NewString()` for user and auth-session IDs. Do not derive UUIDs from email addresses or refresh secrets.

- [ ] **Step 4: Migrate auth tables**

Change `InitDB` to migrate `Todo`, `User`, and `AuthSession` in one call and wrap failures with the model names in the error.

- [ ] **Step 5: Verify GREEN**

Run: `cd backend && go test ./internal/model ./internal/repository ./internal/database -v`

Expected: PASS.

- [ ] **Step 6: Commit with Task 1 and push**

Use the Task 1 commit command once both schema and repository tests are green.

## Task 3: Implement password, JWT, refresh and auth middleware

**Files:**
- Create: `backend/internal/service/auth_service.go`
- Create: `backend/internal/service/auth_service_test.go`
- Create: `backend/internal/middleware/auth.go`
- Create: `backend/internal/middleware/auth_test.go`
- Modify: `backend/go.mod`
- Modify: `backend/go.sum`

- [ ] **Step 1: Write service and middleware tests**

Required cases: Argon2id hash never contains password, valid password verifies, wrong password fails, access claims include `sub` and session ID, expired token fails, revoked refresh fails, and middleware rejects missing/invalid Cookies.

```go
func TestPasswordRoundTrip(t *testing.T) {
    hash, err := HashPassword("correct horse battery staple")
    require.NoError(t, err)
    assert.NotContains(t, hash, "correct horse")
    assert.True(t, VerifyPassword(hash, "correct horse battery staple"))
    assert.False(t, VerifyPassword(hash, "wrong"))
}
```

- [ ] **Step 2: Verify RED**

Run: `cd backend && go test ./internal/service ./internal/middleware -run Auth -v`

Expected: compile failure for missing auth service and middleware.

- [ ] **Step 3: Implement Argon2id and opaque refresh tokens**

Use a PHC string and constant-time comparison. Defaults:

```go
type PasswordParams struct { Memory uint32; Iterations uint32; Parallelism uint8; SaltLength uint32; KeyLength uint32 }
var DefaultPasswordParams = PasswordParams{Memory: 64 * 1024, Iterations: 3, Parallelism: 2, SaltLength: 16, KeyLength: 32}
```

Generate refresh tokens with `crypto/rand`, return the raw value only once, and persist `sha256(raw)`.

Encode the Cookie value as `<session_uuid>.<random_secret>`. Lookup uses only the UUID; validation hashes and constant-time compares the random secret. Refresh rotates to a new session UUID and secret in one database transaction, revoking the previous row before the response is committed.

- [ ] **Step 4: Implement signed access claims**

Use `github.com/golang-jwt/jwt/v5` and enforce HS256:

```go
type AccessClaims struct {
    SessionID string `json:"sid"`
    jwt.RegisteredClaims
}
```

Set `Subject=user.ID`, `IssuedAt`, `ExpiresAt=now+15m`, `Issuer="todolist-backend"`, and reject any unexpected signing method.

- [ ] **Step 5: Implement middleware**

Read only the configured access Cookie, validate claims, and store a typed principal:

```go
type Principal struct { UserID string; SessionID string }
const PrincipalKey = "auth.principal"
```

Return JSON code `40101` for missing/expired credentials. Add a reusable same-origin check for state-changing auth requests.

- [ ] **Step 6: Verify GREEN and commit**

Run: `cd backend && go test ./internal/service ./internal/middleware -v`

```bash
git add backend/go.mod backend/go.sum backend/internal/service backend/internal/middleware
git commit -m "feat(backend): add secure cookie authentication"
git push origin codex/assistant-history-workspace
```

## Task 4: Expose auth routes and wire Backend startup

**Files:**
- Create: `backend/internal/handler/auth_handler.go`
- Create: `backend/internal/handler/auth_handler_test.go`
- Modify: `backend/cmd/server/main.go`
- Modify: `backend/cmd/server/main_test.go`

- [ ] **Step 1: Write HTTP contract tests**

Test register `201`, duplicate email `409`, login `200` with access/refresh HttpOnly Cookies, `/me`, refresh rotation, logout Cookie deletion, invalid Origin `403`, and access after logout `401`.

Also test `PATCH /api/auth/me` for display name, email and timezone, including duplicate email rejection. `/me` must preserve the existing public Account shape and calculate `agentSessionCount` from `agent_sessions` for the authenticated user; it must never expose password/session hashes.

```go
func TestAuthLifecycle(t *testing.T) {
    app := setupAuthApp(t)
    register := jsonRequest(app, http.MethodPost, "/api/auth/register", `{"name":"A","email":"a@example.com","password":"password8"}`)
    require.Equal(t, http.StatusCreated, register.Code)
    login := jsonRequest(app, http.MethodPost, "/api/auth/login", `{"email":"a@example.com","password":"password8"}`)
    require.Equal(t, http.StatusOK, login.Code)
    assert.True(t, hasHttpOnlyCookie(login.Result(), "todolist_access"))
    assert.True(t, hasHttpOnlyCookie(login.Result(), "todolist_refresh"))
}
```

- [ ] **Step 2: Verify RED**

Run: `cd backend && go test ./internal/handler ./cmd/server -run Auth -v`

Expected: FAIL because routes are absent.

- [ ] **Step 3: Implement handlers and Cookie policy**

Cookie settings must be centralized:

```go
type CookieConfig struct {
    AccessName string
    RefreshName string
    Secure bool
    Domain string
}
```

Return public Account JSON only. Register does not authenticate; login issues both Cookies. Refresh rotates the refresh session atomically. Logout revokes the current refresh session and expires both Cookies.

Register `GET /api/auth/me` and authenticated `PATCH /api/auth/me` so existing profile editing remains functional after localStorage auth is removed.

- [ ] **Step 4: Wire `SetupApp`**

Read `AUTH_JWT_SECRET`, fail startup if shorter than 32 bytes, build auth repository/service/handler, and register routes. Tests set a deterministic 32+ byte secret.

- [ ] **Step 5: Verify and commit**

Run: `cd backend && go test ./... -race`

Expected: all Backend tests PASS.

```bash
git add backend
git commit -m "feat(backend): expose server-side auth lifecycle"
git push origin codex/assistant-history-workspace
```

## Task 5: Build the Agent PostgreSQL history repository

**Files:**
- Create: `agent-service/app/history_models.py`
- Create: `agent-service/app/history_repository.py`
- Create: `agent-service/tests/test_history_repository.py`
- Modify: `agent-service/pyproject.toml`
- Modify: `agent-service/uv.lock`

- [ ] **Step 1: Add asyncpg and write integration tests**

Tests use `TEST_DATABASE_URL`, create two users, and prove owner filtering, ordered turns, idempotent step events, result truncation metadata, rename and cascade delete.

```python
@pytest.mark.asyncio
async def test_session_is_never_visible_to_another_owner(repo, users):
    session = await repo.create_session(users.alice, "Alice session")
    assert await repo.get_session(users.alice, session.id) is not None
    assert await repo.get_session(users.bob, session.id) is None
```

- [ ] **Step 2: Verify RED**

Run: `cd agent-service && uv sync --extra dev && uv run pytest tests/test_history_repository.py -q`

Expected: FAIL because repository modules are missing.

- [ ] **Step 3: Implement typed records and repository API**

Define immutable dataclasses/Pydantic records and this boundary:

```python
class HistoryRepository:
    async def list_sessions(self, owner_id: UUID) -> list[SessionSummary]:
        raise NotImplementedError
    async def create_session(self, owner_id: UUID, title: str) -> SessionSummary:
        raise NotImplementedError
    async def get_session(self, owner_id: UUID, session_id: UUID) -> SessionDetail | None:
        raise NotImplementedError
    async def rename_session(self, owner_id: UUID, session_id: UUID, title: str) -> SessionSummary | None:
        raise NotImplementedError
    async def delete_session(self, owner_id: UUID, session_id: UUID) -> bool:
        raise NotImplementedError
    async def start_turn(self, owner_id: UUID, session_id: UUID, turn_id: UUID, message_id: UUID, content: str, created_at: datetime) -> TurnRecord:
        raise NotImplementedError
    async def upsert_step(self, owner_id: UUID, turn_id: UUID, event: PersistedStepEvent) -> None:
        raise NotImplementedError
    async def complete_turn(self, owner_id: UUID, turn_id: UUID, message_id: UUID, content: str, created_at: datetime) -> None:
        raise NotImplementedError
    async def fail_turn(self, owner_id: UUID, turn_id: UUID, code: str, message: str, uncertain: bool) -> None:
        raise NotImplementedError
    async def interrupt_open_turns(self) -> int:
        raise NotImplementedError
```

Every SQL statement must join or filter through `owner_id`; no public method may accept only session ID for reads/deletes.

- [ ] **Step 4: Implement transactions and truncation**

Use asyncpg transactions for `start_turn` and `complete_turn`. Canonicalize JSON before checking its UTF-8 byte size. Save at most `AGENT_RESULT_MAX_BYTES=65536`; retain a 4096-character preview and `result_truncated=true` when over limit.

- [ ] **Step 5: Verify and commit**

Run: `cd agent-service && uv run pytest tests/test_history_repository.py -q`

```bash
git add agent-service/pyproject.toml agent-service/uv.lock agent-service/app/history_models.py agent-service/app/history_repository.py agent-service/tests/test_history_repository.py
git commit -m "feat(agent): persist user-owned conversation history"
git push origin codex/assistant-history-workspace
```

## Task 6: Add Agent authentication and session REST APIs

**Files:**
- Create: `agent-service/app/auth.py`
- Create: `agent-service/app/history_service.py`
- Create: `agent-service/tests/test_auth.py`
- Create: `agent-service/tests/test_history_api.py`
- Modify: `agent-service/app/main.py`
- Modify: `agent-service/app/schemas.py`

- [ ] **Step 1: Write JWT, Origin and ownership tests**

Cover no Cookie `401`, expired JWT `401`, non-HS256 rejection, revoked/rotated `auth_sessions` access Cookie `401`, bad Origin `403`, valid owner list/detail, cross-owner detail/rename/delete `404`, grouped ordered list, title validation, and deletion callback invocation.

- [ ] **Step 2: Verify RED**

Run: `cd agent-service && uv run pytest tests/test_auth.py tests/test_history_api.py -q`

Expected: FAIL because Agent endpoints are unauthenticated and session APIs do not exist.

- [ ] **Step 3: Implement shared JWT validation**

```python
@dataclass(frozen=True)
class AuthPrincipal:
    user_id: UUID
    session_id: UUID

def decode_access_cookie(request: Request, settings: AuthSettings) -> AuthPrincipal:
    payload = jwt.decode(token, settings.secret, algorithms=["HS256"], issuer="todolist-backend")
    return AuthPrincipal(user_id=UUID(payload["sub"]), session_id=UUID(payload["sid"]))
```

After signature validation, query `auth_sessions` by `sid`; accept it only when
it is active, unexpired, and owned by `sub`. This must mirror the Backend
access-session check so refresh/logout immediately invalidates old Browser
Cookies for Agent HTTP and WebSocket routes too.

For WebSockets, close with `4401` for auth failure and `4403` for Origin/ownership failure before reading a client frame.

- [ ] **Step 4: Implement CRUD endpoints**

Return envelope-compatible JSON. Session detail must be grouped by turn:

```json
{"session":{"id":"68d451f9-64ba-45eb-8118-87c8855badfe","title":"规划今天的任务"},"turns":[{"id":"0c108a5a-5b4d-49a5-a686-9fe4ad6293dc","status":"completed","messages":[],"steps":[]}]}
```

Generate a title from the first user message by collapsing whitespace and limiting to 48 Unicode characters. PATCH accepts only a trimmed title of 1–160 characters.

- [ ] **Step 5: Wire pool lifecycle and interrupted recovery**

Create an asyncpg pool in FastAPI lifespan, run `interrupt_open_turns()` once before readiness, and close the pool on shutdown. Health returns failure if a simple database query fails.

- [ ] **Step 6: Verify and commit**

Run: `cd agent-service && uv run pytest tests/test_auth.py tests/test_history_api.py -q`

```bash
git add agent-service/app agent-service/tests agent-service/pyproject.toml agent-service/uv.lock
git commit -m "feat(agent): authenticate durable session APIs"
git push origin codex/assistant-history-workspace
```

## Task 7: Persist the WebSocket turn lifecycle

**Files:**
- Modify: `agent-service/app/agent.py`
- Modify: `agent-service/app/main.py`
- Modify: `agent-service/app/schemas.py`
- Create: `agent-service/tests/test_durable_stream.py`
- Modify: `agent-service/tests/test_agent.py`
- Modify: `agent-service/tests/test_api.py`

- [ ] **Step 1: Write failing durable-stream tests**

Required assertions:

- user message exists before model/tool execution;
- every step event has a stable `event_id` and idempotent checkpoint;
- assistant reply and completed turn exist before `done` is emitted;
- persistence failure emits `step_failed(error_code="HISTORY_PERSISTENCE_FAILED")` and no success `done`;
- write action followed by persistence failure sets `result_uncertain=true` and cannot auto-retry;
- Agent restart marks open turns interrupted;
- after Agent restart, a new turn hydrates bounded completed message history from PostgreSQL before invoking the model;
- deleting an active session prevents late persistence.

```python
@pytest.mark.asyncio
async def test_done_is_emitted_only_after_reply_commit(stream_harness):
    events = await stream_harness.run("list tasks")
    done_index = next(i for i, event in enumerate(events) if event["type"] == "done")
    assert stream_harness.repo.completed_before_done is True
    assert done_index == len(events) - 1
```

- [ ] **Step 2: Verify RED**

Run: `cd agent-service && uv run pytest tests/test_durable_stream.py -q`

- [ ] **Step 3: Introduce a persistence sink without duplicating Agent logic**

Pass a `TurnPersistence` interface into `process_message`:

```python
class TurnPersistence(Protocol):
    async def start(self, request: DurableTurnRequest) -> None:
        raise NotImplementedError
    async def checkpoint(self, event: dict[str, Any]) -> None:
        raise NotImplementedError
    async def complete(self, reply: str) -> None:
        raise NotImplementedError
    async def fail(self, code: str, message: str, *, uncertain: bool) -> None:
        raise NotImplementedError
```

The existing in-memory action journal remains an execution-recovery cache, not the source of UI history.

When no live `_conversations` cache exists for an owned session, load completed persisted messages in ordinal order, convert them to LangChain human/AI messages, apply the existing `MAX_MESSAGES_PER_SESSION` trimming rule, and then process the new turn. Never hydrate tool results as free-standing messages or expose one owner's context to another.

- [ ] **Step 4: Establish event and commit ordering**

For step events: build stable event → persist checkpoint → send event. For the terminal reply: persist assistant message and completed turn → send reply chunks → send `done`. On persistence failure, do not continue with normal success events.

- [ ] **Step 5: Preserve retry/confirmation safety**

Bind retry tokens and confirmation IDs to owner/session/turn generation. A session loaded from history is not automatically retryable after restart unless the in-memory signed retry record still exists.

- [ ] **Step 6: Verify all Agent tests and commit**

Run: `cd agent-service && uv run pytest -q`

```bash
git add agent-service/app agent-service/tests
git commit -m "feat(agent): checkpoint complete turns before done"
git push origin codex/assistant-history-workspace
```

## Task 8: Replace browser-local auth with Cookie APIs

**Files:**
- Create: `frontend/src/features/auth/auth.api.ts`
- Create: `frontend/src/features/auth/__tests__/auth.api.test.ts`
- Create: `frontend/src/shared/api/authenticated-fetch.ts`
- Create: `frontend/src/shared/api/__tests__/authenticated-fetch.test.ts`
- Modify: `frontend/src/features/auth/AuthContext.tsx`
- Modify: `frontend/src/features/auth/auth.types.ts`
- Modify: `frontend/src/features/auth/auth-context.ts`
- Modify: `frontend/src/features/auth/auth.storage.ts`
- Modify: `frontend/src/pages/AuthPage.tsx`
- Modify: `frontend/src/pages/ProfilePage.tsx`
- Modify: `frontend/src/features/auth/__tests__/AuthContext.test.tsx`
- Modify: `frontend/src/pages/__tests__/AuthPage.test.tsx`

- [ ] **Step 1: Write failing auth API tests**

Use MSW to cover initial `/me`, register/login/logout, one refresh on `401`, no second refresh loop, and no token in localStorage.

```ts
it('refreshes once and retries the original request', async () => {
  const account = await authApi.getSession()
  expect(account?.email).toBe('user@example.com')
  expect(refreshCalls).toBe(1)
  expect(localStorage.length).toBe(0)
})
```

- [ ] **Step 2: Verify RED**

Run: `cd frontend && corepack pnpm vitest run src/features/auth/__tests__/auth.api.test.ts src/features/auth/__tests__/AuthContext.test.tsx`

- [ ] **Step 3: Implement the Cookie adapter**

All requests use `credentials: 'include'`. Centralize envelope parsing. A shared refresh promise prevents concurrent 401 storms; each original request receives at most one retry.

`authenticatedFetch` is the only refresh-aware request primitive used by auth session reads and Agent history REST calls. It retries only after an API `401`, never retries `/api/auth/login`, `/register`, `/refresh`, or `/logout`, and emits one auth-expired event when refresh fails. WebSocket authentication remains Cookie-based and never puts a token in its URL.

```ts
export interface AuthApi {
  register(input: RegisterInput): Promise<Account>
  login(input: LoginInput): Promise<Account>
  logout(): Promise<void>
  getSession(): Promise<Session | null>
  updateProfile(input: ProfileUpdate): Promise<Account>
}
```

- [ ] **Step 4: Migrate the provider and copy**

`AuthProvider` uses `authApi` by default. Remove local credential/session listeners. Update AuthPage copy to remove “本地演示数据” and explain server-side account use. Existing avatar blob storage may remain device-local, but account identity and credentials may not.

- [ ] **Step 5: Verify and commit**

Run: `cd frontend && corepack pnpm vitest run src/features/auth src/shared/api src/pages/__tests__/AuthPage.test.tsx src/pages/__tests__/ProfilePage.test.tsx`

```bash
git add frontend/src/features/auth frontend/src/shared/api frontend/src/pages/AuthPage.tsx frontend/src/pages/ProfilePage.tsx frontend/src/pages/__tests__
git commit -m "feat(frontend): use secure server auth sessions"
git push origin codex/assistant-history-workspace
```

## Task 9: Add turn-oriented history state and session CRUD

**Files:**
- Create: `frontend/src/features/agent/agent-history.api.ts`
- Create: `frontend/src/features/agent/__tests__/agent-history.api.test.ts`
- Modify: `frontend/src/features/agent/agent.types.ts`
- Modify: `frontend/src/features/agent/agent.schema.ts`
- Modify: `frontend/src/features/agent/agent.reducer.ts`
- Modify: `frontend/src/features/agent/useAgentSession.ts`
- Modify: `frontend/src/features/agent/AgentSessionContext.tsx`
- Modify: `frontend/src/features/agent/__tests__/agent.reducer.test.ts`
- Modify: `frontend/src/features/agent/__tests__/useAgentSession.test.tsx`

- [ ] **Step 1: Write failing history and reducer tests**

Test list/detail parsing, owner-safe API errors, selected session loading, new session, rename/delete, switching without blanking the previous view, and per-turn step ownership.

```ts
expect(state.turns[0]).toMatchObject({
  id: 'turn-1',
  userMessage: { content: '查下所有任务' },
  assistantMessage: { content: '| 状态 | 标题 |' },
  steps: [{ id: 'step-1', status: 'completed' }],
})
```

- [ ] **Step 2: Verify RED**

Run: `cd frontend && corepack pnpm vitest run src/features/agent/__tests__/agent-history.api.test.ts src/features/agent/__tests__/agent.reducer.test.ts src/features/agent/__tests__/useAgentSession.test.tsx`

- [ ] **Step 3: Define durable client types**

Add `AgentSessionSummary`, `AgentTurn`, and `AgentSessionDetail`. Live state exposes:

```ts
interface AgentSessionValue {
  sessions: AgentSessionSummary[]
  selectedSessionId?: string
  turns: AgentTurn[]
  isHistoryLoading: boolean
  historyError?: string
  createSession(): Promise<string>
  selectSession(id: string): Promise<void>
  renameSession(id: string, title: string): Promise<void>
  deleteSession(id: string): Promise<void>
  // existing send/retry/confirm/cancel capabilities remain
}
```

- [ ] **Step 4: Implement session API and state transitions**

Use generation guards so a slow previous selection cannot replace a newer one. Keep rendered turns until the next detail succeeds; show a loading overlay instead of clearing messages. Merge live events only into the active turn.

- [ ] **Step 5: Verify and commit**

Run: `cd frontend && corepack pnpm vitest run src/features/agent`

```bash
git add frontend/src/features/agent
git commit -m "feat(frontend): manage durable agent sessions"
git push origin codex/assistant-history-workspace
```

## Task 10: Render safe GFM Markdown

**Files:**
- Create: `frontend/src/features/agent/AgentMarkdown.tsx`
- Create: `frontend/src/features/agent/__tests__/AgentMarkdown.test.tsx`
- Modify: `frontend/package.json`
- Modify: `frontend/pnpm-lock.yaml`
- Modify: `frontend/src/styles/global.css`

- [ ] **Step 1: Install renderer dependencies and write failing tests**

Run: `cd frontend && corepack pnpm add react-markdown remark-gfm`

Tests assert headings/lists, table semantic elements, code, safe external link attributes, `javascript:` removal, literal/non-executed HTML, and a horizontal table wrapper.

```tsx
render(<AgentMarkdown content={'| 状态 | 标题 |\n|---|---|\n| 完成 | 测试 |'} />)
expect(screen.getByRole('table')).toBeVisible()
expect(screen.getByRole('columnheader', { name: '状态' })).toBeVisible()
expect(screen.getByRole('region', { name: 'Markdown 表格' })).toHaveClass('agent-markdown__table-scroll')
```

- [ ] **Step 2: Verify RED**

Run: `cd frontend && corepack pnpm vitest run src/features/agent/__tests__/AgentMarkdown.test.tsx`

- [ ] **Step 3: Implement the renderer**

Do not enable raw HTML. Override `table` with a scroll region and `a` with protocol filtering plus `target="_blank" rel="noopener noreferrer"` for external HTTP(S) URLs. On renderer error, an error boundary renders the original content as plain text.

- [ ] **Step 4: Add theme-aware Markdown styles**

Style headings, lists, quotes, code, table borders and alternating rows using semantic CSS tokens. Ensure `max-width:100%`, `overflow-wrap:anywhere`, and table scroll without expanding the message column.

- [ ] **Step 5: Verify and commit**

Run: `cd frontend && corepack pnpm vitest run src/features/agent/__tests__/AgentMarkdown.test.tsx src/shared/ui/__tests__/theme-surfaces.test.ts`

```bash
git add frontend/package.json frontend/pnpm-lock.yaml frontend/src/features/agent/AgentMarkdown.tsx frontend/src/features/agent/__tests__/AgentMarkdown.test.tsx frontend/src/styles/global.css
git commit -m "feat(frontend): render safe GFM agent replies"
git push origin codex/assistant-history-workspace
```

## Task 11: Build per-turn disclosures and session navigation

**Files:**
- Create: `frontend/src/features/agent/AgentTurn.tsx`
- Create: `frontend/src/features/agent/AgentSessionList.tsx`
- Create: `frontend/src/features/agent/__tests__/AgentTurn.test.tsx`
- Create: `frontend/src/features/agent/__tests__/AgentSessionList.test.tsx`
- Modify: `frontend/src/features/agent/AgentStepTimeline.tsx`

- [ ] **Step 1: Write disclosure and navigation tests**

Test DOM order `user → assistant → details`, completed default collapsed, running/waiting/failed/interrupted default expanded, one confirmation control instance, summary step count/status/duration, date grouping, current highlight, rename, confirmed delete and load-error retry.

```tsx
const turn = screen.getByTestId('agent-turn-turn-1')
expect(within(turn).getAllByRole('article').map((node) => node.dataset.role)).toEqual(['user', 'assistant'])
expect(within(turn).getByRole('button', { name: /执行详情/ })).toHaveAttribute('aria-expanded', 'false')
```

- [ ] **Step 2: Verify RED**

Run: `cd frontend && corepack pnpm vitest run src/features/agent/__tests__/AgentTurn.test.tsx src/features/agent/__tests__/AgentSessionList.test.tsx`

- [ ] **Step 3: Implement `AgentTurn`**

Use a semantic button + region disclosure, not native `<details>` because running state must be controllable. Render user plain text, assistant through `AgentMarkdown`, then `AgentStepTimeline` inside the owned region. Auto-open only when status transitions to a non-completed attention state; respect a user's manual toggle afterward until status changes again.

- [ ] **Step 4: Implement grouped session navigation**

Group by local calendar boundaries into today, previous six days, and older. Use buttons for selection, a menu for rename/delete, dialogs for rename/delete confirmation, and a dedicated new-session button.

- [ ] **Step 5: Verify and commit**

Run: `cd frontend && corepack pnpm vitest run src/features/agent`

```bash
git add frontend/src/features/agent
git commit -m "feat(frontend): attach collapsible details to each turn"
git push origin codex/assistant-history-workspace
```

## Task 12: Rebuild the Assistant workspace layout

**Files:**
- Modify: `frontend/src/pages/AssistantPage.tsx`
- Modify: `frontend/src/pages/__tests__/AssistantPage.test.tsx`
- Modify: `frontend/src/styles/global.css`
- Modify: `frontend/src/features/agent/useAgentAutoScroll.ts`
- Modify: `frontend/src/features/agent/__tests__/useAgentAutoScroll.test.tsx`

- [ ] **Step 1: Write failing layout tests**

Test that only `.assistant-conversation__scroll` scrolls, composer is outside it and last in the conversation grid, composer uses compact class, session list is interactive, turns render in order, and auto-scroll tracks the end marker above the composer.

Add a CSS contract assertion:

```ts
expect(rule('.assistant-conversation')).toContain('grid-template-rows: auto minmax(0, 1fr) auto')
expect(rule('.assistant-composer')).toContain('align-self: end')
expect(rule('.assistant-composer')).not.toContain('min-height: 100%')
```

- [ ] **Step 2: Verify RED**

Run: `cd frontend && corepack pnpm vitest run src/pages/__tests__/AssistantPage.test.tsx src/features/agent/__tests__/useAgentAutoScroll.test.tsx`

- [ ] **Step 3: Compose the approved A layout**

Replace ad-hoc message mapping and global timeline with `AgentSessionList` and `AgentTurn`. Remove the duplicate right-side interactive timeline; the inspector may show non-interactive aggregate status only.

Structure:

```tsx
<section className="assistant-conversation" id="current">
  <AssistantHeader />
  <div className="assistant-conversation__scroll" role="log">
    {turns.map((turn) => <AgentTurn key={turn.id} turn={turn} />)}
    <div ref={endRef} />
  </div>
  <form className="assistant-composer" onSubmit={submit}>
    <textarea ref={composerRef} aria-label="智能助手消息" value={draft} onChange={onDraftChange} />
    <footer><span>Shift + Enter 换行</span><Button type="submit">发送</Button></footer>
  </form>
</section>
```

- [ ] **Step 4: Fix layout mechanics at the source**

Use `height:100%`, `min-height:0`, and `grid-template-rows:auto minmax(0,1fr) auto`. The composer uses `flex:none`, `align-self:end`, compact padding, and no viewport-derived height. Keep textarea defaults from the approved B behavior: 56px initial, 220px automatic cap, 360px manual cap.

- [ ] **Step 5: Verify and commit**

Run: `cd frontend && corepack pnpm vitest run src/pages/__tests__/AssistantPage.test.tsx src/features/agent`

```bash
git add frontend/src/pages/AssistantPage.tsx frontend/src/pages/__tests__/AssistantPage.test.tsx frontend/src/features/agent frontend/src/styles/global.css
git commit -m "fix(frontend): focus assistant stream above compact composer"
git push origin codex/assistant-history-workspace
```

## Task 13: Update mocks and full end-to-end coverage

**Files:**
- Modify: `frontend/src/mocks/handlers.ts`
- Modify: `frontend/src/mocks/agentFixtures.ts`
- Modify: `frontend/e2e/fixtures/app.fixture.ts`
- Modify: `frontend/e2e/mock/auth.spec.ts`
- Modify: `frontend/e2e/mock/assistant.spec.ts`
- Create: `frontend/e2e/real/assistant-history.spec.ts`
- Modify: `docker-compose.e2e.yml`
- Modify: `data/e2e-init.sql`

- [ ] **Step 1: Add failing mock E2E stories**

Cover safe Markdown table, fixed compact composer at 1280×720 and 390×844, completed details collapse, failed details expand, session CRUD and refresh restore. Assertions use roles and computed boxes, not screenshots alone.

- [ ] **Step 2: Add failing real-stack stories**

Real E2E must:

1. register Alice and Bob through `/register`;
2. create Alice session/turn, reload and verify restore;
3. attempt Alice session URL as Bob and receive no data;
4. rename/delete through UI;
5. restart Agent container between messages and verify completed history remains;
6. query PostgreSQL for owner/session/turn/message/step rows;
7. verify Markdown table and per-turn disclosure in Chromium.

- [ ] **Step 3: Update MSW and fixtures**

Mock Cookie auth behavior, session list/detail endpoints, and turn-oriented WebSocket events with stable `event_id` values. Login fixture must register/login via public UI or API rather than injecting localStorage auth keys.

- [ ] **Step 4: Run E2E suites**

Run:

```bash
cd frontend
corepack pnpm e2e:mock
E2E_REAL=true corepack pnpm playwright test e2e/real/assistant-history.spec.ts --project=real-chromium
```

Expected: all targeted scenarios PASS with no console/page errors.

- [ ] **Step 5: Commit and push**

```bash
git add frontend/src/mocks frontend/e2e docker-compose.e2e.yml data/e2e-init.sql
git commit -m "test: cover authenticated durable assistant history"
git push origin codex/assistant-history-workspace
```

## Task 14: Update documentation and execute the completion audit

**Files:**
- Modify: `docs/API.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `docs/qa/` applicable runbook files

- [ ] **Step 1: Update contracts and operations docs**

Document Cookie auth, refresh behavior, Origin validation, session CRUD, turn response schema, persistence ordering, interruption semantics, result truncation, database migration, local re-registration and required environment variables. Remove claims that history is only in-memory.

- [ ] **Step 2: Run all static and unit/integration gates**

```bash
cd backend && go fmt ./... && go test ./... -race
cd ../agent-service && uv run pytest
cd ../frontend && corepack pnpm lint && corepack pnpm test:coverage -- --run && corepack pnpm build
```

Expected: zero failures; coverage thresholds remain satisfied.

- [ ] **Step 3: Run database migration against the retained local volume**

```bash
docker compose -p todolist-agent exec -T postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" < scripts/migrate.sql
```

Then verify all six tables, foreign keys and indexes from `pg_catalog`.

- [ ] **Step 4: Rebuild affected images and start the full stack**

```bash
docker compose -p todolist-agent build backend agent frontend
docker compose -p todolist-agent up -d --force-recreate --wait
```

Expected: PostgreSQL, Redis, Backend, Agent and Frontend are `running (healthy)`.

- [ ] **Step 5: Run real browser acceptance and restart persistence**

Execute the real Playwright story from Task 13, inspect dark/light screenshots at desktop/mobile sizes, then restart `agent` and rerun history restore. Confirm no browser console errors.

- [ ] **Step 6: Perform requirement-by-requirement audit**

Record evidence for: compact bottom composer; safe GFM/table; details under the corresponding reply and collapsible; trusted server auth; cross-user isolation; session CRUD; durable full steps after restart; full tests; docs; image rebuild; five healthy services.

- [ ] **Step 7: Commit documentation, merge and push default branch**

```bash
git add README.md docs .env.example
git commit -m "docs: document authenticated durable agent history"
git push origin codex/assistant-history-workspace
git checkout master
git pull --ff-only
git merge --ff-only codex/assistant-history-workspace
git push origin master
```

- [ ] **Step 8: Verify remote and runtime state after push**

Run `git rev-list --count origin/master..HEAD` and expect `0`; run `docker compose -p todolist-agent ps --format json` and expect exactly five running healthy services. Only then mark the goal complete.
