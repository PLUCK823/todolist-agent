# Agent TodoList API

> 更新：2026-07-30。浏览器入口统一经过 Nginx；JSON 成功响应通常为 `{ "code": 0, "message": "ok", "data": ... }`，错误响应为 `{ "code": <业务码>, "message": <说明>, "data": null }`。

## 认证

Go Backend 提供服务端认证。访问和刷新凭据分别写入配置名对应的 `HttpOnly` Cookie，默认 `todolist_access`、`todolist_refresh`；`SameSite=Lax`，生产环境必须启用 `Secure`。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` | 注册账号，成功 `201`；不会自动登录 |
| POST | `/api/auth/login` | 登录并写入 access/refresh Cookie |
| POST | `/api/auth/refresh` | 原子撤销旧 refresh session，轮换两枚 Cookie |
| POST | `/api/auth/logout` | 撤销 refresh session 并清除两枚 Cookie，成功 `204` |
| GET | `/api/auth/me` | 返回当前公开账号资料 |
| PATCH | `/api/auth/me` | 更新名称、邮箱或时区 |

注册和登录请求：

```json
{"name":"Alice","email":"alice@example.com","password":"password8"}
```

登录只需 `email` 和 `password`。`/me` 返回公开 Account，不包含密码散列、Cookie、JWT 或 refresh session。浏览器请求使用 `credentials: include`；前端只在普通 API 返回 `401` 时尝试一次共享 refresh，并只重试原请求一次。

所有 Cookie 认证的状态变更请求必须携带与 `AUTH_ALLOWED_ORIGINS` 精确匹配的 `Origin`。空 Origin、通配符、协议/主机/端口不匹配均拒绝。JWT 固定 HS256，包含用户 `sub` 和服务端 auth-session ID；refresh/logout 后旧 access session 也不再有效。

常见认证错误：`40001` 参数错误、`40101` 缺少/失效访问身份、`40102` 登录或刷新凭据无效、`40301` Origin/资源权限拒绝、`40901` 邮箱已存在、`42901` 登录限流。

## Todo API

Todo API 使用 `/api/todos` 合约：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/todos` | 列表、搜索、筛选、排序和分页 |
| POST | `/api/todos` | 创建 |
| GET | `/api/todos/{id}` | 详情 |
| PUT | `/api/todos/{id}` | 更新 |
| DELETE | `/api/todos/{id}` | 删除 |
| PATCH | `/api/todos/{id}/complete` | 完成 |
| PATCH | `/api/todos/{id}/uncomplete` | 恢复 |
| POST | `/api/todos/batch` | 原子批量创建 |
| POST | `/api/todos/batch/get` | 按请求顺序批量读取 |
| PUT | `/api/todos/batch` | 每项独立补丁的原子批量更新 |
| PATCH | `/api/todos/batch/status` | 原子批量完成或恢复 |
| DELETE | `/api/todos/batch` | 原子批量删除并返回删除前快照 |

列表查询支持 `page`、`page_size`、`search`、`completed`、`priority`、`sort_by`、`sort_order`。Todo 数据模型包括 `id`、`title`、`description`、`priority`、`completed`、`due_date`、`created_at`、`updated_at`。

批量请求必须包含 1–100 项；ID 必须是互不重复的正整数。写操作在一个数据库事务内完成，任一项目无效或不存在时整批回滚。成功统一返回 `{ "items": [...], "count": N }`，顺序与请求一致。更新体形如 `{ "items": [{ "id": 7, "title": "新标题" }, { "id": 9, "priority": "high" }] }`；状态体为 `{ "ids": [7,9], "completed": true }`。单项校验失败使用业务码 `40002`，`data` 含 `index`、`id` 和 `field`；缺失目标使用 `40401`。

## Agent 会话 REST API

所有接口均要求有效 access Cookie。`owner_id` 不接受客户端输入，而是从已验证身份推导；其他用户访问会返回 `404`，避免泄露资源是否存在。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/agent/sessions` | 当前用户会话列表，按最近活动排序 |
| POST | `/api/agent/sessions` | 创建会话；可传 `title`、`first_message` |
| GET | `/api/agent/sessions/{session_id}` | 会话、turn、message、step 完整详情 |
| PATCH | `/api/agent/sessions/{session_id}` | 重命名，正文 `{ "title": "..." }` |
| DELETE | `/api/agent/sessions/{session_id}` | 级联删除会话历史 |
| POST | `/api/agent/chat` | 非流式消息；可传 `session_id` |
| GET | `/api/agent/history?session_id=...` | 兼容读取该会话消息 |
| DELETE | `/api/agent/history?session_id=...` | 兼容删除该会话 |

会话摘要：

```json
{
  "id": "uuid",
  "title": "本周计划",
  "created_at": "2026-07-30T09:00:00Z",
  "updated_at": "2026-07-30T09:01:00Z",
  "last_message_at": "2026-07-30T09:01:00Z"
}
```

详情的 `turns` 按 `ordinal` 排序。每个 turn 包含 `status`、起止时间、失败信息和 `result_uncertain`，以及有序的 `messages` 与 `steps`。step 包含稳定唯一的 `event_id`、`tool`、`status`、参数、结果/预览、`result_truncated`、耗时、错误和确认字段。

## Agent WebSocket

```text
GET /api/agent/stream?session_id=<uuid>
```

握手使用 access Cookie 和精确 Origin 校验；URL 不携带 JWT。缺少/无效身份关闭码 `4401`，Origin 或会话归属错误关闭码 `4403`。握手固定一个归属已验证的 `session_id`，消息体不能切换到其他会话。

普通请求：

```json
{"message":"列出今天的任务"}
```

服务端事件包含理解、工具运行/等待/完成/失败、确认、`reply` 和 `done`；每个可持久化步骤使用稳定 `event_id`。成功终态顺序是：

```text
reply → PostgreSQL complete_turn → done → close
```

因此收到 `done` 时 turn 已提交。如果写操作已经发生但后续持久化失败，turn 标记 `result_uncertain=true`，客户端不得自动重放写操作。Agent 启动恢复会把遗留开放 turn 标记为 `interrupted`。超大工具结果按 `AGENT_RESULT_MAX_BYTES` 截断，只保存预览并设置 `result_truncated=true`。

内存中的 coordinator、会话锁、确认/重试 token 和 action journal 只负责当前进程的并发协调与有限恢复，不是历史事实来源。PostgreSQL 中的 session/turn/message/step 才是跨重启历史；进程重启后旧的内存确认或重试能力不会被伪造恢复。

## 健康检查

| 路径 | 负责服务 | 成功 |
|---|---|---|
| `/health` 或 Compose 配置的 Backend health | Go Backend | HTTP 200 |
| `/api/agent/health` | Python Agent + PostgreSQL recovery ownership | `{"status":"ok",...}` |

Agent health 只有在数据库可用且恢复协调已经就绪时才返回成功。
