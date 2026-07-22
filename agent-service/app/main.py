"""Authenticated REST and WebSocket boundary for the Agent service."""

from __future__ import annotations

import asyncio
import inspect
import json
import logging
import os
import signal
import uuid
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable
from uuid import UUID
from uuid import NAMESPACE_URL, uuid5

import asyncpg
from fastapi import (
    Depends,
    FastAPI,
    HTTPException,
    Query,
    Request,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage

from .agent import (
    AgentEventSink,
    DurableTurnRequest,
    InvalidRetryStep,
    ProcessResult,
    TransportDeliveryError,
    complete_turn,
    delete_history,
    discard_retry_attempt,
    invalidate_turn_confirmations,
    invalidate_turn_tokens,
    process_message,
    resolve_confirmation,
    retry_failed_step,
    validate_model_configuration,
)
from .auth import (
    AuthDatabaseFailure,
    AuthFailure,
    AuthPrincipal,
    AuthSettings,
    authenticate_request,
    authenticate_websocket,
)
from .history_models import PersistedStepEvent, SessionDetail, SessionSummary
from .history_repository import HistoryRepository
from .history_service import HistoryService
from .schemas import (
    ChatRequest,
    ConfirmationResponse,
    RetryStepRequest,
    SessionCreateRequest,
    SessionRenameRequest,
)


logger = logging.getLogger(__name__)
AGENT_RECOVERY_LOCK_KEY = 0x4147454E54524543  # Stable bigint key: "AGENTREC".
OwnershipLostHandler = Callable[[], Awaitable[None] | None]


class HistoryPersistenceError(RuntimeError):
    """A durable write failed; ``uncertain`` tracks an applied Todo mutation."""

    def __init__(self, message: str, *, uncertain: bool):
        super().__init__(message)
        self.uncertain = uncertain


class TerminalAlreadySentError(RuntimeError):
    """A post-send local acknowledgement failed; no second event is legal."""


@dataclass(frozen=True, slots=True)
class SessionRuntimeLease:
    owner_id: UUID
    session_id: UUID
    generation: int
    token: UUID


class SessionRuntimeCoordinator:
    """Owner-scoped generation barrier for active streams and late writes."""

    def __init__(self) -> None:
        self._state_lock = asyncio.Lock()
        self._operation_locks: dict[tuple[UUID, UUID], asyncio.Lock] = {}
        self._generations: dict[tuple[UUID, UUID], int] = {}
        self._tombstones: set[tuple[UUID, UUID]] = set()
        self._leases: dict[tuple[UUID, UUID], set[UUID]] = {}
        self._tasks: dict[tuple[UUID, UUID], set[tuple[UUID, asyncio.Task[Any]]]] = {}
        self._operations: dict[tuple[UUID, UUID], int] = {}
        self._deleting: dict[tuple[UUID, UUID], int] = {}
        self._closed = False

    @property
    def state_size(self) -> int:
        """Number of owner/session keys retained by runtime coordination."""
        return len(
            set(self._operation_locks)
            | set(self._generations)
            | self._tombstones
            | set(self._leases)
            | set(self._tasks)
            | set(self._operations)
            | set(self._deleting)
        )

    async def acquire(self, owner_id: UUID, session_id: UUID) -> SessionRuntimeLease:
        key = (owner_id, session_id)
        async with self._state_lock:
            if self._closed or key in self._tombstones:
                raise HistoryPersistenceError(
                    "session is being deleted", uncertain=False
                )
            self._operation_locks.setdefault(key, asyncio.Lock())
            generation = self._generations.setdefault(key, 0)
            token = uuid.uuid4()
            self._leases.setdefault(key, set()).add(token)
            return SessionRuntimeLease(owner_id, session_id, generation, token)

    async def attach(self, lease: SessionRuntimeLease, task: asyncio.Task[Any]) -> None:
        key = (lease.owner_id, lease.session_id)
        async with self._state_lock:
            self._assert_current(lease)
            attachment = (lease.token, task)
            tasks = self._tasks.setdefault(key, set())
            if attachment in tasks:
                raise HistoryPersistenceError(
                    "task is already attached", uncertain=False
                )
            tasks.add(attachment)

    async def detach(self, lease: SessionRuntimeLease, task: asyncio.Task[Any]) -> None:
        key = (lease.owner_id, lease.session_id)
        async with self._state_lock:
            attachment = (lease.token, task)
            tasks = self._tasks.get(key)
            if tasks is None or attachment not in tasks:
                raise HistoryPersistenceError("task is not attached", uncertain=False)
            tasks.remove(attachment)
            if not tasks:
                self._tasks.pop(key, None)
            self._cleanup_if_idle(key)

    async def release(self, lease: SessionRuntimeLease) -> None:
        key = (lease.owner_id, lease.session_id)
        async with self._state_lock:
            leases = self._leases.get(key)
            if leases is None or lease.token not in leases:
                raise HistoryPersistenceError(
                    "lease was already released", uncertain=False
                )
            if any(token == lease.token for token, _ in self._tasks.get(key, ())):
                raise HistoryPersistenceError(
                    "lease still has an attached task", uncertain=False
                )
            leases.remove(lease.token)
            if not leases:
                self._leases.pop(key, None)
            self._cleanup_if_idle(key)

    async def run(
        self, lease: SessionRuntimeLease, operation: Callable[[], Awaitable[Any]]
    ) -> Any:
        key = (lease.owner_id, lease.session_id)
        async with self._state_lock:
            self._assert_current(lease)
            lock = self._operation_locks[key]
            self._operations[key] = self._operations.get(key, 0) + 1
        try:
            async with lock:
                async with self._state_lock:
                    self._assert_generation_current(lease)
                return await operation()
        finally:
            async with self._state_lock:
                remaining = self._operations[key] - 1
                if remaining:
                    self._operations[key] = remaining
                else:
                    self._operations.pop(key, None)
                self._cleanup_if_idle(key)

    async def delete_barrier(
        self,
        owner_id: UUID,
        session_id: UUID,
        delete_operation: Callable[[], Awaitable[bool]] | None = None,
    ) -> bool:
        """Tombstone, cancel and drain before the repository cascade executes."""
        key = (owner_id, session_id)
        async with self._state_lock:
            lock = self._operation_locks.setdefault(key, asyncio.Lock())
            generation = self._generations.get(key, 0) + 1
            self._generations[key] = generation
            self._tombstones.add(key)
            self._deleting[key] = self._deleting.get(key, 0) + 1
            tasks = tuple({task for _, task in self._tasks.get(key, ())})
        try:
            current = asyncio.current_task()
            for task in tasks:
                if task is not current:
                    await _cancel_and_fully_drain(
                        task,
                        timeout=float(
                            os.getenv("AGENT_DELETE_DRAIN_TIMEOUT_SECONDS", "30")
                        ),
                    )
            # A repository operation already past the generation check must
            # leave the critical section before the cascade decision begins.
            async with lock:
                await delete_history(str(session_id))
                if delete_operation is not None:
                    return await delete_operation()
                return True
        finally:
            async with self._state_lock:
                remaining = self._deleting[key] - 1
                if remaining:
                    self._deleting[key] = remaining
                else:
                    self._deleting.pop(key, None)
                self._cleanup_if_idle(key)

    async def cancel_all(self) -> None:
        async with self._state_lock:
            self._closed = True
            tasks = tuple(
                {task for values in self._tasks.values() for _, task in values}
            )
            for key in self._operation_locks:
                self._generations[key] = self._generations.get(key, 0) + 1
                self._tombstones.add(key)
        current = asyncio.current_task()
        for task in tasks:
            if task is not current:
                await _cancel_and_fully_drain(task)

    def _cleanup_if_idle(self, key: tuple[UUID, UUID]) -> None:
        if (
            self._leases.get(key)
            or self._tasks.get(key)
            or self._operations.get(key)
            or self._deleting.get(key)
        ):
            return
        self._operation_locks.pop(key, None)
        self._generations.pop(key, None)
        self._tombstones.discard(key)
        self._leases.pop(key, None)
        self._tasks.pop(key, None)
        self._operations.pop(key, None)

    def _assert_current(self, lease: SessionRuntimeLease) -> None:
        self._assert_generation_current(lease)
        key = (lease.owner_id, lease.session_id)
        if lease.token not in self._leases.get(key, ()):
            raise HistoryPersistenceError("lease was released", uncertain=False)

    def _assert_generation_current(self, lease: SessionRuntimeLease) -> None:
        key = (lease.owner_id, lease.session_id)
        if key in self._tombstones or self._generations.get(key, 0) != lease.generation:
            raise HistoryPersistenceError(
                "session generation is stale", uncertain=False
            )


class RepositoryTurnPersistence:
    """Owner/session/turn-bound implementation of the durable sink protocol."""

    def __init__(
        self,
        repository: HistoryRepository,
        coordinator: SessionRuntimeCoordinator,
        lease: SessionRuntimeLease,
    ) -> None:
        self._repository = repository
        self._coordinator = coordinator
        self._lease = lease
        self.turn_id: UUID | None = None
        self._message_id: UUID | None = None
        self._assistant_message_id: UUID | None = None
        self._started = False
        self._write_applied = False
        self._step_context: dict[UUID, dict[str, Any]] = {}

    @property
    def uncertain(self) -> bool:
        return self._write_applied

    async def prepare_write(self) -> None:
        if self.turn_id is None:
            raise HistoryPersistenceError(
                "turn was not started", uncertain=self.uncertain
            )

        async def operation():
            await self._repository.mark_turn_uncertain(
                self._lease.owner_id, self.turn_id
            )

        try:
            await self._coordinator.run(self._lease, operation)
        except HistoryPersistenceError:
            raise
        except Exception as exc:
            raise HistoryPersistenceError(str(exc), uncertain=self.uncertain) from exc
        self._write_applied = True

    async def start(self, request: DurableTurnRequest) -> None:
        turn_id = UUID(str(request.turn_id))
        message_id = UUID(str(request.message_id))
        assistant_message_id = UUID(str(request.assistant_message_id))
        if self._started:
            if self.turn_id != turn_id:
                raise HistoryPersistenceError(
                    "turn identity changed", uncertain=self.uncertain
                )
            return

        async def operation():
            return await self._repository.start_turn(
                self._lease.owner_id,
                self._lease.session_id,
                turn_id,
                message_id,
                request.message,
                request.created_at,
            )

        try:
            await self._coordinator.run(self._lease, operation)
        except HistoryPersistenceError:
            raise
        except Exception as exc:
            raise HistoryPersistenceError(str(exc), uncertain=self.uncertain) from exc
        self.turn_id = turn_id
        self._message_id = message_id
        self._assistant_message_id = assistant_message_id
        self._started = True

    async def checkpoint(self, event: dict[str, Any]) -> None:
        if self.turn_id is None:
            raise HistoryPersistenceError(
                "turn was not started", uncertain=self.uncertain
            )
        event_id = UUID(str(event["event_id"]))
        context = self._step_context.setdefault(event_id, {})
        context.update(
            {
                key: event[key]
                for key in (
                    "label",
                    "tool",
                    "args",
                    "started_at",
                    "confirmation_id",
                    "confirmation_message",
                    "confirmation_approved",
                )
                if key in event and event[key] is not None
            }
        )
        event_type = event.get("type")
        if event_type == "confirmation_required":
            context["confirmation_id"] = event.get("confirmation_id")
            context["confirmation_message"] = event.get("message")
        if "confirmation_approved" in event:
            context["confirmation_approved"] = event["confirmation_approved"]
        status = {
            "step_started": "running",
            "confirmation_required": "waiting_confirmation",
            "step_completed": "completed",
            "action_completed": "completed",
            "step_failed": "failed",
        }.get(event_type)
        if status is None:
            return
        started_at = _parse_event_time(context.get("started_at"))
        completed_at = (
            datetime.now(timezone.utc) if status in {"completed", "failed"} else None
        )
        persisted = PersistedStepEvent(
            event_id=event_id,
            label=str(
                context.get("label")
                or event.get("action")
                or event.get("step_id")
                or "Agent step"
            ),
            status=status,
            tool=context.get("tool") or event.get("action"),
            args=dict(context.get("args") or {}),
            result=event.get("result"),
            duration_ms=event.get("duration_ms"),
            error_code=event.get("error_code"),
            error_message=event.get("message") if event_type == "step_failed" else None,
            retryable=bool(event.get("retryable", False)) and not self.uncertain,
            confirmation_id=context.get("confirmation_id"),
            confirmation_message=context.get("confirmation_message"),
            confirmation_approved=context.get("confirmation_approved"),
            started_at=started_at,
            completed_at=completed_at,
        )

        async def operation():
            return await self._repository.upsert_step(
                self._lease.owner_id, self.turn_id, persisted
            )

        try:
            accepted = await self._coordinator.run(self._lease, operation)
            if not accepted:
                raise HistoryPersistenceError(
                    "step checkpoint rejected", uncertain=self.uncertain
                )
        except HistoryPersistenceError as exc:
            if exc.uncertain == self.uncertain:
                raise
            raise HistoryPersistenceError(str(exc), uncertain=self.uncertain) from exc
        except Exception as exc:
            raise HistoryPersistenceError(str(exc), uncertain=self.uncertain) from exc

    async def complete(self, reply: str) -> None:
        if self.turn_id is None:
            raise HistoryPersistenceError(
                "turn was not started", uncertain=self.uncertain
            )
        assistant_id = self._assistant_message_id or uuid5(
            NAMESPACE_URL, f"agent:{self.turn_id}:assistant"
        )

        async def operation():
            await self._repository.complete_turn(
                self._lease.owner_id,
                self.turn_id,
                assistant_id,
                reply,
                datetime.now(timezone.utc),
            )

        try:
            await self._coordinator.run(self._lease, operation)
        except HistoryPersistenceError as exc:
            raise HistoryPersistenceError(str(exc), uncertain=self.uncertain) from exc
        except Exception as exc:
            raise HistoryPersistenceError(str(exc), uncertain=self.uncertain) from exc

    async def fail(self, code: str, message: str, *, uncertain: bool) -> None:
        if self.turn_id is None:
            return

        async def operation():
            await self._repository.fail_turn(
                self._lease.owner_id,
                self.turn_id,
                code,
                message,
                uncertain or self.uncertain,
            )

        await self._coordinator.run(self._lease, operation)


def _parse_event_time(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def _completed_history_messages(
    detail: SessionDetail | dict[str, Any],
) -> list[BaseMessage]:
    """Hydrate only completed chat pairs, ordered by durable ordinal."""
    if isinstance(detail, dict):
        return []
    messages = [
        message
        for turn in detail.turns
        if turn.status == "completed"
        for message in turn.messages
        if message.role in {"user", "assistant"}
    ]
    messages.sort(key=lambda item: item.ordinal)
    return [
        HumanMessage(content=message.content)
        if message.role == "user"
        else AIMessage(content=message.content)
        for message in messages
    ]


async def _execute_durable_message(
    repository: HistoryRepository,
    coordinator: SessionRuntimeCoordinator,
    owner_id: UUID,
    session_id: UUID,
    message: str,
    detail: SessionDetail | dict[str, Any],
    *,
    on_event: AgentEventSink | None = None,
    on_terminal: Callable[[ProcessResult], Awaitable[None]] | None = None,
    lease: SessionRuntimeLease | None = None,
) -> ProcessResult:
    """Run the production turn lifecycle shared by HTTP and WebSocket."""
    active_lease = lease or await coordinator.acquire(owner_id, session_id)
    current = asyncio.current_task()
    assert current is not None
    attached = False
    persistence = RepositoryTurnPersistence(repository, coordinator, active_lease)
    durable_enabled = "persistence" in inspect.signature(process_message).parameters
    kwargs: dict[str, Any] = {"on_event": on_event}
    if durable_enabled:
        kwargs.update(
            persistence=persistence,
            initial_history=_completed_history_messages(detail),
            owner_id=str(owner_id),
            runtime_generation=active_lease.generation,
        )
    try:
        await coordinator.attach(active_lease, current)
        attached = True
        try:
            result = await process_message(str(session_id), message, **kwargs)
            if durable_enabled:
                await persistence.complete(result.reply)
        except asyncio.CancelledError:
            # Transport loss stops execution but deliberately leaves the
            # durable turn open. Its journal can resume idempotently.
            invalidate_turn_tokens(
                str(session_id),
                str(persistence.turn_id) if persistence.turn_id else None,
                None,
            )
            raise
        except TransportDeliveryError:
            invalidate_turn_confirmations(
                str(session_id),
                str(persistence.turn_id) if persistence.turn_id else None,
                None,
            )
            raise
        except HistoryPersistenceError as exc:
            invalidate_turn_tokens(
                str(session_id),
                str(persistence.turn_id) if persistence.turn_id else None,
                None,
            )
            with suppress(Exception):
                await persistence.fail(
                    "HISTORY_PERSISTENCE_FAILED",
                    str(exc),
                    uncertain=exc.uncertain or persistence.uncertain,
                )
            raise
        except Exception as exc:
            with suppress(Exception):
                await persistence.fail(
                    getattr(exc, "phase", "AGENT_ERROR"),
                    str(exc),
                    uncertain=persistence.uncertain,
                )
            raise

        # A terminal transport message is permitted only after the durable
        # assistant commit. A lost send must not rewrite that completed turn.
        if on_terminal is not None:
            try:
                await on_terminal(result)
            except TransportDeliveryError:
                raise
            except Exception as exc:
                raise TransportDeliveryError(str(exc)) from exc
        if isinstance(result, ProcessResult):
            acknowledged = await complete_turn(
                str(session_id), result.turn_id, result.generation
            )
            if not acknowledged:
                if on_terminal is not None:
                    raise TerminalAlreadySentError(
                        "terminal memory acknowledgement rejected"
                    )
                raise HistoryPersistenceError(
                    "terminal memory acknowledgement rejected",
                    uncertain=persistence.uncertain,
                )
        return result
    finally:
        try:
            if attached:
                await coordinator.detach(active_lease, current)
        finally:
            await coordinator.release(active_lease)


def _cors_origins() -> list[str]:
    """Read a harmless import-time CORS default; auth config validates at startup."""
    origins = [
        item.strip()
        for item in os.getenv("AUTH_ALLOWED_ORIGINS", "http://localhost:3000").split(
            ","
        )
        if item.strip()
    ]
    return [origin for origin in origins if origin != "*"] or ["http://localhost:3000"]


def _ok(data: object = None) -> dict[str, object]:
    return {"code": 0, "message": "ok", "data": data}


def _err(code: int, message: str, status: int = 400) -> HTTPException:
    return HTTPException(
        status_code=status, detail={"code": code, "message": message, "data": None}
    )


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _history_failure_event() -> dict[str, Any]:
    return {
        "type": "step_failed",
        "event_id": str(uuid.uuid4()),
        "step_id": "history",
        "error_code": "HISTORY_PERSISTENCE_FAILED",
        "message": "Conversation history could not be saved",
        "retryable": False,
        "duration_ms": 0,
    }


def _protocol_failure_event(
    step_id: str, error_code: str, message: str
) -> dict[str, Any]:
    return {
        "type": "step_failed",
        "event_id": str(uuid.uuid4()),
        "step_id": step_id,
        "error_code": error_code,
        "message": message,
        "retryable": False,
        "duration_ms": 0,
    }


def _session_payload(session: SessionSummary) -> dict[str, object]:
    return {
        "id": str(session.id),
        "title": session.title,
        "created_at": session.created_at.isoformat(),
        "updated_at": session.updated_at.isoformat(),
        "last_message_at": session.last_message_at.isoformat(),
    }


def _detail_payload(detail: SessionDetail | dict[str, Any]) -> dict[str, object]:
    if isinstance(detail, dict):
        session = detail["session"]
        return {"session": _session_payload(session), "turns": detail.get("turns", [])}
    turns: list[dict[str, object]] = []
    for turn in detail.turns:
        turns.append(
            {
                "id": str(turn.id),
                "ordinal": turn.ordinal,
                "status": turn.status,
                "started_at": turn.started_at.isoformat(),
                "completed_at": turn.completed_at.isoformat()
                if turn.completed_at
                else None,
                "failure_code": turn.failure_code,
                "failure_message": turn.failure_message,
                "result_uncertain": turn.result_uncertain,
                "messages": [
                    {
                        "id": str(message.id),
                        "role": message.role,
                        "content": message.content,
                        "ordinal": message.ordinal,
                        "created_at": message.created_at.isoformat(),
                    }
                    for message in turn.messages
                ],
                "steps": [
                    {
                        "id": str(step.id),
                        "event_id": str(step.event_id),
                        "ordinal": step.ordinal,
                        "label": step.label,
                        "tool": step.tool,
                        "status": step.status,
                        "args": step.args,
                        "result": step.result,
                        "result_preview": step.result_preview,
                        "result_truncated": step.result_truncated,
                        "duration_ms": step.duration_ms,
                        "error_code": step.error_code,
                        "error_message": step.error_message,
                        "retryable": step.retryable,
                        "confirmation_id": step.confirmation_id,
                        "confirmation_message": step.confirmation_message,
                        "confirmation_approved": step.confirmation_approved,
                        "started_at": step.started_at.isoformat(),
                        "completed_at": step.completed_at.isoformat()
                        if step.completed_at
                        else None,
                    }
                    for step in turn.steps
                ],
            }
        )
    return {"session": _session_payload(detail), "turns": turns}


async def get_history_service(request: Request) -> HistoryService:
    if getattr(request.app.state, "recovery_ready", False) is not True:
        raise _err(50301, "Agent recovery ownership is unavailable", 503)
    service = getattr(request.app.state, "history_service", None)
    if service is None:
        raise _err(50301, "Agent persistence is unavailable", 503)
    return service


async def get_current_principal(request: Request) -> AuthPrincipal:
    if getattr(request.app.state, "recovery_ready", False) is not True:
        raise _err(50301, "Agent recovery ownership is unavailable", 503)
    settings = getattr(request.app.state, "auth_settings", None)
    repository = getattr(request.app.state, "history_repository", None)
    if settings is None or repository is None:
        raise _err(50301, "Agent authentication is unavailable", 503)
    try:
        return await authenticate_request(request, settings, repository)
    except AuthDatabaseFailure as exc:
        raise _err(50301, "Agent authentication is unavailable", 503) from exc
    except AuthFailure as exc:
        raise _err(
            40301 if exc.status_code == 403 else 40101, str(exc), exc.status_code
        ) from exc


class _WebSocketWriter:
    def __init__(self, ws: WebSocket):
        self._ws = ws
        self._lock = asyncio.Lock()

    async def send_json(self, event: dict[str, Any]) -> None:
        async with self._lock:
            await self._ws.send_json(event)


async def _finish_successful_stream(writer: _WebSocketWriter, ws: WebSocket) -> None:
    """Best-effort success framing after the durable reply is already final."""
    try:
        await writer.send_json({"type": "done"})
        await ws.close()
    except Exception:
        # The reply and durable terminal state already exist. Emitting any
        # failure or second done frame here would manufacture a false outcome.
        with suppress(Exception):
            await ws.close()
        return


async def _cancel_and_drain(
    task: asyncio.Task[Any] | None, timeout: float = 0.1
) -> None:
    if task is None:
        return
    if task.done():
        with suppress(BaseException):
            task.result()
        return
    task.cancel()
    done, _ = await asyncio.wait({task}, timeout=timeout)
    if done:
        with suppress(BaseException):
            task.result()
    else:
        task.add_done_callback(
            lambda finished: finished.exception() if not finished.cancelled() else None
        )


async def _cancel_and_fully_drain(
    task: asyncio.Task[Any] | None,
    timeout: float | None = None,
) -> None:
    """Cancel an owned execution and do not return while it can still mutate."""
    if task is None:
        return
    if not task.done():
        task.cancel()
    waiter = asyncio.shield(task)
    try:
        if timeout is None:
            await waiter
        else:
            await asyncio.wait_for(waiter, timeout=timeout)
    except asyncio.CancelledError:
        # A successfully cancelled child is the expected drain outcome. If the
        # caller itself is cancelled, preserve that cancellation instead.
        if not task.done():
            raise
    except TimeoutError:
        # Delete must fail closed while any execution could still issue a
        # repository write; callers must not continue to the cascade.
        raise
    except BaseException:
        # The caller is draining a child whose failure is handled at the
        # protocol boundary; draining must not re-raise it a second time.
        pass
    finally:
        if task.done():
            with suppress(BaseException):
                task.result()


def _terminate_process_on_ownership_loss() -> None:
    os.kill(os.getpid(), signal.SIGTERM)


class _AgentRecoveryOwnership:
    """Track the reserved PostgreSQL session and fail closed if it disappears."""

    def __init__(
        self,
        application: FastAPI,
        connection: asyncpg.Connection,
        ownership_lost_handler: OwnershipLostHandler,
    ) -> None:
        self._application = application
        self._connection = connection
        self._ownership_lost_handler = ownership_lost_handler
        self._loop = asyncio.get_running_loop()
        self._lost = False
        self._closing = False
        self._handler_task: asyncio.Future[None] | None = None
        self.holder_pid = connection.get_server_pid()

    @property
    def ready(self) -> bool:
        return getattr(self._application.state, "recovery_ready", False) is True

    @property
    def lost(self) -> bool:
        return self._lost

    def listen(self) -> None:
        self._connection.add_termination_listener(self._on_termination)

    def mark_ready(self) -> None:
        if self._holder_is_closed_or_detached():
            self._revoke()
        if self._lost or self._closing:
            self._application.state.recovery_ready = False
            raise RuntimeError("Agent recovery ownership was lost during startup")
        self._application.state.recovery_ready = True

    def _on_termination(self, _connection: asyncpg.Connection) -> None:
        self._revoke()

    def _revoke(self) -> None:
        if self._closing or self._lost:
            return
        self._lost = True
        self._application.state.recovery_ready = False
        try:
            result = self._ownership_lost_handler()
        except Exception:
            logger.exception("Agent recovery ownership-lost handler failed")
            return
        if inspect.isawaitable(result):
            self._handler_task = asyncio.ensure_future(result, loop=self._loop)
            self._handler_task.add_done_callback(self._log_handler_failure)

    @staticmethod
    def _log_handler_failure(task: asyncio.Future[None]) -> None:
        if task.cancelled():
            return
        try:
            task.result()
        except Exception:
            logger.exception("Agent recovery ownership-lost handler failed")

    async def drain_handler(self) -> None:
        """Wait for startup-time ownership-loss cleanup before propagating."""
        if self._handler_task is not None:
            await asyncio.shield(self._handler_task)

    def _holder_is_closed_or_detached(self) -> bool:
        try:
            return self._connection.is_closed()
        except (AttributeError, asyncpg.InterfaceError):
            return True

    async def close(self) -> None:
        self._application.state.recovery_ready = False
        self._closing = True
        try:
            self._connection.remove_termination_listener(self._on_termination)
        except (AttributeError, asyncpg.InterfaceError):
            pass
        if self._holder_is_closed_or_detached():
            return
        try:
            await self._connection.fetchval(
                "SELECT pg_advisory_unlock($1)", AGENT_RECOVERY_LOCK_KEY
            )
        except Exception:
            logger.exception("Failed to release Agent recovery ownership")


@asynccontextmanager
async def _agent_recovery_ownership(
    database_pool: asyncpg.Pool,
    application: FastAPI,
    ownership_lost_handler: OwnershipLostHandler,
):
    """Reserve one database session as the sole owner of Agent recovery."""
    if database_pool.get_max_size() < 2:
        raise RuntimeError(
            "Agent database pool max size must be at least 2 while recovery ownership is reserved"
        )
    async with database_pool.acquire() as connection:
        acquired = await connection.fetchval(
            "SELECT pg_try_advisory_lock($1)", AGENT_RECOVERY_LOCK_KEY
        )
        if not acquired:
            raise RuntimeError("another Agent instance already owns recovery")
        ownership = _AgentRecoveryOwnership(
            application, connection, ownership_lost_handler
        )
        application.state.recovery_ownership = ownership
        ownership.listen()
        try:
            yield ownership
        finally:
            await ownership.close()


def create_app(
    *,
    settings: AuthSettings | None = None,
    pool: asyncpg.Pool | None = None,
    ownership_lost_handler: OwnershipLostHandler | None = None,
) -> FastAPI:
    """Create an injectable application; production setup occurs only in lifespan."""

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        application.state.recovery_ready = False
        runtime_coordinator = SessionRuntimeCoordinator()
        application.state.runtime_coordinator = runtime_coordinator
        validate_model_configuration()
        configured = settings or AuthSettings.from_env()
        if configured.pool_max_size < 2:
            raise RuntimeError(
                "Agent database pool max size must be at least 2 while recovery ownership is reserved"
            )
        created_pool = pool is None
        database_pool = pool or await asyncpg.create_pool(
            configured.database_url,
            min_size=configured.pool_min_size,
            max_size=configured.pool_max_size,
            command_timeout=configured.command_timeout,
        )
        repository = HistoryRepository(database_pool)

        async def handle_ownership_loss() -> None:
            await runtime_coordinator.cancel_all()
            handler = (
                ownership_lost_handler
                if ownership_lost_handler is not None
                else _terminate_process_on_ownership_loss
            )
            result = handler()
            if inspect.isawaitable(result):
                await result

        try:
            async with _agent_recovery_ownership(
                database_pool,
                application,
                handle_ownership_loss,
            ) as ownership:
                await repository.ping()
                await repository.interrupt_open_turns()
                application.state.auth_settings = configured
                application.state.history_repository = repository
                application.state.history_service = HistoryService(
                    repository, runtime_coordinator.delete_barrier
                )
                try:
                    ownership.mark_ready()
                except RuntimeError:
                    await ownership.drain_handler()
                    raise
                yield
        finally:
            if created_pool:
                await database_pool.close()

    application = FastAPI(
        title="Agent TodoList - Agent Service", version="0.1.0", lifespan=lifespan
    )
    application.state.recovery_ready = False
    application.state.runtime_coordinator = SessionRuntimeCoordinator()
    application.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins) if settings else _cors_origins(),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Content-Type"],
    )

    @application.exception_handler(HTTPException)
    async def http_exception_handler(
        request: Request, exc: HTTPException
    ) -> JSONResponse:
        if isinstance(exc.detail, dict) and "code" in exc.detail:
            return JSONResponse(status_code=exc.status_code, content=exc.detail)
        return JSONResponse(
            status_code=exc.status_code,
            content={"code": exc.status_code, "message": str(exc.detail), "data": None},
        )

    @application.get("/api/agent/health")
    async def health(request: Request):
        if getattr(request.app.state, "recovery_ready", False) is not True:
            raise _err(50301, "Agent recovery ownership is unavailable", 503)
        repository = getattr(request.app.state, "history_repository", None)
        if repository is None:
            raise _err(50301, "Agent persistence is unavailable", 503)
        try:
            await repository.ping()
        except Exception as exc:
            raise _err(50301, "Agent persistence is unavailable", 503) from exc
        return {"status": "ok", "timestamp": _now_iso()}

    @application.get("/api/agent/sessions")
    async def list_sessions(
        principal: AuthPrincipal = Depends(get_current_principal),
        service: HistoryService = Depends(get_history_service),
    ):
        sessions = await service.list_sessions(principal.user_id)
        return _ok({"items": [_session_payload(session) for session in sessions]})

    @application.post("/api/agent/sessions", status_code=201)
    async def create_session(
        payload: SessionCreateRequest,
        principal: AuthPrincipal = Depends(get_current_principal),
        service: HistoryService = Depends(get_history_service),
    ):
        try:
            session = await service.create_session(
                principal.user_id, payload.title, payload.first_message
            )
        except ValueError as exc:
            raise _err(42201, str(exc), 422) from exc
        return _ok(_session_payload(session))

    @application.get("/api/agent/sessions/{session_id}")
    async def get_session(
        session_id: UUID,
        principal: AuthPrincipal = Depends(get_current_principal),
        service: HistoryService = Depends(get_history_service),
    ):
        detail = await service.get_session(principal.user_id, session_id)
        if detail is None:
            raise _err(40402, "会话不存在", 404)
        return _ok(_detail_payload(detail))

    @application.patch("/api/agent/sessions/{session_id}")
    async def rename_session(
        session_id: UUID,
        payload: SessionRenameRequest,
        principal: AuthPrincipal = Depends(get_current_principal),
        service: HistoryService = Depends(get_history_service),
    ):
        try:
            session = await service.rename_session(
                principal.user_id, session_id, payload.title
            )
        except ValueError as exc:
            raise _err(42201, str(exc), 422) from exc
        if session is None:
            raise _err(40402, "会话不存在", 404)
        return _ok(_session_payload(session))

    @application.delete("/api/agent/sessions/{session_id}")
    async def delete_session(
        session_id: UUID,
        principal: AuthPrincipal = Depends(get_current_principal),
        service: HistoryService = Depends(get_history_service),
    ):
        if not await service.delete_session(principal.user_id, session_id):
            raise _err(40402, "会话不存在", 404)
        return _ok({"deleted": True, "session_id": str(session_id)})

    @application.post("/api/agent/chat")
    async def chat(
        request: Request,
        req: ChatRequest,
        principal: AuthPrincipal = Depends(get_current_principal),
        service: HistoryService = Depends(get_history_service),
    ):
        if req.session_id:
            try:
                session_id = UUID(req.session_id)
            except ValueError as exc:
                raise _err(40402, "会话不存在", 404) from exc
            detail = await service.get_session(principal.user_id, session_id)
            if detail is None:
                raise _err(40402, "会话不存在", 404)
        else:
            session_id = (
                await service.create_session(
                    principal.user_id, first_message=req.message
                )
            ).id
            detail = await service.get_session(principal.user_id, session_id)
            if detail is None:
                raise _err(50004, "Agent history persistence failed", 500)
        repository = request.app.state.history_repository
        coordinator = request.app.state.runtime_coordinator
        try:
            result = await _execute_durable_message(
                repository,
                coordinator,
                principal.user_id,
                session_id,
                req.message,
                detail,
            )
            reply, actions, sid = result
        except HistoryPersistenceError as exc:
            logger.exception("Agent chat history persistence failed")
            raise _err(50004, "Agent history persistence failed", 500) from exc
        except Exception as exc:
            logger.exception("Agent chat failed")
            raise _err(50004, "Agent processing failed", 500) from exc
        return _ok({"reply": reply, "session_id": sid, "actions": actions})

    @application.get("/api/agent/history")
    async def history(
        session_id: UUID = Query(...),
        principal: AuthPrincipal = Depends(get_current_principal),
        service: HistoryService = Depends(get_history_service),
    ):
        detail = await service.get_session(principal.user_id, session_id)
        if detail is None:
            raise _err(40402, "会话不存在", 404)
        payload = _detail_payload(detail)
        messages = [
            message for turn in payload["turns"] for message in turn["messages"]
        ]
        return _ok({"session_id": str(session_id), "messages": messages})

    @application.delete("/api/agent/history")
    async def delete_history_endpoint(
        session_id: UUID = Query(...),
        principal: AuthPrincipal = Depends(get_current_principal),
        service: HistoryService = Depends(get_history_service),
    ):
        if not await service.delete_session(principal.user_id, session_id):
            raise _err(40402, "会话不存在", 404)
        return _ok({"deleted": True, "session_id": str(session_id)})

    @application.websocket("/api/agent/stream")
    async def stream(ws: WebSocket):
        if getattr(ws.app.state, "recovery_ready", False) is not True:
            await ws.close(code=1011)
            return
        settings_ = getattr(ws.app.state, "auth_settings", None)
        repository = getattr(ws.app.state, "history_repository", None)
        service = getattr(ws.app.state, "history_service", None)
        coordinator = getattr(ws.app.state, "runtime_coordinator", None)
        if (
            settings_ is None
            or repository is None
            or service is None
            or coordinator is None
        ):
            await ws.close(code=1011)
            return
        try:
            principal = await authenticate_websocket(ws, settings_, repository)
        except AuthDatabaseFailure:
            await ws.close(code=1011)
            return
        except AuthFailure as exc:
            await ws.close(code=4403 if exc.status_code == 403 else 4401)
            return

        query_session = ws.query_params.get("session_id")
        if not query_session:
            await ws.close(code=4403)
            return
        try:
            fixed_session_id = UUID(query_session)
        except ValueError:
            await ws.close(code=4403)
            return
        owned_detail = await service.get_session(principal.user_id, fixed_session_id)
        if owned_detail is None:
            await ws.close(code=4403)
            return
        await ws.accept()
        writer = _WebSocketWriter(ws)
        process_task: asyncio.Task[Any] | None = None
        receive_task: asyncio.Task[Any] | None = None
        try:
            raw = await ws.receive_text()
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                parsed = raw
            payload = parsed if isinstance(parsed, dict) else {"message": raw}
            if "session_id" in payload:
                try:
                    requested_session = UUID(payload["session_id"])
                except (AttributeError, TypeError, ValueError):
                    await ws.close(code=4403)
                    return
                if requested_session != fixed_session_id:
                    await ws.close(code=4403)
                    return
            request = (
                RetryStepRequest.model_validate(payload)
                if payload.get("type") == "retry_step"
                else ChatRequest.model_validate(payload)
            )
            session_id = str(fixed_session_id)
        except WebSocketDisconnect:
            return
        except (ValidationError, TypeError, ValueError):
            await writer.send_json(
                _protocol_failure_event(
                    "request", "INVALID_CLIENT_EVENT", "invalid request"
                )
            )
            await ws.close(code=1008)
            return

        if isinstance(request, RetryStepRequest):
            retry_lease: SessionRuntimeLease | None = None
            retry_current = asyncio.current_task()
            retry_persistence: RepositoryTurnPersistence | None = None
            retry_attached = False
            try:
                retry_lease = await coordinator.acquire(
                    principal.user_id, fixed_session_id
                )
                assert retry_current is not None
                await coordinator.attach(retry_lease, retry_current)
                retry_attached = True
                retry_persistence = RepositoryTurnPersistence(
                    repository, coordinator, retry_lease
                )
                retry_kwargs: dict[str, Any] = {}
                if "owner_id" in inspect.signature(retry_failed_step).parameters:
                    retry_kwargs = {
                        "owner_id": str(principal.user_id),
                        "runtime_generation": retry_lease.generation,
                    }
                durable_retry = (
                    "persistence" in inspect.signature(retry_failed_step).parameters
                )
                if durable_retry:
                    retry_kwargs["persistence"] = retry_persistence
                await retry_failed_step(
                    session_id,
                    request.step_id,
                    request.retry_token,
                    writer.send_json,
                    **retry_kwargs,
                )
                await _finish_successful_stream(writer, ws)
            except InvalidRetryStep:
                await writer.send_json(
                    _protocol_failure_event(
                        request.step_id, "INVALID_RETRY_STEP", "invalid retry step"
                    )
                )
                await ws.close(code=1008)
            except TransportDeliveryError:
                with suppress(RuntimeError, WebSocketDisconnect):
                    await ws.close(code=1011)
            except HistoryPersistenceError as exc:
                discard_retry_attempt(request.retry_token)
                if retry_persistence is not None:
                    with suppress(Exception):
                        await retry_persistence.fail(
                            "HISTORY_PERSISTENCE_FAILED",
                            str(exc),
                            uncertain=exc.uncertain or retry_persistence.uncertain,
                        )
                await writer.send_json(_history_failure_event())
                await ws.close(code=1011)
            except Exception as exc:
                discard_retry_attempt(request.retry_token)
                if retry_persistence is not None and not getattr(
                    exc, "event_emitted", False
                ):
                    with suppress(Exception):
                        await retry_persistence.fail(
                            getattr(exc, "phase", "AGENT_ERROR"),
                            str(exc),
                            uncertain=retry_persistence.uncertain,
                        )
                if not getattr(exc, "event_emitted", False):
                    await writer.send_json(
                        _protocol_failure_event(
                            request.step_id,
                            "AGENT_ERROR",
                            "Agent processing failed",
                        )
                    )
                await ws.close(code=1011)
            finally:
                if retry_lease is not None and retry_current is not None:
                    try:
                        if retry_attached:
                            await coordinator.detach(retry_lease, retry_current)
                    finally:
                        await coordinator.release(retry_lease)
            return

        try:
            lease = await coordinator.acquire(principal.user_id, fixed_session_id)
        except HistoryPersistenceError:
            await writer.send_json(_history_failure_event())
            await ws.close(code=1011)
            return

        async def send_reply(result: ProcessResult) -> None:
            reply = result.reply if isinstance(result, ProcessResult) else result[0]
            await writer.send_json({"type": "reply", "content": reply})

        execution = _execute_durable_message(
            repository,
            coordinator,
            principal.user_id,
            fixed_session_id,
            request.message,
            owned_detail,
            on_event=writer.send_json,
            on_terminal=send_reply,
            lease=lease,
        )
        try:
            process_task = asyncio.create_task(execution)
        except BaseException:
            execution.close()
            await coordinator.release(lease)
            raise
        receive_task = asyncio.create_task(ws.receive_json())
        try:
            while True:
                completed, _ = await asyncio.wait(
                    {process_task, receive_task}, return_when=asyncio.FIRST_COMPLETED
                )
                if process_task in completed:
                    await _cancel_and_drain(receive_task)
                    receive_task = None
                    process_task.result()
                    await _finish_successful_stream(writer, ws)
                    return
                assert receive_task is not None
                try:
                    control = ConfirmationResponse.model_validate(receive_task.result())
                except ValidationError:
                    await writer.send_json(
                        _protocol_failure_event(
                            "confirmation",
                            "INVALID_CLIENT_EVENT",
                            "invalid confirmation",
                        )
                    )
                else:
                    if not resolve_confirmation(
                        session_id,
                        control.confirmation_id,
                        control.approved,
                        owner_id=str(principal.user_id),
                        runtime_generation=lease.generation,
                    ):
                        await writer.send_json(
                            _protocol_failure_event(
                                "confirmation",
                                "INVALID_CONFIRMATION",
                                "confirmation is invalid",
                            )
                        )
                receive_task = asyncio.create_task(ws.receive_json())
        except WebSocketDisconnect:
            await _cancel_and_fully_drain(process_task)
        except TransportDeliveryError:
            with suppress(RuntimeError, WebSocketDisconnect):
                await ws.close(code=1011)
        except TerminalAlreadySentError:
            with suppress(RuntimeError, WebSocketDisconnect):
                await ws.close(code=1011)
        except HistoryPersistenceError:
            logger.exception("Agent history persistence failed")
            with suppress(RuntimeError, WebSocketDisconnect):
                await writer.send_json(_history_failure_event())
                await ws.close(code=1011)
        except Exception as exc:
            logger.exception("Agent streaming failed")
            await _cancel_and_fully_drain(process_task)
            with suppress(RuntimeError, WebSocketDisconnect):
                if not getattr(exc, "event_emitted", False):
                    await writer.send_json(
                        _protocol_failure_event(
                            getattr(exc, "phase", "agent"),
                            "AGENT_ERROR",
                            "Agent processing failed",
                        )
                    )
                await writer.send_json({"type": "done"})
                await ws.close(code=1011)
        finally:
            await _cancel_and_drain(receive_task)

    return application


app = create_app()


async def stream(ws: Any) -> None:
    """Legacy in-process stream harness retained for unit-testing Agent journaling.

    It is deliberately not mounted as an ASGI route. Browser traffic always
    goes through the authenticated endpoint created by :func:`create_app`.
    """
    await ws.accept()
    writer = _WebSocketWriter(ws)
    process_task: asyncio.Task[Any] | None = None
    receive_task: asyncio.Task[Any] | None = None
    try:
        raw = await ws.receive_text()
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = raw
        payload = parsed if isinstance(parsed, dict) else {"message": raw}
        request = (
            RetryStepRequest.model_validate(payload)
            if payload.get("type") == "retry_step"
            else ChatRequest.model_validate(payload)
        )
    except (WebSocketDisconnect, ValidationError, TypeError, ValueError):
        return
    if isinstance(request, RetryStepRequest):
        try:
            await retry_failed_step(
                request.session_id,
                request.step_id,
                request.retry_token,
                writer.send_json,
            )
            await writer.send_json({"type": "done"})
        except Exception:
            pass
        return
    session_id = request.session_id or str(uuid.uuid4())
    process_task = asyncio.create_task(
        process_message(session_id, request.message, on_event=writer.send_json)
    )
    receive_task = asyncio.create_task(ws.receive_json())
    try:
        while True:
            completed, _ = await asyncio.wait(
                {process_task, receive_task}, return_when=asyncio.FIRST_COMPLETED
            )
            if process_task in completed:
                await _cancel_and_drain(receive_task)
                receive_task = None
                result = process_task.result()
                reply, _actions, _sid = result
                try:
                    await writer.send_json({"type": "reply", "content": reply})
                except Exception:
                    return
                if isinstance(result, ProcessResult):
                    try:
                        if not await complete_turn(
                            session_id, result.turn_id, result.generation
                        ):
                            return
                    except Exception:
                        return
                try:
                    await writer.send_json({"type": "done"})
                except Exception:
                    return
                with suppress(Exception):
                    await ws.close()
                return
            assert receive_task is not None
            try:
                control = ConfirmationResponse.model_validate(receive_task.result())
                if not resolve_confirmation(
                    session_id, control.confirmation_id, control.approved
                ):
                    await writer.send_json(
                        _protocol_failure_event(
                            "confirmation",
                            "INVALID_CONFIRMATION",
                            "confirmation is invalid",
                        )
                    )
            except ValidationError:
                await writer.send_json(
                    _protocol_failure_event(
                        "confirmation",
                        "INVALID_CLIENT_EVENT",
                        "invalid confirmation",
                    )
                )
            receive_task = asyncio.create_task(ws.receive_json())
    except WebSocketDisconnect:
        await _cancel_and_drain(process_task)
    except Exception as exc:
        await _cancel_and_drain(process_task)
        with suppress(Exception):
            if not getattr(exc, "event_emitted", False):
                await writer.send_json(
                    _protocol_failure_event(
                        getattr(exc, "phase", "agent"), "AGENT_ERROR", str(exc)
                    )
                )
            await writer.send_json({"type": "done"})
            await ws.close(code=1011)
    finally:
        await _cancel_and_drain(receive_task)
        await _cancel_and_drain(process_task)
