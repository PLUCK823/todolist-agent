# Agent TodoList API 接口文档

## 文档信息

| 项目 | 内容 |
| ------ | ------ |
| 版本 | v1.0 |
| 基础路径 | `/api` |
| 协议 | HTTP/1.1 |
| 数据格式 | JSON |
| 字符编码 | UTF-8 |

---

## 目录

- [1. 通用规范](#1-通用规范)
- [2. 待办 CRUD 接口](#2-待办-crud-接口)
- [3. Agent 通信接口](#3-agent-通信接口)
- [4. 错误码](#4-错误码)

---

## 1. 通用规范

### 1.1 请求头

```http
Content-Type: application/json
Accept: application/json
```

### 1.2 成功响应格式

```json
{
  "code": 0,
  "message": "ok",
  "data": { ... }
}
```

### 1.3 错误响应格式

```json
{
  "code": 40001,
  "message": "待办标题不能为空",
  "data": null
}
```

### 1.4 分页响应格式

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "items": [ ... ],
    "total": 42,
    "page": 1,
    "page_size": 20
  }
}
```

---

## 2. 待办 CRUD 接口

### 2.1 获取待办列表

```http
GET /api/todos
```

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
| ------ | ------ | ------ | ------ |
| page | int | 否 | 页码，默认 1 |
| page_size | int | 否 | 每页条数，默认 20，最大 100 |
| completed | bool | 否 | 按完成状态筛选 |
| priority | string | 否 | 按优先级筛选：high / medium / low |
| keyword | string | 否 | 标题关键词模糊搜索 |
| sort_by | string | 否 | 排序字段：created_at / priority / due_date |
| order | string | 否 | 排序方向：asc / desc，默认 desc |
| due_from | RFC3339 | 否 | 截止时间下界（含）；必须携带 `Z` 或 UTC 偏移，设置后排除 `due_date=null` |
| due_to | RFC3339 | 否 | 截止时间上界（不含）；必须携带 `Z` 或 UTC 偏移，设置后排除 `due_date=null` |

`due_from` 与 `due_to` 同时存在时必须满足 `due_from < due_to`，否则返回统一的 `40001` 查询参数错误。按 `due_date` 排序时使用任务 ID 作为次级排序键，以保证跨页顺序稳定。

**响应示例：**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "items": [
      {
        "id": 1,
        "title": "买牛奶",
        "description": "全脂牛奶 1L",
        "priority": "high",
        "completed": false,
        "due_date": "2026-07-15T00:00:00Z",
        "created_at": "2026-07-13T10:30:00Z",
        "updated_at": "2026-07-13T10:30:00Z"
      }
    ],
    "total": 1,
    "page": 1,
    "page_size": 20
  }
}
```

### 2.2 获取单个待办

```http
GET /api/todos/:id
```

**路径参数：**

| 参数 | 类型 | 说明 |
| ------ | ------ | ------ |
| id | int | 待办 ID |

**响应示例：**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": 1,
    "title": "买牛奶",
    "description": "全脂牛奶 1L",
    "priority": "high",
    "completed": false,
    "due_date": "2026-07-15T00:00:00Z",
    "created_at": "2026-07-13T10:30:00Z",
    "updated_at": "2026-07-13T10:30:00Z"
  }
}
```

### 2.3 创建待办

```http
POST /api/todos
```

**请求体：**

```json
{
  "title": "买牛奶",
  "description": "全脂牛奶 1L",
  "priority": "high",
  "due_date": "2026-07-15T00:00:00Z"
}
```

| 字段 | 类型 | 必填 | 说明 |
| ------ | ------ | ------ | ------ |
| title | string | **是** | 待办标题，1-200 字符 |
| description | string | 否 | 详细描述 |
| priority | string | 否 | 优先级：high / medium / low，默认 medium |
| due_date | string | 否 | 截止日期，RFC 3339 格式 |

**响应：** `201 Created`，返回创建的待办对象。

### 2.4 更新待办

```http
PUT /api/todos/:id
```

**请求体：** 同创建，所有字段可选（只传需要修改的字段）。

**响应：** `200 OK`，返回更新后的完整待办对象。

### 2.5 删除待办

```http
DELETE /api/todos/:id
```

**响应：** `204 No Content`

### 2.6 标记完成

```http
PATCH /api/todos/:id/complete
```

**响应：** `200 OK`，返回标记后的待办对象（`completed: true`）。

### 2.7 取消完成

```http
PATCH /api/todos/:id/uncomplete
```

**响应：** `200 OK`，返回取消后的待办对象（`completed: false`）。

---

## 3. Agent 通信接口

### 3.1 发送聊天消息

```http
POST /api/agent/chat
```

**请求体：**

```json
{
  "message": "帮我创建一个高优先级的待办：买牛奶",
  "session_id": "uuid-optional"
}
```

| 字段 | 类型 | 必填 | 说明 |
| ------ | ------ | ------ | ------ |
| message | string | **是** | 用户输入的自然语言消息 |
| session_id | string | 否 | 会话 ID，不传则自动创建新会话 |

**响应：**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "reply": "好的，已为你创建高优先级待办「买牛奶」",
    "session_id": "abc-123-def",
    "actions": [
      {
        "type": "create_todo",
        "result": {
          "id": 1,
          "title": "买牛奶",
          "priority": "high"
        }
      }
    ]
  }
}
```

### 3.2 WebSocket 流式通信

```http
WS /api/agent/stream
```

连接后，客户端先发送一条消息请求。推荐使用 JSON；为兼容旧客户端，也接受纯文本（等价于仅提供 `message`）：

```json
{ "message": "删除待办 7", "session_id": "abc-123-def" }
```

`message` 必须为非空字符串；`session_id` 可省略，此时服务端在执行前生成并固定会话 ID。JSON 中的未知字段会被拒绝。

服务端从 Agent 的实际执行点逐条转发事件，而不是在工具执行结束后补造进度。真实顺序如下：

1. 调用 LLM 前发送 `step_started(understand)`；
2. LLM 返回 tool call 后发送 `step_completed(understand)`；
3. 每个工具真正执行前发送 `step_started(tool)`；
4. 工具 await 返回后立即发送 `action_completed`，失败或超时则发送 `step_failed`；
5. Agent 生成最终文本后发送 `reply`，最后发送 `done`。

事件示例：

```json
// 步骤开始：理解请求
{ "type": "step_started", "step_id": "understand", "label": "理解请求", "started_at": "2026-07-13T10:30:00Z" }

// 步骤完成
{ "type": "step_completed", "step_id": "understand", "duration_ms": 742 }

// 工具调用开始
{ "type": "step_started", "step_id": "create_todo", "label": "调用 Todo API", "tool": "create_todo", "args": { "title": "买牛奶", "priority": "high" } }

// 危险操作在调用前请求确认
{ "type": "confirmation_required", "step_id": "delete_todo", "message": "确认删除待办「买牛奶」？", "confirmation_id": "confirm-123" }

// 工具执行结果
{ "type": "action_completed", "step_id": "create_todo", "action": "create_todo", "result": { "id": 1, "title": "买牛奶" }, "duration_ms": 1380 }

// 步骤失败；当前协议没有后端幂等键，因此不能承诺自动重试安全
{ "type": "step_failed", "step_id": "create_todo", "error_code": "TOOL_TIMEOUT", "message": "Todo API 响应超时", "retryable": false, "duration_ms": 5000 }

// 回复文本（可能分多次推送实现流式效果）
{ "type": "reply", "content": "好的，已为你创建" }
{ "type": "reply", "content": "高优先级待办「买牛奶」" }

// 消息结束
{ "type": "done" }
```

收到 `confirmation_required` 后，客户端必须在同一 WebSocket 连接中发送：

```json
{
  "type": "confirmation_response",
  "confirmation_id": "confirm-123",
  "approved": true
}
```

`approved` 必须是 JSON 布尔值，不能使用字符串或数字代替。确认 ID 与服务端保存的 `session_id`、工具名和完整参数绑定，并且只能消费一次；跨会话、重复或已过期的确认不会执行工具。`approved=false` 会把“用户取消”结果交回 Agent，删除接口不会被调用。确认超时会发送 `step_failed`，其 `error_code` 为 `CONFIRMATION_TIMEOUT`。

同一个 WebSocket 消息处理过程中可以顺序出现多次 `confirmation_required`；客户端应逐次使用各自的 ID 回复，因此一个会话可以安全完成多轮确认。客户端断开连接时，服务端会取消仍在运行的 Agent/后端请求并清理未决确认，不会继续尝试向已断开的连接写事件。

前端应根据步骤事件展示等待、运行、完成和失败状态。后端接口超时对应 `step_failed(error_code="TOOL_TIMEOUT", retryable=false)`。前端可以提供由用户确认的“重新发送整轮”入口，但不得把单个工具步骤当作可安全自动重试；Todo API 当前没有接收 action/turn 幂等键，提交成功但响应丢失时仍可能重复产生副作用。

Agent 会在每个工具完成后先记录该 turn 的 action journal，并在每次 WebSocket 事件写入前保存稳定的事件内容与 ID。如果写入失败，客户端可以用相同 `session_id` 和完全相同的 `message` 重连；同一 Python worker、且该内存记录仍在 TTL/LRU 保留期内时，服务端会重放未确认事件并复用已记录的 tool-call ID，避免再次执行已经写入 journal 的工具。此时模型阶段失败使用 `step_id="respond"`，不会误报为理解阶段失败。未完成 turn 存在时，不同内容的新消息会被拒绝。

上述 action journal、turn ID、事件 checkpoint 和会话锁都只是**单进程内存状态**，不是数据库级 durable log，也不是 exactly-once 交付协议。进程重启、多 worker 路由到不同进程、缓存淘汰都会丢失恢复上下文；即使服务端成功调用 `send_json`，也不能证明客户端已经收到事件。最终 `reply` 发送后，服务端会用内部 `turn_id + generation` 提交该轮；如果提交与删除历史发生竞态，会返回流错误而不是错误提交另一轮。客户端仍应把未收到 `done` 视为结果不确定，并允许用户查看 Todo 实际状态后决定是否重试。

服务端为每个 session 串行执行 turn，不同 session 仍可并行。会话采用 TTL/LRU 有界缓存，并限制每个会话保留的消息数、单 turn 的工具轮数和工具调用总数；超限返回 `step_failed(error_code="AGENT_LIMIT_EXCEEDED", retryable=false)`。删除历史会建立 tombstone 并取消同 session 的在途处理，晚到结果不能重新创建已删除的历史或确认状态。

### 3.3 获取对话历史

```http
GET /api/agent/history?session_id=abc-123-def
```

### 3.4 清空对话历史

```http
DELETE /api/agent/history?session_id=abc-123-def
```

---

## 4. 错误码

| 错误码 | HTTP 状态码 | 说明 |
| ------ | ------ | ------ |
| 0 | 200/201 | 成功 |
| 40001 | 400 | 参数校验失败 |
| 40002 | 400 | 请求体 JSON 格式错误 |
| 40101 | 401 | 未认证 |
| 40301 | 403 | 无权限 |
| 40401 | 404 | 待办不存在 |
| 40402 | 404 | 会话不存在 |
| 42901 | 429 | 请求频率超限 |
| 50001 | 500 | 服务器内部错误 |
| 50002 | 500 | 数据库错误 |
| 50003 | 502 | Agent 服务不可用 |
| 50004 | 502 | LLM API 调用失败 |
