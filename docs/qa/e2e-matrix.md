# 全量 E2E 覆盖矩阵

> 更新：2026-07-30。`C/F/W` = Mock Chromium/Firefox/WebKit；`RC` = 隔离 Compose 真实栈 Chromium。Mock 使用 Playwright browser-context HTTP/WebSocket transport，不注册 Service Worker。真实项目不启用任何 Mock transport。

## 功能映射

| 功能 | 主要单元/组件覆盖 | Mock E2E | 真实 E2E | 浏览器 |
|---|---|---|---|---|
| Cookie 注册/登录/刷新/退出、受保护路由 | auth context/API/page tests | `auth.spec.ts` | `assistant-history.spec.ts` 注册两用户 | C/F/W + RC |
| Todo CRUD、完成/恢复、搜索/筛选/排序 | Todo query/dashboard/dialog tests | `tasks.spec.ts`、`accessibility.spec.ts` | `todo-lifecycle.spec.ts` | C/F/W + RC |
| 近期安排、导航、设置、资料与头像 | page/shell/preferences/profile tests | upcoming/navigation/profile/accessibility specs | — | C/F/W |
| 快捷询问、侧栏和助手独立页 | agent panel/session/page tests | navigation/assistant specs | — | C/F/W |
| 多会话创建、切换、重命名、删除和刷新恢复 | history API/reducer/session-list tests | `assistant-history.spec.ts` | `assistant-history.spec.ts` | C/F/W + RC |
| owner 隔离 | auth/history tests | 多账号隔离 fixture | Bob 不能读取 Alice session | C/F/W + RC |
| 安全 GFM Markdown 和表格 | `AgentMarkdown` tests | 表格/XSS/链接故事 | 确定性 table reply | C/F/W + RC |
| turn 顺序及逐轮可折叠执行详情 | `AgentTurn`/timeline tests | 完成/失败/中断状态 | reply 下方折叠并验证归属 | C/F/W + RC |
| 紧凑底部 composer、自动增长与焦点 | assistant page/composer/scroll tests | 桌面、390×844、Tab/Shift+Tab | — | C/F/W |
| 步骤事件、确认、失败、安全重试和断线 | schema/reducer/session tests | agent stream stories | PG step/event_id 行断言 | C/F/W + RC |
| 持久化和 Agent 重启恢复 | repository/history service tests | reload restore | 重启 Agent 后旧历史保留并继续新 turn | RC |
| Nginx/服务健康且无 Mock | — | — | `health.spec.ts` | RC |
| axe、键盘、主题、视觉量尺 | UI/accessibility tests | accessibility/visual specs | 关键路径 smoke | C/F/W；视觉 C |

## 项目和统计

| Playwright 项目 | 数据层 | 范围 | 当前候选证据 |
|---|---|---|---:|
| `chromium` | context transport | 全部 Mock 功能、键盘、axe、Chromium 视觉 | Mock 三项目当前合计 251 |
| `firefox` | context transport | 全部 Mock 功能、键盘、axe | 同上 |
| `webkit` | context transport | 全部 Mock 功能、键盘、axe | 同上 |
| `real-chromium` | Nginx + Go + Agent + PostgreSQL | 健康、Todo、认证持久化助手历史 | 4 |

前端单元/组件基线为 569 项。视觉 PNG 只在 Chromium 比较，但不得因此跳过 Firefox/WebKit 的功能或无障碍断言。

## 真实历史故事必须证明

1. Alice 和 Bob 通过公开注册/登录接口创建身份。
2. Alice 在 UI 创建、重命名、重载并继续一个会话，PostgreSQL title 与历史一致。
3. Bob 访问 Alice 会话得到 `404`/无数据。
4. 数据库中 message role/ordinal、step status/tool、稳定唯一 UUID `event_id` 正确。
5. 重启 Agent 后旧行不变且新 turn/message/step 继续增长。
6. Markdown 表格正确渲染；完成轮详情默认折叠，展开后只显示该轮步骤。
7. 删除会话后 turn/message/step 级联清理。

## 可追溯资产

- [V6 设计规格](../superpowers/specs/2026-07-13-agent-todolist-prototype-design.md)
- [架构](../ARCHITECTURE.md)
- [API](../API.md)
- [发布检查清单](release-checklist.md)
- [视觉回归基准](visual-review.md)
