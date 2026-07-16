# 智能助手工作区与持久化会话设计

**日期：** 2026-07-16  
**状态：** 已确认，待实施  
**视觉方案：** A · 聚焦消息流

## 1. 背景与目标

当前智能助手页存在四个直接问题：

1. 输入表单被页面布局拉高，外框明显超出输入框和发送栏，也不能稳定停在视口底部。
2. Agent 回复以纯文本输出，GFM Markdown（尤其表格）无法正确预览。
3. 执行详情是会话级全局区块，不能表达它属于哪一轮回复，也不能折叠。
4. Agent 历史只保存在 Python 进程内存中。数据库虽有未接入的 `conversations` 表，但页面刷新、服务重启和多副本部署均不能可靠恢复历史，也没有可信的用户隔离。

本次改造必须同时完成助手页信息架构、服务端身份认证、按用户隔离的多会话，以及消息、turn、步骤和工具结果的持久化。它不是浏览器本地缓存方案。

## 2. 已确认的产品范围

### 2.1 多会话

- 每位用户可以新建、切换、重命名和删除多个会话。
- 会话历史一直保留，直到用户主动删除。
- 会话标题默认取第一条用户消息，经长度规范化后生成；用户可以修改。
- 左侧按“今天 / 最近 7 天 / 更早”分组显示历史会话。
- 清空当前会话等价于删除该会话：存在其他会话时切到最近一条，否则进入新的空白会话。

### 2.2 完整执行历史

重新打开历史会话时恢复：

- 用户消息与 AI 回复；
- 每轮执行步骤、状态、顺序与耗时；
- 工具名称、参数、结果和错误；
- 等待确认、失败、中断与完成状态。

工具结果必须设置大小上限。超限值保存摘要、截断后的可预览内容及 `truncated=true`，不能无限增长。

## 3. 身份与安全架构

### 3.1 服务端账号

Go Backend 负责注册、登录、刷新、退出和当前用户接口。密码使用适合密码存储的强哈希算法及独立 salt；数据库只保存哈希，不保存或记录明文密码。

认证使用短期访问 JWT 和可撤销的刷新会话：

- 通过同源、`HttpOnly`、`SameSite=Lax` Cookie 传输；
- 生产 HTTPS 环境启用 `Secure`；
- 前端不得把访问 token 或刷新 token 写入 `localStorage`；
- 刷新 token 只保存哈希及会话元数据；
- 退出、改密或主动撤销后刷新会话立即失效。

现有浏览器本地账号无法安全迁移密码，因此升级后需要重新注册或登录一次。

### 3.2 跨服务验证

Backend 与 Agent 使用同一 JWT 签名/验证配置。Agent 从认证 Cookie 中读取 `sub` 作为可信 `user_id`，不得接受请求体、查询参数或自定义用户 ID 头作为身份来源。

所有会话、消息和步骤查询必须同时带 `owner_id`。即便知道他人的 session UUID，也不能读取、修改或删除其内容。

WebSocket 握手同时验证：

- 认证 Cookie；
- `Origin` 是否属于配置的同源允许列表；
- session 是否属于当前用户。

## 4. 数据模型

### 4.1 `users`

- `id UUID PRIMARY KEY`
- `email CITEXT UNIQUE NOT NULL`
- `display_name`
- `password_hash`
- `created_at`、`updated_at`

### 4.2 `auth_sessions`

- `id UUID PRIMARY KEY`
- `user_id` 外键
- `refresh_token_hash`
- `expires_at`、`revoked_at`
- `created_at`、`last_used_at`
- 可选设备与来源元数据

### 4.3 `agent_sessions`

- `id UUID PRIMARY KEY`
- `owner_id` 外键
- `title`
- `created_at`、`updated_at`
- `last_message_at`

对 `(owner_id, last_message_at DESC)` 建索引。

### 4.4 `agent_turns`

- `id UUID PRIMARY KEY`
- `session_id` 外键并级联删除
- `ordinal`，会话内唯一且递增
- `status`：`running / waiting_confirmation / completed / failed / interrupted`
- `started_at`、`completed_at`
- `failure_code`、`failure_message`
- `result_uncertain BOOLEAN`

### 4.5 `agent_messages`

- `id UUID PRIMARY KEY`
- `session_id`、`turn_id` 外键
- `role`：`user / assistant / system / tool`
- `content`
- `ordinal`，会话内唯一且递增
- `created_at`

### 4.6 `agent_steps`

- `id UUID PRIMARY KEY`
- `turn_id` 外键并级联删除
- `event_id UUID UNIQUE NOT NULL`，用于幂等写入
- `ordinal`
- `label`、`tool`、`status`
- `args JSONB`、`result JSONB`
- `result_preview TEXT`、`result_truncated BOOLEAN`
- `duration_ms`、错误与确认字段
- `started_at`、`completed_at`

旧 `conversations` 表没有 owner、turn 和 durable step 语义。迁移在新表创建和验证成功后移除旧表；当前内存历史不做伪迁移。

## 5. 数据流与一致性

### 5.1 会话请求

1. 前端通过认证 Cookie 请求会话列表或指定会话。
2. 发送消息时，Agent 验证当前用户及 session 所有权。
3. 若未提供 session，Agent 创建属于当前用户的新 session。
4. 在开始模型调用前，通过事务写入 `agent_turns(running)` 和用户消息。
5. 每个稳定 Agent 事件携带 `event_id`，步骤通过唯一键幂等 upsert。
6. 最终 AI 回复写入 `agent_messages`，turn 标为 `completed`，事务提交成功后才发送 `done`。

### 5.2 故障与恢复

- Agent 启动时将数据库中遗留的 `running` / `waiting_confirmation` turn 标记为 `interrupted`。
- 持久化失败时不得发送成功 `done`。
- 若 Todo 写操作可能已经执行而历史提交失败，turn 设置 `result_uncertain=true`，页面明确提示“操作可能已生效，请检查任务状态”，禁止自动重放写操作。
- 同一 session 的 turn 使用会话级锁串行；不同 session 可并行。
- 删除会话先建立删除屏障并取消在途任务，再级联删除持久化数据，晚到事件不得复活会话。

## 6. API 合约

### 6.1 Auth（Go Backend）

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`

状态修改接口依赖同源 Cookie 与 Origin/CSRF 防护。401 时前端最多自动刷新一次，失败则回到登录页并保留原目标路径。

### 6.2 Agent sessions（Agent Service）

- `GET /api/agent/sessions`
- `POST /api/agent/sessions`
- `GET /api/agent/sessions/{session_id}`
- `PATCH /api/agent/sessions/{session_id}`
- `DELETE /api/agent/sessions/{session_id}`
- `WS /api/agent/stream`

会话详情返回按 turn 聚合的消息与 steps；列表接口只返回摘要，不携带完整工具结果。

## 7. 页面与交互设计

### 7.1 聚焦消息流

助手页采用三行结构：页头、可滚动消息区、紧凑 composer。页面主体占满可用视口高度，只有消息区滚动。

composer：

- 固定在对话栏底部；
- 外框只包裹输入框和发送栏；
- 默认整体约 100px；
- textarea 随内容自动增长到 220px，之后内部滚动；
- 用户仍可手动拉伸，最大 360px；
- 不参与剩余高度分配，也不被 Grid/Flex 拉伸。

### 7.2 Markdown

AI 消息使用安全 GFM 渲染，支持：

- 段落、标题、列表、引用；
- 粗体、斜体、删除线；
- 行内代码和代码块；
- GFM 表格；
- 安全链接。

原始 HTML 不执行。链接协议只允许 `http`、`https`、`mailto`；外部链接使用安全 `rel`。表格置于横向滚动容器，不能撑破消息列。

### 7.3 回合与执行详情

渲染顺序固定为：用户消息 → AI 回复 → 本轮执行详情。

- 已完成的详情默认折叠；
- 运行中、等待确认、失败或中断时自动展开；
- 折叠标题显示步骤数、状态和总耗时；
- 展开内容承载步骤、参数、结果、确认、取消和重试控件；
- 一个 turn 只有一个交互详情实例，避免重复确认或重试入口。

### 7.4 会话栏

- 提供“新建会话”；
- 按时间分组；
- 当前项高亮；
- 支持重命名和带确认的删除；
- 切换时显示局部加载状态，不清空当前内容；
- 加载失败保留当前会话并提供重试。

## 8. 状态与错误呈现

- 未认证：跳转登录。
- 会话列表加载失败：在会话栏显示可重试错误。
- 会话详情加载失败：保留现有消息，显示非破坏性错误。
- 发送中断：用户消息和已保存步骤仍可见，turn 显示中断。
- 持久化失败：显示“历史保存失败”，不宣称任务成功。
- 工具写结果不确定：显示高优先级提示，并引导检查 Todo 实际状态。
- Markdown 解析失败：回退为安全纯文本，而不是空白或执行 HTML。

## 9. 测试策略

### 9.1 Backend

- 注册、登录、刷新、退出、会话撤销；
- 密码哈希与 Cookie 属性；
- 无效、过期和撤销 token；
- 跨用户访问与伪造身份拒绝。

### 9.2 Agent

- PostgreSQL repository CRUD 与所有权过滤；
- turn/message/step 事务与幂等事件；
- 工具结果截断；
- 服务重启后的 interrupted 恢复；
- WebSocket Cookie、Origin 和 session 所有权；
- 删除屏障与晚到事件；
- 写操作结果不确定状态。

### 9.3 Frontend

- GFM 表格、代码、链接和 XSS 输入；
- composer 固定、紧凑、自动增长、滚动与手动拉伸；
- turn 与执行详情的 DOM 归属和顺序；
- 默认折叠及异常自动展开；
- 历史列表分组、新建、切换、重命名、删除；
- 401 单次刷新与登录跳转。

### 9.4 端到端与部署

- 两名用户的会话严格隔离；
- 新建、切换、重命名和删除；
- 页面刷新后恢复；
- 重启 Agent 容器后恢复；
- Markdown 表格正确预览；
- 详情折叠与确认/重试可用；
- composer 固定在底部且不异常拉伸；
- 完整 Docker 栈中 PostgreSQL、Redis、Backend、Agent、Frontend 全部健康。

## 10. 完成标准

只有同时满足以下条件才算完成：

1. 三个用户指出的 UI 问题在真实浏览器中复现测试转绿。
2. 账号由服务端可信认证，跨用户会话访问被自动化测试拒绝。
3. 多会话、消息与完整步骤在 PostgreSQL 中持久化，并经 Agent 重启验证可恢复。
4. 前端、Backend、Agent 的单元、集成和端到端测试全量通过。
5. 文档与环境变量模板同步更新，不提交密钥。
6. 改动合并并推送默认分支，受影响镜像重新构建，完整 Docker 栈健康。
