# Agent TodoList 项目状态

> 最后更新：2026-07-30。当前为 `codex/assistant-history-workspace` 发布候选；默认分支合并、生产镜像重建和五服务最终健康验收尚未完成。

## 进度

| 节点 | 状态 | 交付 |
|---|---|---|
| 1–4 数据库与 Go 认证 | 完成 | 用户/auth session schema，Argon2id，Cookie login/refresh/logout/me，轮换/撤销与 Origin 防护 |
| 5–7 Agent 持久化 | 完成 | owner 隔离 session CRUD，PostgreSQL turn/message/step，WS 鉴权，重启恢复和异常语义 |
| 8–12 前端工作区 | 完成 | Cookie auth，多会话，安全 GFM/表格，逐轮折叠详情，紧凑底部 composer |
| 13 全量 E2E | 功能完成，发布复核中 | Playwright context Mock transport、三浏览器当前发现 251 项；真实 Compose Chromium 4 项 |
| 14 文档、审计和发布 | 进行中 | 文档更新中；最终全量门禁、迁移、镜像、五服务、合并与推送待执行 |

## 当前系统边界

- 认证已是 Go 服务端真实认证，不再是浏览器本地 adapter。access/refresh 均为 `HttpOnly` Cookie；refresh 轮换、logout 撤销和 Agent auth-session 回查已实现。
- Agent 会话按登录用户隔离，其他用户无法读取、重命名、删除或连接该会话。
- PostgreSQL 保存 session、turn、message 和 step；内存只协调活跃执行、确认/重试和有限恢复。
- 成功终态为 `reply → DB complete → done`；中断、结果不确定和超大结果截断都有持久化状态。
- Todo API 保持当前 MVP 合约；生产 LLM 质量、SLA、成本和高并发评估不在本发布候选的自动化证明范围内。

## 测试证据

| 层 | 2026-07-30 候选证据 | 最终要求 |
|---|---|---|
| 前端单元/组件 | 569 项 | lint、coverage、build 全绿 |
| Mock E2E | 当前发现 251 项，Chromium/Firefox/WebKit | 零失败、无浏览器专用缺陷隐藏 |
| 真实 E2E | 4 项 real-chromium | Nginx/Go/Agent/PostgreSQL、重启恢复、owner 隔离全绿 |
| Go | 认证、Todo、handler/repository/service 测试已纳入 | `go test ./... -race` |
| Agent | pytest 含真实 PostgreSQL repository/API 覆盖 | 最终运行不得因缺少测试数据库跳过持久化套件 |
| 部署 | 尚未最终验收 | 恰好五个服务 running/healthy |

完整映射见 [E2E 矩阵](qa/e2e-matrix.md)，发布步骤见 [检查清单](qa/release-checklist.md)。

## 剩余节点

- [ ] 完成质量复审后的全量静态、单元、集成和 E2E 门禁。
- [ ] 对保留 PostgreSQL 卷执行幂等迁移并核对六张新表、外键和索引。
- [ ] 重建 backend、agent、frontend 镜像并启动 postgres、redis、backend、agent、frontend。
- [ ] 验证桌面/移动、亮/暗主题、浏览器 console 和 Agent 重启后历史恢复。
- [ ] 合并到默认分支并推送，核对远端提交和最终运行状态。

上述项目完成前，不得把本状态改为“已发布”或勾选发布检查清单中的合并/部署项。
