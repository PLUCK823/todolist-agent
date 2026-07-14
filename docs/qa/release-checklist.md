# 前端 V6 重构发布检查清单

> 更新日期：2026-07-14。本清单是发布候选分支的最终门禁；命令必须从干净工作树执行且退出码为 0。失败时保留 `frontend/test-results/artifacts/` 中的 trace、截图和视频，不得通过删除断言、browser-specific skip 或直接刷新视觉基线放行。

## 1. 环境

- [x] 以 Docker 构建基准 Node 22 + pnpm 10.30.3 执行；本机 Node 24.16.0 + pnpm 11.9.0 也完成验证，安装使用 `pnpm install --frozen-lockfile`。
- [x] Go 1.21+、Python 3.12、uv 和 Docker Compose 可用。
- [x] Playwright Chromium、Firefox、WebKit 已安装并在本轮实际运行。
- [x] Mock 与真实栈测试均由脚本管理 `127.0.0.1:3000`，没有复用未知残留服务。
- [x] 真实栈使用隔离项目名 `todolist-agent-e2e` 和独立数据卷，验证后执行 `down -v`。

## 2. 最终质量矩阵

| 门禁 | 命令 | 通过标准 |
|---|---|---|
| 前端静态检查 | `cd frontend && pnpm lint` | ESLint 退出码 0，无 error |
| 前端单元覆盖率 | `cd frontend && pnpm test:coverage` | 测试全绿；行/函数/语句 ≥85%，分支 ≥80% |
| 前端生产构建 | `cd frontend && pnpm build` | TypeScript 与 Vite 构建成功；首屏入口 gzip <100KB |
| 三浏览器 Mock E2E | `cd frontend && pnpm e2e:mock` | Chromium、Firefox、WebKit 全绿；无产品功能 browser-specific skip |
| Go 测试 | `cd backend && go test ./...` | 全部包退出码 0 |
| Agent 测试 | `cd agent-service && uv run pytest -q` | 139 项测试退出码 0；当前报告覆盖率 94%（尚未配置独立 fail-under） |
| 隔离真实栈 E2E | `./scripts/e2e-real.sh` | health、Todo 生命周期、Agent 流式创建三条 Chromium 用例全绿；退出后容器和数据卷被清理 |

Mock E2E 会自动启动 `VITE_ENABLE_MSW=true` 的独立 Vite 服务。真实栈脚本会叠加 `docker-compose.yml` 与 `docker-compose.e2e.yml`，不应手工复用开发数据库。

## 3. 关键体验与性能

- [x] 入口 `index-DdGWmUOU.js` gzip 86.00KB；CSS gzip 12.30KB，六个路由继续输出独立懒加载 chunk。
- [x] Docker production `/tasks` 使用 Chromium 新 context 测 5 次，从导航开始到页面标题与首个真实任务按钮可见：821/821/828/829/827ms，平均 825ms、最大 829ms（本机 Apple Silicon，2026-07-14）。
- [x] 1440px 桌面视口 Shell 展开/收起后 `scrollWidth - clientWidth = 0`；1223×1227 的 68px/210px 导航与 0px/340px Agent 由视觉/E2E 守卫。
- [x] 390×844 下 `scrollWidth - clientWidth = 0`；移动导航、Agent 全宽抽屉与可滚动 Dialog 由响应式测试守卫。
- [x] Agent panel body 计算样式为 `overflow-y: auto`，实测 `scrollHeight 168 > clientHeight 98`；收起与清空仍可操作，running 状态由 `assistant.spec.ts` 覆盖。
- [x] `accessibility.spec.ts` 在三浏览器验证 reduced-motion 下 Shell 与 Dialog 动画时长不超过 1ms。

## 4. 视觉与人工验收

- [x] Chromium 14 张基线由实现代理逐张检查。
- [x] 主代理于 2026-07-14 使用原始尺寸 contact sheet 复核，页面构图、导航/Agent 宽度、按钮顺序、浮层量尺和 Agent 状态全部 PASS。
- [x] 视觉签核明细记录在 [visual-review.md](visual-review.md)；允许的规格差异只有为 WCAG AA 提升小字号辅助文字对比度。
- [x] 本轮候选已运行 `pnpm e2e:mock` 并复用逐张批准的 14 张基线；本节点没有更改布局、颜色、字体或动效。

审批后的截图更新流程：先运行对应功能测试并确认断言通过，再逐张对照 V6 原型与本文件量尺；只有确认差异是预期设计变更后，运行 `pnpm e2e:update --project=chromium`，复核 Git diff 中的每张 PNG，并同步更新 `visual-review.md`。禁止为消除失败直接批量刷新。

设计规格第 11 节八条人工路径：

| # | 路径 | 自动化证据 | 截图 / 视觉证据 | 1223×1227 人工记录 | 执行时间 |
|---:|---|---|---|---|---|
| 1 | 创建任务 → 保存 → 列表反馈 | `tasks.spec.ts`、`todo-lifecycle.spec.ts` | `overlay-task-create-chromium.png`、任务页基线 | PASS；视觉与功能门禁覆盖 | 2026-07-14 |
| 2 | 打开任务 → 编辑或删除 → 二次确认 → 状态反馈 | `tasks.spec.ts`、`accessibility.spec.ts` | `overlay-task-delete-chromium.png` | PASS；Dialog 与危险操作顺序已签核 | 2026-07-14 |
| 3 | 状态和优先级筛选 | `tasks.spec.ts`、`accessibility.spec.ts` | `tasks-agent-collapsed-chromium.png` | PASS；Popover 键盘路径和结果页覆盖 | 2026-07-14 |
| 4 | 左导航展开/收起和页面切换 | `navigation.spec.ts`、页面视觉基线 | tasks/upcoming/assistant/profile 页面基线 | PASS；68px/210px 量尺已签核 | 2026-07-14 |
| 5 | Agent 展开/完全收起，以及快捷输入框 | `navigation.spec.ts`、`visual.spec.ts` | tasks expanded/collapsed、`overlay-quick-ask-chromium.png` | PASS；0px/340px 与 630px 浮层已签核 | 2026-07-14 |
| 6 | Agent 多步执行与等待状态 | `assistant.spec.ts`、`agent-stream.spec.ts` | `agent-running-chromium.png`、`agent-failure-chromium.png` | PASS；运行、等待和失败状态已签核 | 2026-07-14 |
| 7 | 更换头像和保存资料 | `profile-settings.spec.ts`、`visual.spec.ts` | `profile-chromium.png`、`overlay-avatar-chromium.png` | PASS；头像浮层与资料页已签核 | 2026-07-14 |
| 8 | 退出确认 → 登录 → 注册 → 返回登录 → 回到应用 | `auth.spec.ts`、登录/注册视觉基线 | `login-chromium.png`、`register-chromium.png` | PASS；完整认证原型闭环覆盖 | 2026-07-14 |

> 上表的 PASS 是仓库实现与自动化/视觉签核的交付记录，不代表额外的最终用户审批。任何无响应按钮都视为失败。

## 5. 安全与产品边界

- [x] README、前端 README 和状态文档均明确：认证是本地原型 adapter，而非服务端认证。
- [x] `health.spec.ts` 在 real-chromium 页面读取 `navigator.serviceWorker.getRegistrations()` 并断言为 0，证明真实项目没有注册 MSW。
- [x] Agent 写操作超时不显示危险重放；删除必须经过服务端绑定的确认，Mock 与 Agent 单元测试均覆盖。
- [x] 本轮日志、截图、trace 和提交内容不包含真实 LLM Key、密码或生产数据。

## 6. 已知非 MVP 范围

以下内容没有在本次交付中实现，不得在发布说明中宣称已完成：

- 服务端注册、登录、授权、密码找回、会话吊销、多用户 Todo 隔离和跨设备资料同步。
- 团队协作、成员分配、共享清单与权限模型。
- 定时提醒、推送通知、日历集成和数据统计仪表盘。
- Todo 自定义分类标签和富文本编辑器。
- 生产级 LLM 质量/SLA 评估、计费保护和大规模并发验证；真实栈 E2E 使用确定性的 fake LLM provider。
- 原生移动应用、离线优先/PWA 和跨浏览器像素一致性；移动 Web 仅做响应式功能验收。

## 7. 发布操作

- [x] 提交前 `git status --short` 只包含本节点计划内文件，且 `git diff --check` 通过。
- [x] 上述质量矩阵已在 2026-07-14 重新运行：前端 402 单测、197 Mock E2E、3 real E2E，Go 与 Agent 测试均通过。
- [x] 与 [E2E 覆盖矩阵](e2e-matrix.md)、[视觉签核](visual-review.md) 和 [开发状态](../STATUS.md) 一致。
- [ ] 合并目标分支后执行 `cd frontend && pnpm exec playwright test e2e/mock/smoke.spec.ts --project=chromium`，再将合并提交推送到远端。
