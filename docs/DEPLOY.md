# Agent TodoList 部署指南

## 文档信息

| 项目 | 内容 |
| ------ | ------ |
| 版本 | v1.0 |
| 适用架构 | 简化版 |
| 部署方式 | Docker Compose（单机）/ 手动部署 |

---

## 目录

- [1. 部署前准备](#1-部署前准备)
- [2. Docker Compose 一键部署](#2-docker-compose-一键部署)
- [3. 手动部署](#3-手动部署)
- [4. Nginx 反向代理](#4-nginx-反向代理)
- [5. HTTPS 配置](#5-https-配置)
- [6. 健康检查与监控](#6-健康检查与监控)
- [7. 备份与恢复](#7-备份与恢复)
- [8. 常见问题](#8-常见问题)

---

## 1. 部署前准备

### 1.1 服务器要求

| 项目 | 最低配置 | 推荐配置 |
| ------ | ------ | ------ |
| CPU | 2 核 | 4 核 |
| 内存 | 4 GB | 8 GB |
| 磁盘 | 20 GB | 40 GB SSD |
| 系统 | Ubuntu 22.04 / Debian 12 | — |

### 1.2 软件依赖

```bash
# 安装 Docker（Ubuntu 示例）
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# 安装 Docker Compose
sudo apt install docker-compose-plugin

# 验证
docker --version       # ≥ 24.x
docker compose version  # ≥ 2.x
```

### 1.3 配置环境变量

```bash
cp .env.example .env
vim .env
```

**必须修改的变量：**

| 变量 | 说明 |
| ------ | ------ |
| `POSTGRES_PASSWORD` | 设置强密码 |
| `LLM_PROVIDER` | `openai`、`anthropic`、`google`/`gemini`、`deepseek` 或 `openai-compatible` |
| `LLM_API_KEY` | 所选提供商的 API Key；只保存在 Secret 或已忽略的 `.env` 中 |
| `LLM_MODEL` | 模型 ID；留空时使用提供商默认值（兼容端点除外） |
| `LLM_BASE_URL` | DeepSeek 可省略；`openai-compatible` 必填；原生提供商通常留空 |
| `LLM_TEMPERATURE` | `0.0` 到 `2.0`，默认 `0.1` |

默认模型分别为 OpenAI `gpt-4o`、Anthropic `claude-sonnet-4-5`、Google `gemini-2.5-flash` 和 DeepSeek `deepseek-v4-flash`。变更模型配置后运行 `docker compose up -d --force-recreate agent frontend`。服务会在启动时验证配置，但健康检查不会调用模型 API。

### 1.4 认证代理网络

Compose 会创建内部 `auth_proxy` 网络（`172.30.10.0/29`）。只有 `frontend`
（固定为 `172.30.10.2`）和 `backend`（固定为 `172.30.10.3`）加入其中；Nginx
通过仅在该网络可解析的 `backend-proxy` 别名转发普通 `/api/` 请求。后端因此只信任
`172.30.10.2/32` 发出的 `X-Real-IP`，Agent 和其他应用容器不能伪造该头绕过登录限流。

此 Compose 安全边界是固定配置，故不会读取 `.env` 中的
`AUTH_TRUSTED_PROXY_CIDRS`。该变量仅适用于手动部署后端时，且必须填写受控反向代理的
精确 `/32`（或 IPv6 `/128`）地址，不能填写宽泛 Docker 网段。部署或变更 Compose 时运行：

```bash
python3 scripts/verify-compose-security.py
```

---

## 2. Docker Compose 一键部署

### 2.1 首次部署

```bash
# 1. 拉取代码
git clone <repo-url> /opt/todolist
cd /opt/todolist

# 2. 配置环境变量
cp .env.example .env
vim .env

# 3. 构建并启动
docker compose up -d --build

# 4. 查看运行状态
docker compose ps

# 5. 查看日志
docker compose logs -f
```

### 2.2 更新部署

```bash
cd /opt/todolist
git pull
docker compose up -d --build
docker compose exec backend ./migrate up  # 如有数据库迁移
```

### 2.3 服务管理

```bash
docker compose up -d              # 启动
docker compose down               # 停止并删除容器
docker compose restart backend    # 重启单个服务
docker compose logs -f agent      # 查看 Agent 日志
docker compose exec backend sh    # 进入后端容器
```

---

## 3. 手动部署

### 3.1 数据库

```bash
# 使用托管数据库服务（如 Supabase、Railway），或手动安装：
docker run -d \
  --name postgres \
  -e POSTGRES_USER=todolist \
  -e POSTGRES_PASSWORD=<强密码> \
  -e POSTGRES_DB=todolist \
  -p 127.0.0.1:5432:5432 \
  -v pgdata:/var/lib/postgresql/data \
  postgres:16-alpine
```

### 3.2 后端

```bash
cd backend
go build -o server cmd/server/main.go

# 使用 systemd 管理
sudo tee /etc/systemd/system/todolist-backend.service << 'EOF'
[Unit]
Description=TodoList Backend Service
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/todolist/backend
EnvironmentFile=/opt/todolist/.env
ExecStart=/opt/todolist/backend/server
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable --now todolist-backend
```

### 3.3 Agent 服务

```bash
cd agent-service
uv sync
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 3.4 前端

```bash
cd frontend
pnpm install
pnpm build          # 产出 dist/ 目录

# 托管方式 A：Nginx 静态文件
sudo cp -r dist /var/www/todolist

# 托管方式 B：Node 生产服务器
pnpm preview --port 3000
```

---

## 4. Nginx 反向代理

```nginx
# /etc/nginx/sites-available/todolist
server {
    listen 80;
    server_name todolist.example.com;

    # 前端静态文件
    root /var/www/todolist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # 后端 API
    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Agent WebSocket
    location /api/agent/stream {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # Agent HTTP 接口
    location /api/agent/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/todolist /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## 5. HTTPS 配置

```bash
# 使用 Certbot 自动获取 Let's Encrypt 证书
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d todolist.example.com

# 自动续期（已内置）
sudo systemctl status certbot.timer
```

---

## 6. 健康检查与监控

### 6.1 健康检查端点

```bash
# 后端
curl http://localhost:8080/api/health
# → {"status": "ok", "postgres": "ok", "redis": "ok"}

# Agent
curl http://localhost:8000/api/agent/health
# → {"status": "ok", "llm": "connected"}
```

### 6.2 日志

```bash
# Docker Compose
docker compose logs -f --tail=100 backend

# systemd
journalctl -u todolist-backend -f
```

### 6.3 基础监控脚本

```bash
#!/bin/bash
# cron: */5 * * * * /opt/todolist/scripts/healthcheck.sh

ENDPOINTS=(
  "http://localhost:8080/api/health"
  "http://localhost:8000/api/agent/health"
)

for url in "${ENDPOINTS[@]}"; do
  if ! curl -sf "$url" > /dev/null; then
    echo "[ALERT] $url is DOWN at $(date)" | tee -a /var/log/todolist-health.log
  fi
done
```

---

## 7. 备份与恢复

### 7.1 数据库备份

```bash
# 导出
docker compose exec postgres pg_dump -U todolist todolist > backup_$(date +%Y%m%d).sql

# 定时备份（crontab）
0 2 * * * docker compose -f /opt/todolist/docker-compose.yml exec -T postgres \
  pg_dump -U todolist todolist | gzip > /backup/todolist_$(date +\%Y\%m\%d).sql.gz

# 保留最近 7 天
0 3 * * * find /backup -name "todolist_*.sql.gz" -mtime +7 -delete
```

### 7.2 数据库恢复

```bash
# 还原
docker compose exec -T postgres psql -U todolist todolist < backup_20260713.sql

# 或从 gzip
gunzip -c backup_20260713.sql.gz | docker compose exec -T postgres psql -U todolist todolist
```

---

## 8. 常见问题

### Q1: 容器启动后立即退出

```bash
docker compose logs postgres
# 常见原因：端口冲突、磁盘空间不足
```

### Q2: Agent 连接 LLM 失败

```bash
docker compose exec agent env | grep LLM
# 检查 API Key 是否正确、网络是否能访问外网
```

### Q3: 前端页面空白

```bash
# 检查浏览器控制台，通常是 API 请求 404
# 确认 Nginx 配置中 proxy_pass 地址和端口正确
curl http://localhost:8080/api/todos
```

### Q4: WebSocket 连接频繁断开

```nginx
# 增大 Nginx 超时时间
proxy_read_timeout 3600s;
proxy_send_timeout 3600s;
```
