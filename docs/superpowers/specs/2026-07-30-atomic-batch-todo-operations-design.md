# Atomic Batch Todo Operations Design

**Date:** 2026-07-30

**Status:** Approved

## Objective

Add atomic batch create, read, update, status-change, and delete operations to the Todo platform so the Agent and traditional task UI can operate on multiple todos with one API request. Preserve all existing single-item endpoints and keep every batch at 1–100 items.

## Decisions

- Every batch write is all-or-nothing in one PostgreSQL transaction.
- Any invalid item, missing todo, duplicate ID, authorization failure, or database failure rejects or rolls back the entire batch.
- Batch update accepts different changes for each todo.
- The traditional task page gains multi-select and batch actions.
- Batch delete uses one confirmation for the entire batch.
- Existing single-item APIs and Agent tools remain backward compatible.

## REST API

The Go Backend adds the following authenticated endpoints alongside the current `/api/todos` endpoints:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/todos/batch` | Create multiple todos |
| `POST` | `/api/todos/batch/get` | Get multiple todos by ID |
| `PUT` | `/api/todos/batch` | Apply independent partial updates |
| `PATCH` | `/api/todos/batch/status` | Set one completed status on multiple todos |
| `DELETE` | `/api/todos/batch` | Delete multiple todos |

Every request contains 1–100 items or IDs. Duplicate IDs are rejected. Batch get and every write response preserve request order.

### Request shapes

```json
{
  "items": [
    {"title": "Buy milk", "priority": "high"},
    {"title": "Write report", "due_date": "2026-08-01T09:00:00Z"}
  ]
}
```

```json
{"ids": [17, 18, 19]}
```

```json
{
  "items": [
    {"id": 17, "priority": "high"},
    {"id": 18, "due_date": null},
    {"id": 19, "title": "Updated title"}
  ]
}
```

```json
{"ids": [17, 18, 19], "completed": true}
```

### Success response

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "items": [],
    "count": 3
  }
}
```

Create, get, update, and status responses return the resulting todos in `items`. Delete returns snapshots of the deleted todos so clients and Agent replies can identify exactly what changed.

### Error response

Batch validation errors use code `40002` and include the zero-based item index, todo ID when available, and field when applicable:

```json
{
  "code": 40002,
  "message": "第 3 项优先级无效",
  "data": {"index": 2, "id": 17, "field": "priority"}
}
```

Missing targets return `40401`. Authentication and ownership remain enforced by the existing owner-scoped request context. Database failures return the existing internal error response after transaction rollback.

## Backend transaction design

The service validates request cardinality and duplicates before opening a write transaction. Repository batch methods execute through a transaction-scoped repository:

- Create validates every new `Todo` before insertion.
- Get loads the complete ID set and reconstructs request order.
- Update locks target rows in ascending ID order with `FOR UPDATE`, applies each independent patch to a copy, validates all resulting objects, then saves them.
- Status locks all targets in ascending ID order and updates `completed` in one transaction.
- Delete locks and snapshots all targets in ascending ID order, then deletes the complete ID set.

Sorting lock acquisition independently from response ordering prevents avoidable deadlocks while preserving the public contract. A missing row is detected before mutation. No handler loops through existing single-item service calls because that would lose the transaction boundary.

## Agent tools and execution

The Agent Service adds:

- `batch_create_todos(items)`
- `batch_get_todos(todo_ids)`
- `batch_update_todos(items)`
- `batch_set_todo_status(todo_ids, completed)`
- `batch_delete_todos(todo_ids)`

The system prompt instructs the model to use a batch tool for two or more targets and a single-item tool for one target. Each batch tool performs one HTTP request and appears as one execution step. Result previews show a count and a bounded item summary; full durable results keep the existing truncation protections.

`batch_delete_todos` is destructive and therefore follows the existing confirmation protocol. Its confirmation message contains the count plus a bounded title/ID preview. The frontend submits one confirmation response, after which the Agent makes one batch delete request. Rejecting the confirmation cancels the entire batch.

Batch creates, updates, and status changes retain current confirmation behavior: they execute without an extra confirmation. If transport fails after a batch write is dispatched, the existing `result_uncertain` path applies and the Agent does not automatically replay the write.

## Traditional task UI

Desktop task cards display selection checkboxes. Mobile exposes checkboxes only after the user enters selection mode. Selection behavior is:

- “Select current page” adds visible todos.
- Selection persists across pagination up to 100 todos.
- Search, filter, or sort changes clear selection.
- A fixed batch action bar shows the selected count and actions for complete, restore, edit, delete, and cancel selection.

Batch edit requires users to opt into each shared field before changing it. Supported shared fields are priority, due date, and completed state. Title and description are excluded from shared edits to prevent accidental overwrites; independent title and description changes remain available through Agent batch update or single-item editing.

Batch delete shows one confirmation dialog. It lists up to eight titles followed by a remaining count. While a request is pending the action bar is locked. Success clears selection, refreshes lists and summary counts, and shows one result toast. Failure preserves selection and states that no changes were applied.

## Concurrency and safety

- IDs must be positive and unique.
- Batch arrays must contain 1–100 entries.
- Updates cannot contain an ID with no changed fields.
- All existing Todo validation rules apply to every resulting object.
- Rows are locked in ascending ID order for batch update, status, and delete.
- The operation never silently splits a request because splitting would violate atomicity.
- Write requests are never automatically retried after an uncertain result.

## Testing

### Go Backend

- Repository and service tests cover atomic success, rollback on every failure class, lock ordering, response ordering, duplicate IDs, empty requests, 100-item success, and 101-item rejection.
- Handler tests cover request/response contracts, validation details, missing IDs, authentication, CSRF origin checks, and cross-user isolation.

### Agent Service

- Tool tests prove each batch tool makes one HTTP request and maps envelopes and errors correctly.
- Agent tests prove two-or-more operations use batch tools, batch delete emits one confirmation, rejection performs no write, approval performs one write, and uncertain writes are not replayed.
- Durable history tests cover batch result persistence and bounded previews.

### Frontend

- API tests cover all five client calls and structured batch errors.
- Component tests cover current-page selection, cross-page persistence, 100-item limit, selection clearing on query changes, batch edit field opt-in, one delete confirmation, pending locks, success invalidation, and failure preservation.
- Mock transport fixtures use the same batch Agent events as the real service.

### End-to-end

One authenticated real-stack scenario performs batch create, batch get, independent batch update, complete, restore, and a single-confirmation batch delete. It verifies one request per operation, execution-detail rendering, final Todo state, and the absence of browser console errors.

## Documentation and rollout

Update `docs/API.md`, `docs/AGENT_PROMPT.md`, `docs/PRD.md`, `docs/STATUS.md`, and relevant README examples. Run backend, Agent, frontend, mock E2E, and real E2E verification. Commit and push the implementation, rebuild affected Docker images, recreate the stack, and verify all five services are healthy before completion.
