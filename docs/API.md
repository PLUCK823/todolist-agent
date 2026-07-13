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

**连接后，发送文本消息即可。服务端逐条推送 JSON 事件：**

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

// 步骤失败，可由前端展示原因和重试入口
{ "type": "step_failed", "step_id": "create_todo", "error_code": "TOOL_TIMEOUT", "message": "Todo API 响应超时", "retryable": true, "duration_ms": 5000 }

// 回复文本（可能分多次推送实现流式效果）
{ "type": "reply", "content": "好的，已为你创建" }
{ "type": "reply", "content": "高优先级待办「买牛奶」" }

// 消息结束
{ "type": "done" }
```

前端应根据步骤事件展示等待、运行、完成和失败状态。上述事件是 UI 原型所需的目标契约；Agent 服务实现前仍可使用 Mock 事件，但字段名称和状态语义应保持一致。

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
