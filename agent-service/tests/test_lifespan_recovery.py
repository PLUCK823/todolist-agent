"""Agent process ownership and recovery ordering tests."""

from __future__ import annotations

import asyncio
import os
import signal
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.auth import AuthSettings
from app.main import create_app


@dataclass
class _SharedAdvisoryLock:
    owner: object | None = None


class _Connection:
    def __init__(self, pool: "_Pool"):
        self.pool = pool
        self.closed = False
        self.termination_listener = None

    async def fetchval(self, query, *_args):
        if self.closed:
            raise RuntimeError("connection is closed")
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

    def add_termination_listener(self, callback):
        self.termination_listener = callback

    def remove_termination_listener(self, callback):
        if self.termination_listener == callback:
            self.termination_listener = None

    def get_server_pid(self):
        return 4242

    def is_closed(self):
        return self.closed

    def terminate(self):
        if self.closed:
            return
        self.closed = True
        listener, self.termination_listener = self.termination_listener, None
        if listener is not None:
            listener(self)

    async def execute(self, query, *_args):
        if query.strip() == "SELECT 1":
            self.pool.events.append("ping")
            if self.pool.terminate_holder_on_ping:
                self.pool.connections[0].terminate()
                await asyncio.sleep(0)
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
        self.pool.connections.append(self.connection)
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
        terminate_holder_on_ping: bool = False,
    ):
        self.shared_lock = shared_lock or _SharedAdvisoryLock()
        self.max_size = max_size
        self.fail_ping = fail_ping
        self.terminate_holder_on_ping = terminate_holder_on_ping
        self.events: list[str] = []
        self.active_connections = 0
        self.connections: list[_Connection] = []

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
            assert app.state.recovery_ready is True

    assert pool.events == ["lock", "ping", "interrupt", "unlock"]
    assert pool.active_connections == 0
    assert app.state.recovery_ready is False


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


@pytest.mark.asyncio
async def test_holder_termination_revokes_readiness_and_calls_handler_once():
    pool = _Pool()
    lost = asyncio.Event()
    handler_calls = 0

    async def on_ownership_lost():
        nonlocal handler_calls
        handler_calls += 1
        lost.set()

    app = create_app(
        settings=_settings(),
        pool=pool,
        ownership_lost_handler=on_ownership_lost,
    )

    with patch("app.main.validate_model_configuration"):
        async with app.router.lifespan_context(app):
            ownership = app.state.recovery_ownership
            assert ownership.ready is True
            assert ownership.holder_pid == 4242
            holder = pool.connections[0]
            listener = holder.termination_listener

            holder.terminate()
            listener(holder)
            await asyncio.wait_for(lost.wait(), timeout=1)
            await asyncio.sleep(0)

            assert ownership.ready is False
            assert ownership.lost is True
            assert handler_calls == 1

            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                assert (await client.get("/api/agent/health")).status_code == 503
                assert (await client.get("/api/agent/sessions")).status_code == 503

            class WebSocket:
                def __init__(self):
                    self.app = app
                    self.accept_count = 0
                    self.close_codes = []

                async def accept(self):
                    self.accept_count += 1

                async def close(self, code=1000):
                    self.close_codes.append(code)

            route = next(
                route
                for route in app.router.routes
                if getattr(route, "path", None) == "/api/agent/stream"
            )
            websocket = WebSocket()
            with patch("app.main.process_message", new=AsyncMock()) as process:
                await route.endpoint(websocket)
            assert websocket.accept_count == 0
            assert websocket.close_codes == [1011]
            process.assert_not_awaited()

    assert pool.active_connections == 0


@pytest.mark.asyncio
async def test_default_ownership_lost_handler_fails_closed_before_signalling_process():
    pool = _Pool()
    app = create_app(settings=_settings(), pool=pool)
    signalled = asyncio.Event()
    signals = []

    def kill(pid, sig):
        signals.append((pid, sig, app.state.recovery_ready))
        signalled.set()

    with (
        patch("app.main.validate_model_configuration"),
        patch("app.main.os.kill", side_effect=kill),
    ):
        async with app.router.lifespan_context(app):
            pool.connections[0].terminate()
            await asyncio.sleep(0)

            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                assert (await client.get("/api/agent/health")).status_code == 503
            await asyncio.wait_for(signalled.wait(), timeout=1)

    assert signals == [(os.getpid(), signal.SIGTERM, False)]


@pytest.mark.asyncio
async def test_holder_loss_during_startup_cannot_restore_readiness():
    pool = _Pool(terminate_holder_on_ping=True)
    lost = asyncio.Event()
    app = create_app(
        settings=_settings(),
        pool=pool,
        ownership_lost_handler=lost.set,
    )

    with patch("app.main.validate_model_configuration"):
        with pytest.raises(RuntimeError, match="ownership was lost during startup"):
            async with app.router.lifespan_context(app):
                pass

    assert lost.is_set()
    assert app.state.recovery_ready is False
