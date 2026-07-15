# Agent TodoList 项目开发状态

> 最后更新：2026-07-15。当前状态为 V6 前端重构发布候选；最终可发布性以 [发布检查清单](qa/release-checklist.md) 的当次执行结果为准。

## 总体进度

| 模块 | 状态 | 当前交付 |
|---|---|---|
| 产品与设计 | 🟢 完成 | PRD、V6 设计规格、可交互原型、14 张视觉基线与逐文件签核 |
| Go 后端 | 🟢 MVP 完成 | Todo CRUD、搜索、筛选、排序、分页、健康检查 |
| React 前端 | 🟢 V6 重构完成 | 六页面、十类弹窗/浮层、三种 Agent 入口、响应式布局 |
| Python Agent | 🟢 MVP 完成 | WebSocket 流式步骤、工具调用、确认、超时、失败和受控重试 |
| E2E 与无障碍 | 🟢 门禁就绪 | C/F/W Mock E2E、Chromium 视觉、axe/键盘、真实 Compose 栈 Chromium |
| 认证 | 🟡 仅原型闭环 | 浏览器本地 adapter；服务端认证与授权未实现 |

## 前端页面与交互

| 范围 | 完成度 | 说明 |
|---|---:|---|
| 我的任务 | 100% | CRUD、完成/恢复、详情、搜索、状态/优先级筛选、排序、分页和错误恢复 |
| 近期安排 | 100% | 七日选择、空日状态、已完成切换、创建、查看与完成 |
| 智能助手 | 100% | 右侧可折叠面板、独立工作区、Command/Alt+K 快捷询问共享同一会话 |
| 个人资料 | 100% | 资料保存、头像预设/上传、统计展示和退出确认 |
| 登录与注册 | 100% 原型 | 表单验证、注册后回填、受保护路由、原目标回跳和退出闭环 |
| 设置 | 100% | 主题、减少动效、简体中文选项和 Agent 启动偏好持久化 |
| 响应式与可访问性 | 100% MVP | 桌面三栏、移动抽屉、焦点管理、键盘路径、axe 与 WCAG AA 对比度 |

### 认证范围声明

登录、注册、资料、头像和会话由 `frontend/src/features/auth/auth.storage.ts` 的可替换本地 adapter 驱动。凭据不是明文存储，但数据仍位于浏览器端；当前没有服务端用户表、授权中间件、令牌、会话吊销、多用户 Todo 隔离或跨设备同步。因此文档和产品展示不得称其为“已完成服务端认证”。

## Agent 前端联调

- WebSocket 客户端验证服务端事件 schema，并维护连接、运行、等待、确认、完成、失败和断开状态。
- 多步工具时间线在面板、快捷询问和独立助手页共享；任务变更会刷新 Todo 查询缓存。
- 删除等危险操作要求确认；只读失败仅在服务端签发且完成当前 turn 后允许安全重试。
- 写操作超时、客户端断线或伪造 retry 不提供危险重放路径。
- 真实栈 E2E 经过 Nginx → Agent WebSocket → Go API → PostgreSQL；为了确定性使用 fake LLM provider，不代表生产模型质量评估。

## 测试与浏览器矩阵

| 层 | 门禁 | 状态 |
|---|---|---|
| 前端单元/组件 | 402 项；语句 89.96%、分支 84.57%、函数 90.92%、行 93.82% | 🟢 超过 85/80/85/85 门禁 |
| Mock 功能 E2E | Chromium、Firefox、WebKit，不用 browser-specific skip 隐藏缺陷 | 🟢 197 项全绿 |
| 视觉回归 | Chromium，1223×1227，`maxDiffPixelRatio: 0.01` | 🟢 14 张基线已签核 |
| 无障碍与键盘 | axe WCAG 2.2 AA + 关键纯键盘路径 | 🟢 覆盖页面、Dialog、Popover 与退出流程 |
| 真实栈 | real-chromium：健康、Todo 生命周期、Agent 创建 Todo | 🟢 3 项全绿，隔离 Compose 自动清理 |
| Go | `go test ./...` | 🟢 纳入最终矩阵 |
| Agent | `uv run --frozen --extra dev pytest -q`：139 项，94% 覆盖率 | 🟢 全绿；`uv.lock` 已纳入版本控制，尚未配置独立 fail-under |
| Production 体验 | 入口 gzip 85,133B；全新 context cold FTI 5/5 <2s；桌面/移动零横溢；8 条路径证据 | 🟢 `pnpm verify:experience` 可复现 |

逐功能映射见 [全量 E2E 覆盖矩阵](qa/e2e-matrix.md)，执行命令、性能检查和非 MVP 边界见 [发布检查清单](qa/release-checklist.md)。

## 原型复现入口

不了解前期讨论的 AI 或开发者应同时使用以下三类权威参考：

1. [V6 设计规格](superpowers/specs/2026-07-13-agent-todolist-prototype-design.md)：产品规则与八条完整验收路径。
2. [V6 可交互原型](../.superpowers/brainstorm/40507-1783945975/content/workspace-full-flow-v6.html)：页面构图、弹窗、动效和交互顺序。
3. [视觉回归基准](qa/visual-review.md)：固定视口、设计量尺、基线截图与已批准差异。

只运行前端原型：

```bash
cd frontend
pnpm install
VITE_ENABLE_MSW=true pnpm dev --host 127.0.0.1
```

打开 <http://127.0.0.1:3000>，注册本地账号后登录。

真实栈验证：

```bash
./scripts/e2e-real.sh
```

该脚本使用隔离 Compose 项目、独立端口与数据卷，完成后自动清理。

## 已知非 MVP

- 服务端认证、授权、多用户隔离和跨设备同步。
- 团队协作、提醒通知、日历集成和统计看板。
- 自定义任务标签与富文本。
- 生产 LLM 质量/SLA、大规模并发和成本评估。
- 原生移动应用与离线优先/PWA。

## 更新日志

| 日期 | 更新内容 |
|---|---|
| 2026-07-15 | 增加 production build/preview 体验门禁、机器可读报告和八条完整路径证据 |
| 2026-07-14 | 完成 V6 前端全量重构、Agent 多步交互、认证原型闭环与完整测试矩阵 |
| 2026-07-14 | 建立 Chromium 视觉基线并完成 14 张逐文件签核 |
| 2026-07-14 | 增加 C/F/W Mock E2E、axe/键盘测试和隔离真实栈 Chromium E2E |
| 2026-07-13 | 完成初始 MVP、设计规格和 V6 可交互原型 |
