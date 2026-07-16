-- Idempotent migration for an existing Agent TodoList PostgreSQL database.
-- The legacy conversations table is removed only after every replacement table
-- and index has been created successfully in the same transaction.

BEGIN;

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    email           CITEXT       UNIQUE NOT NULL,
    display_name    VARCHAR(120) NOT NULL,
    password_hash   TEXT         NOT NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_sessions (
    id                  UUID        PRIMARY KEY,
    user_id             UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash  CHAR(64)    UNIQUE NOT NULL,
    expires_at          TIMESTAMPTZ NOT NULL,
    revoked_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id
    ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at
    ON auth_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_active_user
    ON auth_sessions(user_id, expires_at DESC) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS agent_sessions (
    id                UUID         PRIMARY KEY,
    owner_id          UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title             VARCHAR(160) NOT NULL,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_message_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_owner_recent
    ON agent_sessions(owner_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS agent_turns (
    id                UUID        PRIMARY KEY,
    session_id        UUID        NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    ordinal           INTEGER     NOT NULL CHECK (ordinal > 0),
    status            VARCHAR(32) NOT NULL
                      CHECK (status IN (
                          'running',
                          'waiting_confirmation',
                          'completed',
                          'failed',
                          'interrupted'
                      )),
    started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at      TIMESTAMPTZ,
    failure_code      VARCHAR(128),
    failure_message   TEXT,
    result_uncertain  BOOLEAN     NOT NULL DEFAULT false,
    UNIQUE (session_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_agent_turns_session_started
    ON agent_turns(session_id, started_at);
CREATE INDEX IF NOT EXISTS idx_agent_turns_open
    ON agent_turns(status, started_at)
    WHERE status IN ('running', 'waiting_confirmation');

CREATE TABLE IF NOT EXISTS agent_messages (
    id          UUID        PRIMARY KEY,
    session_id  UUID        NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    turn_id     UUID        NOT NULL REFERENCES agent_turns(id) ON DELETE CASCADE,
    role        VARCHAR(16) NOT NULL
                CHECK (role IN ('user', 'assistant', 'system', 'tool')),
    content     TEXT        NOT NULL,
    ordinal     INTEGER     NOT NULL CHECK (ordinal > 0),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (session_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_turn_ordinal
    ON agent_messages(turn_id, ordinal);

CREATE TABLE IF NOT EXISTS agent_steps (
    id                      UUID         PRIMARY KEY,
    turn_id                 UUID         NOT NULL REFERENCES agent_turns(id) ON DELETE CASCADE,
    event_id                UUID         UNIQUE NOT NULL,
    ordinal                 INTEGER      NOT NULL CHECK (ordinal > 0),
    label                   VARCHAR(200) NOT NULL,
    tool                    VARCHAR(160),
    status                  VARCHAR(32)  NOT NULL
                            CHECK (status IN (
                                'waiting',
                                'running',
                                'waiting_confirmation',
                                'completed',
                                'failed',
                                'interrupted'
                            )),
    args                    JSONB        NOT NULL DEFAULT '{}'::jsonb,
    result                  JSONB,
    result_preview          TEXT,
    result_truncated        BOOLEAN      NOT NULL DEFAULT false,
    duration_ms             BIGINT       CHECK (duration_ms IS NULL OR duration_ms >= 0),
    error_code              VARCHAR(128),
    error_message           TEXT,
    retryable               BOOLEAN      NOT NULL DEFAULT false,
    confirmation_id         VARCHAR(128),
    confirmation_message    TEXT,
    confirmation_approved   BOOLEAN,
    started_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    completed_at            TIMESTAMPTZ,
    UNIQUE (turn_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_agent_steps_turn_started
    ON agent_steps(turn_id, started_at);

DROP TABLE IF EXISTS conversations;

COMMIT;
