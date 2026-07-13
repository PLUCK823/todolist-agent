-- Agent TodoList 数据库初始化脚本

-- 启用扩展
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ==========================================
-- 1. todos — 待办事项表
-- ==========================================
CREATE TABLE IF NOT EXISTS todos (
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

-- 索引
CREATE INDEX IF NOT EXISTS idx_todos_completed ON todos(completed);
CREATE INDEX IF NOT EXISTS idx_todos_priority ON todos(priority);
CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date);
CREATE INDEX IF NOT EXISTS idx_todos_created_at ON todos(created_at);
CREATE INDEX IF NOT EXISTS idx_todos_title_trgm ON todos USING GIN (title gin_trgm_ops);

-- ==========================================
-- 2. conversations — Agent 对话记录表
-- ==========================================
CREATE TABLE IF NOT EXISTS conversations (
    id          BIGSERIAL       PRIMARY KEY,
    session_id  VARCHAR(64)     NOT NULL,
    role        VARCHAR(20)     NOT NULL
                                CHECK (role IN ('user', 'assistant', 'system', 'tool')),
    content     TEXT            NOT NULL,
    metadata    JSONB           DEFAULT '{}',
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_session_id ON conversations(session_id, created_at);
