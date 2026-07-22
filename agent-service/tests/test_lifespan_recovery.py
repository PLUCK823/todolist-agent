"""Agent process ownership and recovery ordering tests."""

from __future__ import annotations

from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from unittest.mock import patch

import pytest

from app.auth import AuthSettings
from app.main import create_app


@dataclass
class _SharedAdvisoryLock:
    owner: object | None = None


class _Connection:
    def __init__(self, pool: "_Pool"):
        self.pool = pool

    async def fetchval(self, query, *_args):
        if "pg_try_advisory_lock" in query:
            if self.pool.shared_lock.owner is not None:
                self.pool.events.append("lock_denied")
                return False
            self.pool.shared_lock.owner = self
            self.pool.events.append("lock")
            return True
        if "pg_advisory_unlock" in query:
            assert self.pool.shared_lock.owner is self
            self.pool.shared_lock.owner = None
            self.pool.events.append("unlock")
            return True
        raise AssertionError(f"unexpected fetchval: {query}")

    async def execute(self, query, *_args):
        if query.strip() == "SELECT 1":
            self.pool.events.append("ping")
            if self.pool.fail_ping:
                raise RuntimeError("ping failed")
            return "SELECT 1"
        if "UPDATE agent_turns SET status='interrupted'" in query:
            self.pool.events.append("interrupt")
            return "UPDATE 0"
        raise AssertionError(f"unexpected execute: {query}")


class _Acquire(AbstractAsyncContextManager):
    def __init__(self, pool: "_Pool"):
        self.pool = pool
        self.connection = _Connection(pool)

    async def __aenter__(self):
        self.pool.active_connections += 1
        if self.pool.active_connections > self.pool.max_size:
            raise AssertionError("pool exhausted")
        return self.connection

    async def __aexit__(self, *_exc):
        self.pool.active_connections -= 1


class _Pool:
    def __init__(
        self,
        shared_lock: _SharedAdvisoryLock | None = None,
        *,
        max_size: int = 2,
        fail_ping: bool = False,
    ):
        self.shared_lock = shared_lock or _SharedAdvisoryLock()
        self.max_size = max_size
        self.fail_ping = fail_ping
        self.events: list[str] = []
        self.active_connections = 0

    def get_max_size(self):
        return self.max_size

    def acquire(self):
        return _Acquire(self)


def _settings(*, pool_max_size: int = 2) -> AuthSettings:
    return AuthSettings(
        secret="x" * 32,
        access_cookie="todolist_access",
        allowed_origins=frozenset({"http://frontend.test"}),
        issuer="todolist-backend",
        database_url="postgresql://unused",
        pool_min_size=1,
        pool_max_size=pool_max_size,
    )


@pytest.mark.asyncio
async def test_lifespan_holds_lock_before_ping_and_recovery_then_releases_it():
    pool = _Pool()
    app = create_app(settings=_settings(), pool=pool)

    with patch("app.main.validate_model_configuration"):
        async with app.router.lifespan_context(app):
            assert pool.events == ["lock", "ping", "interrupt"]
            assert pool.active_connections == 1
            assert app.state.history_repository is not None

    assert pool.events == ["lock", "ping", "interrupt", "unlock"]
    assert pool.active_connections == 0


@pytest.mark.asyncio
async def test_second_lifespan_fails_before_ping_interrupt_or_readiness():
    shared_lock = _SharedAdvisoryLock()
    first_pool = _Pool(shared_lock)
    second_pool = _Pool(shared_lock)
    first = create_app(settings=_settings(), pool=first_pool)
    second = create_app(settings=_settings(), pool=second_pool)

    with patch("app.main.validate_model_configuration"):
        async with first.router.lifespan_context(first):
            with pytest.raises(RuntimeError, match="another Agent instance"):
                async with second.router.lifespan_context(second):
                    pass

            assert second_pool.events == ["lock_denied"]
            assert second_pool.active_connections == 0
            assert not hasattr(second.state, "history_repository")


@pytest.mark.asyncio
async def test_startup_failure_unlocks_and_releases_reserved_connection():
    shared_lock = _SharedAdvisoryLock()
    failing_pool = _Pool(shared_lock, fail_ping=True)
    successor_pool = _Pool(shared_lock)
    failing = create_app(settings=_settings(), pool=failing_pool)
    successor = create_app(settings=_settings(), pool=successor_pool)

    with patch("app.main.validate_model_configuration"):
        with pytest.raises(RuntimeError, match="ping failed"):
            async with failing.router.lifespan_context(failing):
                pass
        assert failing_pool.events == ["lock", "ping", "unlock"]
        assert failing_pool.active_connections == 0

        async with successor.router.lifespan_context(successor):
            assert successor_pool.events == ["lock", "ping", "interrupt"]


@pytest.mark.asyncio
async def test_lifespan_rejects_pool_too_small_for_reserved_connection():
    pool = _Pool(max_size=1)
    app = create_app(settings=_settings(pool_max_size=1), pool=pool)

    with patch("app.main.validate_model_configuration"):
        with pytest.raises(RuntimeError, match="pool max size must be at least 2"):
            async with app.router.lifespan_context(app):
                pass

    assert pool.events == []
    assert pool.active_connections == 0
