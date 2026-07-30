# Agent TodoList 架构

> 更新：2026-07-30。本文描述当前可运行实现，而不是未来微服务设想。

## 运行拓扑

```text
Browser
  │ HTTPS / HttpOnly Cookie
  ▼
Nginx / Frontend
  ├── /api/auth, /api/v1/todos ──► Go Backend ──► PostgreSQL
  ├── /api/agent/*              ──► Python Agent ──► PostgreSQL
  └── /api/agent/stream (WS)    ──► Python Agent ──► Go Todo API
                                              └──► LLM provider adapter

Redis：缓存/基础设施服务；不作为认证或 Agent 历史的事实来源。
```

Compose 项目包含五个服务：`frontend`、`backend`、`agent`、`postgres`、`redis`。Nginx 是浏览器的同源入口，应用密钥只在运行时通过环境变量注入，不写入镜像。

## 信任边界

### Go 认证

Go Backend 管理 `users` 与 `auth_sessions`：

- 密码用 Argon2id 散列；refresh secret 只以 SHA-256 散列持久化。
- access JWT 固定 HS256，包含用户和 auth-session ID；`AUTH_JWT_SECRET` 少于 32 字节时拒绝启动。
- 登录写入 access/refresh 两枚 `HttpOnly`、`SameSite=Lax` Cookie。
- refresh 在数据库事务中撤销旧 session 并创建新 session；logout 撤销 refresh session 并清 Cookie。
- Cookie 状态变更必须通过精确 `Origin` allowlist；生产环境要求 HTTPS 和 Secure Cookie。
- Agent 使用同一 JWT secret，并回查 `auth_sessions`，所以轮换或退出后旧 access Cookie 不能继续访问 Agent。

浏览器不把 JWT、refresh secret 或密码放入 localStorage。前端偏好仍可本地保存，但不参与身份判断。

### 用户隔离

`agent_sessions.owner_id` 引用 `users.id`。会话列表、详情、重命名、删除和 WebSocket 建连都用服务端 principal 过滤；客户端不能指定 owner。跨用户访问统一表现为不存在。删除用户或会话通过外键级联清理对应历史。

## 持久化模型

```text
users
 ├── auth_sessions
 └── agent_sessions
      └── agent_turns          unique(session_id, ordinal)
           ├── agent_messages unique(turn_id, ordinal)
           └── agent_steps    unique event_id; ordered ordinal
```

PostgreSQL 是账号、会话和 Agent 历史的事实来源。每轮保存：

- 用户消息与最终助手回复；
- turn 状态、失败原因、`result_uncertain` 和起止时间；
- 每个工具/执行步骤的稳定 `event_id`、状态、参数、结果/预览、确认与错误元数据；
- 大结果的截断标记，避免无界 JSON 写入。

内存 coordinator 管理单进程运行 lease、会话锁、连接附着、确认/重试 token 和 action journal。它避免同一会话并发写入并支持当前 worker 内有限恢复，但不取代 PostgreSQL，也不承诺跨进程 exactly-once。Agent 重启会将数据库中的开放 turn 标记 `interrupted`，随后从已完成消息历史为新 turn 恢复上下文。

## Agent turn 生命周期

```text
鉴权与 owner 校验
  → 获取 session runtime lease
  → 写入 turn + user message
  → 持久化每个 step/event
  → 产生 reply
  → 事务写入 assistant message 并 complete turn
  → 发送 done
```

`done` 永远晚于数据库 complete。关键异常语义：

- transport 在提交前丢失：turn 保持开放，恢复过程可继续或启动时标记 `interrupted`；
- reply 已生成但 complete 失败：不发送 `done`；
- 写工具已生效而持久化失败：`result_uncertain=true`，禁止客户端自动重放；
- `done` 发送失败但 complete 已成功：数据库历史仍为完成，客户端重新加载即可确认；
- step 结果超过 `AGENT_RESULT_MAX_BYTES`：保存有限预览并标记 `result_truncated=true`。

## 前端架构

- `AuthContext` 以 `/api/auth/me` 为身份事实来源，所有请求带 Cookie。
- `authenticatedFetch` 合并并发 refresh，最多重试一次，不对认证端点递归刷新。
- Agent history API 管理多会话摘要与详情；状态按 turn 建模，而不是单个全局聊天数组。
- `AgentMarkdown` 使用 `react-markdown`、GFM 和安全 URL/HTML 策略渲染表格等内容。
- 每个 `AgentTurn` 按“用户消息 → 助手回复 → 该轮执行详情”排列；完成轮默认折叠，运行/失败/中断轮可展开。
- 助手页只有消息区滚动，紧凑 composer 固定在工作区底部；快捷询问和侧栏复用相同会话状态。

## 测试边界

- 579 项前端单元/组件测试覆盖认证、session reducer、GFM、批量任务、布局和交互。
- 当前发现 254 项 Mock E2E 在 Chromium、Firefox、WebKit 上运行；Playwright context transport 接管 HTTP/WebSocket，避免 Service Worker 首文档竞态和跨 context 状态泄漏。
- 4 项真实 Chromium E2E 经过 Nginx、Go、Python Agent 和 PostgreSQL，验证注册、owner 隔离、数据库行、重启恢复、重命名/删除、Markdown 表格与执行详情。
- 真实 E2E 使用仅在 `APP_ENV=e2e` 且显式启用时可用的确定性 fake LLM；它验证系统链路，不代表模型质量。

## 升级和部署

`data/init.sql` 用于新数据库，`scripts/migrate.sql` 用于保留卷升级。迁移脚本是幂等的：先建立账号/Agent 表、约束和索引，再清理废弃结构。执行迁移前仍应备份生产数据库，并使用 `psql -v ON_ERROR_STOP=1`。

生产部署必须：

1. 设置独立的 32+ 字节 `AUTH_JWT_SECRET` 和精确 `AUTH_ALLOWED_ORIGINS`；
2. 通过 HTTPS 暴露前端并设置 `AUTH_COOKIE_SECURE=true`；
3. 将真实模型 Key 仅放入受控 secret/env，不写入仓库、镜像或日志；
4. 迁移保留卷，重建三个应用镜像，再以健康检查启动全部五服务；
5. 运行真实浏览器 E2E 和 Agent 重启恢复验收。

旧版本的浏览器本地账号不能迁移为服务端账号，用户需要重新注册。

## 相关文档

- [API](API.md)
- [数据库](DATABASE.md)
- [部署](DEPLOY.md)
- [项目状态](STATUS.md)
- [发布检查清单](qa/release-checklist.md)
