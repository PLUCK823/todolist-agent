# 前端 V6 重构发布检查清单

> 更新日期：2026-07-15。本清单是发布候选分支的最终门禁；命令必须从干净工作树执行且退出码为 0。失败时保留 `frontend/test-results/artifacts/` 中的 trace、截图和视频，不得通过删除断言、browser-specific skip 或直接刷新视觉基线放行。

## 1. 环境

- [x] 项目通过 `packageManager` 与 Dockerfile 固定 pnpm 10.30.3，Node 要求 ≥22；Docker Node 22 与本机 Node 24.16.0 均以 Corepack 解析到 pnpm 10.30.3，`CI=true pnpm install --frozen-lockfile` 已从重建的 `node_modules` 验证。
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
| 可复现体验门禁 | `cd frontend && pnpm verify:experience` | production MSW build/preview；5 个全新 context 首次导航 `/tasks` 的 cold FTI <2s；桌面/移动无横溢；Agent 运行期可滚动、可操作；8 条路径证据齐全 |
| 三浏览器 Mock E2E | `cd frontend && pnpm e2e:mock` | Chromium、Firefox、WebKit 全绿；无产品功能 browser-specific skip |
| Go 测试 | `cd backend && go test ./...` | 全部包退出码 0 |
| Agent 测试 | `cd agent-service && uv sync --frozen --extra dev && uv run --frozen --extra dev pytest -q` | 锁文件安装可复现；139 项测试退出码 0；当前报告覆盖率 94%（尚未配置独立 fail-under） |
| 隔离真实栈 E2E | `./scripts/e2e-real.sh` | health、Todo 生命周期、Agent 流式创建三条 Chromium 用例全绿；退出后容器和数据卷被清理 |

Mock E2E 会自动启动 `VITE_ENABLE_MSW=true` 的独立 Vite 服务。真实栈脚本会叠加 `docker-compose.yml` 与 `docker-compose.e2e.yml`，不应手工复用开发数据库。

### Fresh checkout 可复制验证

```bash
corepack enable
cd frontend && pnpm install --frozen-lockfile
pnpm exec playwright install chromium firefox webkit
pnpm lint && pnpm test:coverage && pnpm build && pnpm verify:experience && pnpm e2e:mock
cd ../backend && go test ./...
cd ../agent-service && uv sync --frozen --extra dev && uv run --frozen --extra dev pytest -q
cd .. && ./scripts/e2e-real.sh
git status --short && git diff --check
# 合并后
cd frontend && pnpm exec playwright test e2e/mock/smoke.spec.ts --project=chromium
```

若真实 E2E 被中断，兜底清理：`docker compose -f docker-compose.yml -f docker-compose.e2e.yml down -v --remove-orphans`。

Mock Playwright context 会自动销毁；若在普通浏览器手工使用过 Mock 页面，还必须清理对应 origin：DevTools → Application → Storage → **Clear site data**，并在 Service Workers 中执行 **Unregister**。等价控制台命令：`localStorage.clear(); navigator.serviceWorker.getRegistrations().then((items) => Promise.all(items.map((item) => item.unregister())))`。清理后关闭该标签页，再执行真实栈验证。

## 3. 关键体验与性能

- [x] production MSW 入口 `index-CLoFBEz5.js` raw 269,785B、gzip 85,135B（约 85.14KB，限制 100,000B）；CSS gzip 12.30KB，六个路由继续输出独立懒加载 chunk。
- [x] production preview `/tasks` 使用 5 个全新 Chromium context；在任何 `goto` 前通过 `addInitScript` 注入 session，从每个 context 的第一次 `page.goto('/tasks')` 前计时，包含 MSW 首次安装/controller 与数据加载，直到标题和首个真实任务按钮可见：829/832/829/824/828ms，平均 828.4ms、最大 832ms（本机 Apple Silicon，2026-07-15）。
- [x] 1223×1227 桌面与 390×844 移动视口均实测 `scrollWidth - clientWidth = 0`；68px/210px 导航与 0px/340px Agent 另由视觉/E2E 守卫。
- [x] 390×844 下 `scrollWidth - clientWidth = 0`；移动导航、Agent 全宽抽屉与可滚动 Dialog 由响应式测试守卫。
- [x] 1223×844 下 Agent 运行期间，任务主区实测 `scrollTop 0 → 326`；“新建任务”保持 enabled 并成功打开 Dialog。1223×1227 的 Agent 运行证据另见第 6 条路径截图。
- [x] `accessibility.spec.ts` 在三浏览器验证 reduced-motion 下 Shell 与 Dialog 动画时长不超过 1ms。

机器可读的本轮数据、时间戳和截图路径见 [experience-report.json](experience-report.json)；生成器为 `frontend/scripts/experience-gate.mjs`，每次使用隔离端口。SIGINT、SIGTERM 与注入运行时错误均由自动化验证退出码和清理结果：浏览器 context 关闭、detached Vite 进程组退出且端口可立即重新绑定。

## 4. 视觉与人工验收

- [x] Chromium 14 张基线由实现代理逐张检查。
- [x] 主代理于 2026-07-14 使用原始尺寸 contact sheet 复核，页面构图、导航/Agent 宽度、按钮顺序、浮层量尺和 Agent 状态全部 PASS。
- [x] 视觉签核明细记录在 [visual-review.md](visual-review.md)；允许的规格差异只有为 WCAG AA 提升小字号辅助文字对比度。
- [x] 本轮候选已运行 `pnpm e2e:mock` 并复用逐张批准的 14 张基线；本节点没有更改布局、颜色、字体或动效。

审批后的截图更新流程：先运行对应功能测试并确认断言通过，再逐张对照 V6 原型与本文件量尺；只有确认差异是预期设计变更后，运行 `pnpm e2e:update --project=chromium`，复核 Git diff 中的每张 PNG，并同步更新 `visual-review.md`。禁止为消除失败直接批量刷新。

设计规格第 11 节八条人工路径：

| # | 路径 | 自动化证据 | 截图 / 视觉证据 | 1223×1227 人工记录 | 执行时间 |
|---:|---|---|---|---|---|
| 1 | 创建任务 → 保存 → 列表反馈 | `tasks.spec.ts`、`todo-lifecycle.spec.ts` | [path-1.png](evidence/path-1.png) | PASS；创建 Dialog 关闭且新任务进入列表，1,130ms | 2026-07-15 06:15:00Z |
| 2 | 打开任务 → 编辑或删除 → 二次确认 → 状态反馈 | `tasks.spec.ts`、`accessibility.spec.ts` | [path-2.png](evidence/path-2.png) | PASS；保存编辑、确认删除并验证列表移除，1,245ms | 2026-07-15 06:15:01Z |
| 3 | 状态和优先级筛选 | `tasks.spec.ts`、`accessibility.spec.ts` | [path-3.png](evidence/path-3.png) | PASS；实际应用“进行中 + 高优先级”并验证唯一匹配结果，1,118ms | 2026-07-15 06:15:03Z |
| 4 | 左导航展开/收起和页面切换 | `navigation.spec.ts`、页面视觉基线 | [path-4.png](evidence/path-4.png) | PASS；展开、进入近期安排、再收起并验证标签隐藏，1,201ms | 2026-07-15 06:15:04Z |
| 5 | Agent 展开/完全收起，以及快捷输入框 | `navigation.spec.ts`、`visual.spec.ts` | [path-5.png](evidence/path-5.png) | PASS；确认 Agent 列完全移除、页头入口出现并以 ⌘K 打开快捷询问，1,047ms | 2026-07-15 06:15:05Z |
| 6 | Agent 多步执行与等待状态 | `assistant.spec.ts`、`agent-stream.spec.ts` | [path-6.png](evidence/path-6.png) | PASS；断言 running/time 后等待 action、reply、done 与 Todo 刷新；另证主区滚动和非冲突操作，6,090ms | 2026-07-15 06:15:11Z |
| 7 | 更换头像和保存资料 | `profile-settings.spec.ts`、`visual.spec.ts` | [path-7.png](evidence/path-7.png) | PASS；保存新名称、改选星紫头像并验证资料页与展开导航同步，1,271ms | 2026-07-15 06:15:12Z |
| 8 | 退出确认 → 登录 → 注册 → 返回登录 → 回到应用 | `auth.spec.ts`、登录/注册视觉基线 | [path-8.png](evidence/path-8.png) | PASS；完整认证闭环后回到任务页并加载真实任务，2,775ms | 2026-07-15 06:15:15Z |

> 上表的 PASS 是仓库实现与自动化/视觉签核的交付记录，不代表额外的最终用户审批。任何无响应按钮都视为失败。

记录由自动化辅助走查产生，再由主代理视觉签核；不表示用户或测试人员逐项手工点击。未来视觉 PR 必须填写“原型参照、预期差异、WCAG 覆盖项、截图文件”，并由非作者 reviewer 批准后才能更新基线。

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
- [x] 上述质量矩阵已在 2026-07-15 重新运行：前端 402 单测、197 Mock E2E、3 real E2E，Go 与 Agent 测试均通过。
- [x] 与 [E2E 覆盖矩阵](e2e-matrix.md)、[视觉签核](visual-review.md) 和 [开发状态](../STATUS.md) 一致。
- [ ] 合并目标分支后执行 `cd frontend && pnpm exec playwright test e2e/mock/smoke.spec.ts --project=chromium`，再将合并提交推送到远端。

## 8. 风险登记

| 风险 | Owner | 缓解措施 | 接受标准 |
|---|---|---|---|
| 本地认证不能保护真实用户数据 | Backend/Auth owner | 上线前替换 adapter，加入服务端授权和多用户隔离 | 安全评审与真实认证 E2E 通过 |
| fake LLM 不代表生产模型质量 | Agent owner | 增加离线评测、超时/成本预算和候选模型回放 | 质量、SLA、成本阈值获批准 |
| Chromium 像素基线不覆盖跨浏览器栅格 | Frontend owner | C/F/W 功能与 axe 全跑，视觉由非作者审批 | 功能全绿且 Chromium diff 签核 |
| 移动响应式属于后续范围扩展 | Frontend owner | 持续运行 390×844 experience 门禁 | 无横溢且抽屉/Dialog 可操作 |
