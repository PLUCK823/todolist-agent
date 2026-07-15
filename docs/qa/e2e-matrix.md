# 全量 E2E 覆盖矩阵

> 更新日期：2026-07-15。`C` = Chromium，`F` = Firefox，`W` = WebKit，`RC` = 隔离 Compose 真实栈的 Chromium。Mock E2E 对 C/F/W 运行；`visual.spec.ts` 因字体栅格差异只在 C 运行，不能据此跳过跨浏览器功能断言。表中未写目录的单元测试位于 `frontend/src/**/__tests__/`，Mock E2E 位于 `frontend/e2e/mock/`，真实栈 E2E 位于 `frontend/e2e/real/`。

## 产品功能到测试的映射

| 产品功能 / 验收路径 | 单元或组件测试 | Mock E2E | 真实栈 E2E | 浏览器 |
|---|---|---|---|---|
| 受保护路由、登录和原目标回跳 | `frontend/src/features/auth/__tests__/AuthContext.test.tsx`、`frontend/src/features/auth/__tests__/RequireSession.test.tsx`、`frontend/src/pages/__tests__/AuthPage.test.tsx` | `frontend/e2e/mock/auth.spec.ts` | — | C/F/W |
| 注册校验、注册后回填登录 | `AuthContext.test.tsx`、`AuthPage.test.tsx` | `auth.spec.ts` | — | C/F/W |
| 退出取消、确认并返回登录 | `ProfilePage.test.tsx`、`ConfirmDialog.test.tsx` | `auth.spec.ts`、`accessibility.spec.ts` | — | C/F/W |
| 任务创建、详情、编辑、删除确认 | `TaskDashboard.test.tsx`、`TaskDialog.test.tsx`、Todo query tests | `tasks.spec.ts`、`accessibility.spec.ts` | `todo-lifecycle.spec.ts` | C/F/W + RC |
| 完成、恢复和列表刷新 | `TaskDashboard.test.tsx`、Todo query tests | `tasks.spec.ts` | `todo-lifecycle.spec.ts` | C/F/W + RC |
| 搜索、空状态和单次失败恢复 | `TaskDashboard.test.tsx`、`useDebounce.test.ts` | `tasks.spec.ts` | `todo-lifecycle.spec.ts`（搜索） | C/F/W + RC |
| 状态/优先级筛选、截止日期排序、分页 | `TaskFilters.test.tsx`、Todo query tests | `tasks.spec.ts`、`accessibility.spec.ts` | — | C/F/W |
| 近期安排日期切换、已完成切换、创建与完成 | `UpcomingTimeline.test.tsx`、`UpcomingPage.test.tsx` | `upcoming.spec.ts` | — | C/F/W |
| 左导航展开/收起、页面切换和状态持久化 | Shell/NavigationRail tests | `navigation.spec.ts` | — | C/F/W |
| Agent 完全收起/展开与页头 ✦ 位置 | `AgentPanel.test.tsx`、Shell tests | `navigation.spec.ts`、`visual.spec.ts` | — | C/F/W；视觉 C |
| Command/Alt+K 快捷询问、焦点恢复和输入保护 | `CommandPalette.test.tsx` | `navigation.spec.ts`、`accessibility.spec.ts` | — | C/F/W |
| Agent 多步运行、等待、成功与共享会话 | reducer/session/timeline/page tests | `assistant.spec.ts`、`visual.spec.ts` | `agent-stream.spec.ts` | C/F/W + RC；视觉 C |
| Agent 超时、安全重试、防伪造和断线恢复 | reducer/schema/session tests | `assistant.spec.ts` | — | C/F/W |
| Agent 危险操作批准/拒绝 | Agent session/panel/page tests | `assistant.spec.ts` | — | C/F/W |
| 资料保存、头像预设和文件校验 | `ProfilePage.test.tsx`、`AvatarDialog.test.tsx` | `profile-settings.spec.ts`、`accessibility.spec.ts` | — | C/F/W |
| 主题、减少动效、Agent 启动偏好 | Preferences/Settings/motion tests | `profile-settings.spec.ts`、`accessibility.spec.ts` | — | C/F/W |
| 六页面与关键浮层视觉构图 | Token/surface/page tests | `visual.spec.ts`，14 张签核截图 | — | 视觉 C |
| 页面、弹窗、筛选浮层 axe 与键盘路径 | Dialog/Popover/common UI tests | `accessibility.spec.ts` | — | C/F/W |
| Mock fixture 隔离、一次性失败和 Agent 时序 | Mock handler/fixture tests | `fixtures.spec.ts` | — | C/F/W |
| Nginx 代理、Go/Agent 健康检查且无 MSW | — | — | `health.spec.ts` | RC |

## 浏览器项目

| Playwright 项目 | 范围 | 数据源 | 说明 |
|---|---|---|---|
| `chromium` | 全部 Mock 功能、axe、键盘、视觉 | MSW + WebSocket fixture | 固定 `zh-CN`、Asia/Shanghai、减少动效；比较视觉基线 |
| `firefox` | Mock 功能、axe、键盘 | MSW + WebSocket fixture | 忽略像素视觉文件，不忽略产品功能 |
| `webkit` | Mock 功能、axe、键盘 | MSW + WebSocket fixture | 对 macOS Option+Tab 的焦点行为有显式兼容路径 |
| `real-chromium` | 健康、Todo 生命周期、Agent 创建任务 | Nginx + Go + PostgreSQL + Agent + WebSocket | 不注册 MSW；由 `scripts/e2e-real.sh` 启动隔离栈 |

## 可追溯资产

- 交互与完成标准：[UI 高保真设计规格](../superpowers/specs/2026-07-13-agent-todolist-prototype-design.md#11-验证标准)
- 可运行参考：[V6 原型](../../.superpowers/brainstorm/40507-1783945975/content/workspace-full-flow-v6.html)
- 截图量尺及逐文件签核：[视觉回归基准](visual-review.md)
- 最终执行方式和非 MVP 边界：[发布检查清单](release-checklist.md)
- production build/preview 体验数据与八条路径证据：[experience-report.json](experience-report.json)
