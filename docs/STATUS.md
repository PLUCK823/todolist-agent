# Agent TodoList 项目状态

> 最后更新：2026-07-30。认证持久化助手工作区已合并并推送到 `master`；本地正式 Compose 栈已完成镜像重建和五服务验收。

## 进度

| 节点 | 状态 | 交付 |
|---|---|---|
| 1–4 数据库与 Go 认证 | 完成 | 用户/auth session schema，Argon2id，Cookie login/refresh/logout/me，轮换/撤销与 Origin 防护 |
| 5–7 Agent 持久化 | 完成 | owner 隔离 session CRUD，PostgreSQL turn/message/step，WS 鉴权，重启恢复和异常语义 |
| 8–12 前端工作区 | 完成 | Cookie auth，多会话，安全 GFM/表格，逐轮折叠详情，紧凑底部 composer |
| 13 全量 E2E | 完成 | Playwright context Mock transport 三浏览器 254 项；真实 Compose Chromium 5 项；独立规格与质量复审通过 |
| 14 文档、审计和发布 | 完成 | 全量门禁、保留卷迁移、镜像重建、五服务验收、默认分支合并与推送均完成 |
| 15 原子批量操作 | 完成 | Go 五个批量端点与事务回滚、Agent 五个批量工具和一次删除确认、任务页跨页选择与批量操作 |

## 当前系统边界

- 认证已是 Go 服务端真实认证，不再是浏览器本地 adapter。access/refresh 均为 `HttpOnly` Cookie；refresh 轮换、logout 撤销和 Agent auth-session 回查已实现。
- Agent 会话按登录用户隔离，其他用户无法读取、重命名、删除或连接该会话。
- PostgreSQL 保存 session、turn、message 和 step；内存只协调活跃执行、确认/重试和有限恢复。
- 成功终态为 `reply → DB complete → done`；中断、结果不确定和超大结果截断都有持久化状态。
- Todo API 同时提供单项与 1–100 项原子批量合约；生产 LLM 质量、SLA、成本和高并发评估不在本发布候选的自动化证明范围内。

## 测试证据

| 层 | 2026-07-30 候选证据 | 最终要求 |
|---|---|---|
| 前端单元/组件 | 46 文件、579 项；coverage 阈值、lint、build 全绿 | 完成 |
| Mock E2E | 254/254，Chromium 90、Firefox 82、WebKit 82 | 完成 |
| 真实 E2E | 5/5 real-chromium | Nginx/Go/Agent/PostgreSQL、批量事务、重启恢复、owner 隔离全绿 |
| Go | `go test ./... -race` 全绿；合并后 `go test ./...` 再验证 | 完成 |
| Agent | 真实 PostgreSQL 下 270/270，零跳过，coverage 91% | 完成 |
| 部署 | postgres、redis、backend、agent、frontend 恰好五个服务 running/healthy | 完成 |

完整映射见 [E2E 矩阵](qa/e2e-matrix.md)，发布步骤见 [检查清单](qa/release-checklist.md)。

## 发布结果

- [x] 全量静态、单元、集成和 E2E 门禁通过，规格与质量复审通过。
- [x] 保留 PostgreSQL 卷已先备份，再连续执行两次幂等迁移；六张认证/Agent 表、级联外键、约束和索引已核对。
- [x] backend、agent、frontend 镜像已重建；postgres、redis、backend、agent、frontend 五个服务全部健康。
- [x] 桌面/移动、亮/暗主题、浏览器错误门禁和 Agent 重启历史恢复由 Mock/真实 E2E 覆盖。
- [x] 默认分支已 fast-forward 合并并推送，本地与 `origin/master` 一致；最终真实 HTTP 冒烟通过。

本地 Compose 发布已完成。若部署到公网 HTTPS，仍须按发布检查清单启用 Secure Cookie，并将 Origin allowlist 改为实际 HTTPS 域名。
