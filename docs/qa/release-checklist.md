# 认证持久化助手发布检查清单

> 更新：2026-07-30。本地正式 Compose 发布已完成；公网 HTTPS 专属门禁保留为部署前检查项。

## 1. 配置与秘密

- [x] `.env.example` 只包含变量名和安全说明，不包含真实 API Key、Cookie、JWT 或生产密码。
- [x] 本地部署环境 `AUTH_JWT_SECRET` 已使用独立随机值且至少 32 字节。
- [ ] HTTPS 环境已设置 `AUTH_COOKIE_SECURE=true`，`AUTH_ALLOWED_ORIGINS` 为精确非通配 allowlist。
- [x] 所选 LLM provider、model、base URL 和 secret 已通过受控环境注入，日志/trace 不泄露密钥。

## 2. 静态、单元和集成门禁

```bash
cd backend && gofmt -w . && go test ./... -race
cd ../agent-service && uv run pytest
cd ../frontend && corepack pnpm lint
corepack pnpm test:coverage -- --run
corepack pnpm build
```

- [x] Go 全套 race 测试零失败。
- [x] Agent 全套 pytest 270/270；真实 PostgreSQL repository/API 套件零跳过，coverage 91%。
- [x] 前端 lint、coverage、build 零失败；单元/组件 46 文件、579 项。

## 3. E2E 门禁

```bash
cd frontend && corepack pnpm e2e:mock
cd .. && ./scripts/e2e-real.sh
```

- [x] 2026-07-30 迁移前候选：Playwright context Mock transport 在 C/F/W 原 227 项通过。
- [x] Cookie-authoritative transport 与批量任务用例加入后，C/F/W 254 项在最终候选全部通过。
- [x] 2026-07-30 功能分支候选：真实 Compose Chromium 5 项通过，包含批量事务与回滚。
- [x] 最终候选重新运行两套 E2E，零失败、零未解释 console/page error。
- [x] 真实测试确认注册、owner 隔离、session CRUD、PG 行/顺序/event_id、Agent 重启恢复、级联删除。
- [x] Markdown 表格、逐轮详情折叠、紧凑 composer、桌面/移动焦点和主题均通过。

Mock context 销毁即完成隔离，不需要清理 Service Worker。真实 E2E 必须使用独立 Compose project/volume 并只清理该项目，禁止全局清理用户 Docker 资源。

## 4. 保留卷迁移

先备份，再执行：

```bash
docker compose -p todolist-agent exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" < scripts/migrate.sql
```

- [x] 迁移在保留数据卷成功且连续执行两次安全；迁移前备份位于 `/tmp/todolist-agent-pre-assistant-migration-20260730.dump`。
- [x] `users`、`auth_sessions`、`agent_sessions`、`agent_turns`、`agent_messages`、`agent_steps` 存在。
- [x] owner、级联外键、ordinal 唯一约束、`event_id` 唯一约束和最近会话索引正确。
- [x] 迁移不修改既有 Todo 行；旧本地原型账号按说明重新注册。

## 5. 镜像和运行态

```bash
docker compose -p todolist-agent build backend agent frontend
docker compose -p todolist-agent up -d --force-recreate --wait
docker compose -p todolist-agent ps
```

- [x] backend、agent、frontend 镜像由本次默认分支应用源码重建。
- [x] 恰好 postgres、redis、backend、agent、frontend 五个服务 running/healthy。
- [x] 浏览器桌面/移动、亮/暗主题可操作，console 无错误。
- [x] 重启 `agent` 后会话、消息和执行步骤仍可恢复并继续新 turn。

## 6. 安全和异常语义

- [x] access/refresh 为 HttpOnly Cookie；浏览器存储不含 token。
- [x] refresh 原子轮换、logout 撤销、Agent 回查 auth session、状态变更 Origin 验证有自动化覆盖。
- [x] 会话 REST/WS 均从 principal 过滤 owner，跨用户资源隐藏。
- [x] `reply → DB complete → done`、`interrupted`、`result_uncertain`、`result_truncated` 有代码和测试覆盖。
- [x] 内存 coordinator 明确只用于活跃执行，不作为历史事实来源。

## 7. 文档、合并和发布

- [x] README、前端 README、API、架构、状态、E2E 矩阵和环境模板已更新为服务端认证/持久化实现。
- [x] 功能分支工作树干净，全部门禁证据已由非作者复审。
- [x] 功能分支已推送，默认分支已 fast-forward 合并并推送。
- [x] `git rev-list --count origin/master..master` 返回 `0`，远端默认分支指向发布提交。
- [x] 合并后的镜像和五服务运行态再次核对成功。

本地五容器 Goal 的适用项已全部完成。公网部署前必须再完成本清单中的 HTTPS Secure Cookie/Origin 项。

## 8. 已知范围

- 真实 E2E 的 fake LLM 只验证协议和系统链路，不代表生产模型质量、SLA 或成本。
- 团队协作、提醒推送、日历集成、原生移动、离线优先和大规模并发不属于本节点。
- Todo 多用户隔离若未在独立产品需求中声明，不应由 Agent session owner 测试推断为已完成。
