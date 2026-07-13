# Agent TodoList 数据库设计文档

## 文档信息

| 项目 | 内容 |
| ------ | ------ |
| 数据库 | PostgreSQL 16 |
| ORM | GORM |
| 迁移工具 | golang-migrate |
| 字符集 | UTF-8 |

---

## 目录

- [1. 表结构](#1-表结构)
- [2. ER 图](#2-er-图)
- [3. 索引设计](#3-索引设计)
- [4. 迁移规范](#4-迁移规范)
- [5. 数据字典](#5-数据字典)

---

## 1. 表结构

### 1.1 todos — 待办事项表

```sql
CREATE TABLE todos (
    id          BIGSERIAL       PRIMARY KEY,
    title       VARCHAR(200)    NOT NULL,
    description TEXT            DEFAULT '',
    priority    VARCHAR(10)     NOT NULL DEFAULT 'medium'
                                CHECK (priority IN ('high', 'medium', 'low')),
    completed   BOOLEAN         NOT NULL DEFAULT false,
    due_date    TIMESTAMPTZ,
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
```

### 1.2 conversations — Agent 对话记录表

```sql
CREATE TABLE conversations (
    id          BIGSERIAL       PRIMARY KEY,
    session_id  VARCHAR(64)     NOT NULL,
    role        VARCHAR(20)     NOT NULL
                                CHECK (role IN ('user', 'assistant', 'system', 'tool')),
    content     TEXT            NOT NULL,
    metadata    JSONB           DEFAULT '{}',
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversations_session_id ON conversations(session_id, created_at);
```

### 1.3 表关系总结

| 表名 | 说明 | 预估数据量 |
| ------ | ------ | ------ |
| `todos` | 待办事项 | 万级 |
| `conversations` | 对话记录 | 十万级 |

---

## 2. ER 图

```text
┌──────────────────────┐
│        todos         │
├──────────────────────┤
│ PK │ id              │
│    │ title           │
│    │ description     │
│    │ priority        │
│    │ completed       │
│    │ due_date        │
│    │ created_at      │
│    │ updated_at      │
└──────────────────────┘

┌──────────────────────┐
│    conversations     │
├──────────────────────┤
│ PK │ id              │
│    │ session_id  ────│──→ 逻辑外键（非强制）
│    │ role             │
│    │ content          │
│    │ metadata (JSONB) │
│    │ created_at       │
└──────────────────────┘
```

简化版中 `todos` 和 `conversations` 不直接关联（Agent 通过 API 操作待办，对话记录独立存储）。

---

## 3. 索引设计

| 表 | 索引名 | 字段 | 类型 | 用途 |
| ------ | ------ | ------ | ------ | ------ |
| todos | pk_todos | id | PRIMARY KEY | 主键 |
| todos | idx_todos_completed | completed | B-tree | 按完成状态筛选 |
| todos | idx_todos_priority | priority | B-tree | 按优先级筛选 |
| todos | idx_todos_due_date | due_date | B-tree | 按截止日期排序 |
| todos | idx_todos_created_at | created_at | B-tree | 按创建时间排序 |
| todos | idx_todos_title_trgm | title | GIN (trigram) | 标题模糊搜索 |
| conversations | pk_conversations | id | PRIMARY KEY | 主键 |
| conversations | idx_conversations_session | (session_id, created_at) | B-tree | 按会话查询历史 |

**说明：** trigram 索引需要启用 `pg_trgm` 扩展：

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

---

## 4. 迁移规范

### 4.1 迁移文件命名

```text
backend/migrations/
├── 000001_create_todos.up.sql
├── 000001_create_todos.down.sql
├── 000002_create_conversations.up.sql
├── 000002_create_conversations.down.sql
└── ...
```

### 4.2 迁移规则

1. **每个迁移有 up 和 down 文件**，确保可逆
2. **迁移编号递增**，不跳过数字
3. **禁止修改已合并的迁移文件**，有变更写新迁移
4. **迁移中不写业务数据**，种子数据用独立脚本

### 4.3 迁移命令

```bash
# 创建新迁移
migrate create -ext sql -dir migrations -seq add_tags_to_todos

# 执行迁移
migrate -path migrations -database "$DATABASE_URL" up

# 回滚最近一次
migrate -path migrations -database "$DATABASE_URL" down 1

# 查看当前版本
migrate -path migrations -database "$DATABASE_URL" version
```

---

## 5. 数据字典

### 5.1 todos 字段详解

| 字段 | 类型 | 约束 | 默认值 | 说明 |
| ------ | ------ | ------ | ------ | ------ |
| id | BIGSERIAL | PK | 自增 | 唯一标识 |
| title | VARCHAR(200) | NOT NULL | — | 待办标题，最长 200 字符 |
| description | TEXT | — | '' | 详细描述，支持纯文本 |
| priority | VARCHAR(10) | NOT NULL, CHECK | 'medium' | high / medium / low |
| completed | BOOLEAN | NOT NULL | false | 是否已完成 |
| due_date | TIMESTAMPTZ | — | NULL | 截止时间，带时区 |
| created_at | TIMESTAMPTZ | NOT NULL | NOW() | 创建时间 |
| updated_at | TIMESTAMPTZ | NOT NULL | NOW() | 更新时间（GORM 自动维护） |

### 5.2 conversations 字段详解

| 字段 | 类型 | 约束 | 默认值 | 说明 |
| ------ | ------ | ------ | ------ | ------ |
| id | BIGSERIAL | PK | 自增 | 唯一标识 |
| session_id | VARCHAR(64) | NOT NULL | — | 会话标识符，UUID |
| role | VARCHAR(20) | NOT NULL, CHECK | — | user / assistant / system / tool |
| content | TEXT | NOT NULL | — | 消息内容 |
| metadata | JSONB | — | {} | 扩展信息（工具调用结果等） |
| created_at | TIMESTAMPTZ | NOT NULL | NOW() | 创建时间 |
