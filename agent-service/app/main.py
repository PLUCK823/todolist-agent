"""Authenticated REST and WebSocket boundary for the Agent service."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from contextlib import asynccontextmanager, suppress
from dataclasses import asdict
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

import asyncpg
from fastapi import Depends, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from .agent import (
    AgentExecutionError,
    InvalidRetryStep,
    ProcessResult,
    complete_turn,
    delete_history,
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
from .history_models import SessionDetail, SessionSummary
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


def _cors_origins() -> list[str]:
    """Read a harmless import-time CORS default; auth config validates at startup."""
    origins = [item.strip() for item in os.getenv("AUTH_ALLOWED_ORIGINS", "http://localhost:3000").split(",") if item.strip()]
    return [origin for origin in origins if origin != "*"] or ["http://localhost:3000"]


def _ok(data: object = None) -> dict[str, object]:
    return {"code": 0, "message": "ok", "data": data}


def _err(code: int, message: str, status: int = 400) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message, "data": None})


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _session_payload(session: SessionSummary) -> dict[str, object]:
    return {
        "id": str(session.id), "title": session.title,
        "created_at": session.created_at.isoformat(), "updated_at": session.updated_at.isoformat(),
        "last_message_at": session.last_message_at.isoformat(),
    }


def _detail_payload(detail: SessionDetail | dict[str, Any]) -> dict[str, object]:
    if isinstance(detail, dict):
        session = detail["session"]
        return {"session": _session_payload(session), "turns": detail.get("turns", [])}
    turns: list[dict[str, object]] = []
    for turn in detail.turns:
        turns.append({
            "id": str(turn.id), "ordinal": turn.ordinal, "status": turn.status,
            "started_at": turn.started_at.isoformat(),
            "completed_at": turn.completed_at.isoformat() if turn.completed_at else None,
            "failure_code": turn.failure_code, "failure_message": turn.failure_message,
            "result_uncertain": turn.result_uncertain,
            "messages": [{
                "id": str(message.id), "role": message.role, "content": message.content,
                "ordinal": message.ordinal, "created_at": message.created_at.isoformat(),
            } for message in turn.messages],
            "steps": [{
                "id": str(step.id), "event_id": str(step.event_id), "ordinal": step.ordinal,
                "label": step.label, "tool": step.tool, "status": step.status, "args": step.args,
                "result": step.result, "result_preview": step.result_preview,
                "result_truncated": step.result_truncated, "duration_ms": step.duration_ms,
                "error_code": step.error_code, "error_message": step.error_message,
                "retryable": step.retryable, "confirmation_id": step.confirmation_id,
                "confirmation_message": step.confirmation_message,
                "confirmation_approved": step.confirmation_approved,
                "started_at": step.started_at.isoformat(),
                "completed_at": step.completed_at.isoformat() if step.completed_at else None,
            } for step in turn.steps],
        })
    return {"session": _session_payload(detail), "turns": turns}


async def get_history_service(request: Request) -> HistoryService:
    service = getattr(request.app.state, "history_service", None)
    if service is None:
        raise _err(50301, "Agent persistence is unavailable", 503)
    return service


async def get_current_principal(request: Request) -> AuthPrincipal:
    settings = getattr(request.app.state, "auth_settings", None)
    repository = getattr(request.app.state, "history_repository", None)
    if settings is None or repository is None:
        raise _err(50301, "Agent authentication is unavailable", 503)
    try:
        return await authenticate_request(request, settings, repository)
    except AuthDatabaseFailure as exc:
        raise _err(50301, "Agent authentication is unavailable", 503) from exc
    except AuthFailure as exc:
        raise _err(40301 if exc.status_code == 403 else 40101, str(exc), exc.status_code) from exc


class _WebSocketWriter:
    def __init__(self, ws: WebSocket):
        self._ws = ws
        self._lock = asyncio.Lock()

    async def send_json(self, event: dict[str, Any]) -> None:
        async with self._lock:
            await self._ws.send_json(event)


async def _cancel_and_drain(task: asyncio.Task[Any] | None, timeout: float = 0.1) -> None:
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
        task.add_done_callback(lambda finished: finished.exception() if not finished.cancelled() else None)


def create_app(*, settings: AuthSettings | None = None, pool: asyncpg.Pool | None = None) -> FastAPI:
    """Create an injectable application; production setup occurs only in lifespan."""

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        validate_model_configuration()
        configured = settings or AuthSettings.from_env()
        created_pool = pool is None
        database_pool = pool or await asyncpg.create_pool(
            configured.database_url, min_size=configured.pool_min_size,
            max_size=configured.pool_max_size, command_timeout=configured.command_timeout,
        )
        repository = HistoryRepository(database_pool)
        try:
            await repository.ping()
            await repository.interrupt_open_turns()
            application.state.auth_settings = configured
            application.state.history_repository = repository
            application.state.history_service = HistoryService(repository, delete_history)
            yield
        finally:
            if created_pool:
                await database_pool.close()

    application = FastAPI(title="Agent TodoList - Agent Service", version="0.1.0", lifespan=lifespan)
    application.add_middleware(
        CORSMiddleware, allow_origins=list(settings.allowed_origins) if settings else _cors_origins(),
        allow_credentials=True, allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Content-Type"],
    )

    @application.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
        if isinstance(exc.detail, dict) and "code" in exc.detail:
            return JSONResponse(status_code=exc.status_code, content=exc.detail)
        return JSONResponse(status_code=exc.status_code, content={"code": exc.status_code, "message": str(exc.detail), "data": None})

    @application.get("/api/agent/health")
    async def health(request: Request):
        repository = getattr(request.app.state, "history_repository", None)
        if repository is None:
            raise _err(50301, "Agent persistence is unavailable", 503)
        try:
            await repository.ping()
        except Exception as exc:
            raise _err(50301, "Agent persistence is unavailable", 503) from exc
        return {"status": "ok", "timestamp": _now_iso()}

    @application.get("/api/agent/sessions")
    async def list_sessions(principal: AuthPrincipal = Depends(get_current_principal), service: HistoryService = Depends(get_history_service)):
        sessions = await service.list_sessions(principal.user_id)
        return _ok({"items": [_session_payload(session) for session in sessions]})

    @application.post("/api/agent/sessions", status_code=201)
    async def create_session(payload: SessionCreateRequest, principal: AuthPrincipal = Depends(get_current_principal), service: HistoryService = Depends(get_history_service)):
        try:
            session = await service.create_session(principal.user_id, payload.title, payload.first_message)
        except ValueError as exc:
            raise _err(42201, str(exc), 422) from exc
        return _ok(_session_payload(session))

    @application.get("/api/agent/sessions/{session_id}")
    async def get_session(session_id: UUID, principal: AuthPrincipal = Depends(get_current_principal), service: HistoryService = Depends(get_history_service)):
        detail = await service.get_session(principal.user_id, session_id)
        if detail is None:
            raise _err(40402, "会话不存在", 404)
        return _ok(_detail_payload(detail))

    @application.patch("/api/agent/sessions/{session_id}")
    async def rename_session(session_id: UUID, payload: SessionRenameRequest, principal: AuthPrincipal = Depends(get_current_principal), service: HistoryService = Depends(get_history_service)):
        try:
            session = await service.rename_session(principal.user_id, session_id, payload.title)
        except ValueError as exc:
            raise _err(42201, str(exc), 422) from exc
        if session is None:
            raise _err(40402, "会话不存在", 404)
        return _ok(_session_payload(session))

    @application.delete("/api/agent/sessions/{session_id}")
    async def delete_session(session_id: UUID, principal: AuthPrincipal = Depends(get_current_principal), service: HistoryService = Depends(get_history_service)):
        if not await service.delete_session(principal.user_id, session_id):
            raise _err(40402, "会话不存在", 404)
        return _ok({"deleted": True, "session_id": str(session_id)})

    @application.post("/api/agent/chat")
    async def chat(req: ChatRequest, principal: AuthPrincipal = Depends(get_current_principal), service: HistoryService = Depends(get_history_service)):
        if req.session_id:
            try:
                session_id = UUID(req.session_id)
            except ValueError as exc:
                raise _err(40402, "会话不存在", 404) from exc
            if await service.get_session(principal.user_id, session_id) is None:
                raise _err(40402, "会话不存在", 404)
        else:
            session_id = (await service.create_session(principal.user_id, first_message=req.message)).id
        try:
            reply, actions, sid = await process_message(str(session_id), req.message)
        except Exception as exc:
            logger.exception("Agent chat failed")
            raise _err(50004, "Agent processing failed", 500) from exc
        return _ok({"reply": reply, "session_id": sid, "actions": actions})

    @application.get("/api/agent/history")
    async def history(session_id: UUID = Query(...), principal: AuthPrincipal = Depends(get_current_principal), service: HistoryService = Depends(get_history_service)):
        detail = await service.get_session(principal.user_id, session_id)
        if detail is None:
            raise _err(40402, "会话不存在", 404)
        payload = _detail_payload(detail)
        messages = [message for turn in payload["turns"] for message in turn["messages"]]
        return _ok({"session_id": str(session_id), "messages": messages})

    @application.delete("/api/agent/history")
    async def delete_history_endpoint(session_id: UUID = Query(...), principal: AuthPrincipal = Depends(get_current_principal), service: HistoryService = Depends(get_history_service)):
        if not await service.delete_session(principal.user_id, session_id):
            raise _err(40402, "会话不存在", 404)
        return _ok({"deleted": True, "session_id": str(session_id)})

    @application.websocket("/api/agent/stream")
    async def stream(ws: WebSocket):
        settings_ = getattr(ws.app.state, "auth_settings", None)
        repository = getattr(ws.app.state, "history_repository", None)
        service = getattr(ws.app.state, "history_service", None)
        if settings_ is None or repository is None or service is None:
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
        fixed_session_id: UUID | None = None
        if query_session:
            try:
                fixed_session_id = UUID(query_session)
            except ValueError:
                await ws.close(code=4403)
                return
            if await service.get_session(principal.user_id, fixed_session_id) is None:
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
            request = RetryStepRequest.model_validate(payload) if payload.get("type") == "retry_step" else ChatRequest.model_validate(payload)
            if request.session_id:
                try:
                    requested_session = UUID(request.session_id)
                except ValueError:
                    await ws.close(code=4403)
                    return
                if fixed_session_id and requested_session != fixed_session_id:
                    await ws.close(code=4403)
                    return
                if await service.get_session(principal.user_id, requested_session) is None:
                    await ws.close(code=4403)
                    return
                fixed_session_id = requested_session
            elif fixed_session_id is None:
                fixed_session_id = (await service.create_session(principal.user_id, first_message=getattr(request, "message", None))).id
            session_id = str(fixed_session_id)
        except WebSocketDisconnect:
            return
        except (ValidationError, TypeError, ValueError) as exc:
            await writer.send_json({"type": "step_failed", "step_id": "request", "error_code": "INVALID_CLIENT_EVENT", "message": "invalid request", "retryable": False, "duration_ms": 0})
            await writer.send_json({"type": "done"})
            await ws.close(code=1008)
            return

        if isinstance(request, RetryStepRequest):
            try:
                await retry_failed_step(session_id, request.step_id, request.retry_token, writer.send_json)
                await writer.send_json({"type": "done"})
                await ws.close()
            except InvalidRetryStep:
                await writer.send_json({"type": "step_failed", "step_id": request.step_id, "error_code": "INVALID_RETRY_STEP", "message": "invalid retry step", "retryable": False, "duration_ms": 0})
                await writer.send_json({"type": "done"})
                await ws.close(code=1008)
            return

        process_task = asyncio.create_task(process_message(session_id, request.message, on_event=writer.send_json))
        receive_task = asyncio.create_task(ws.receive_json())
        try:
            while True:
                completed, _ = await asyncio.wait({process_task, receive_task}, return_when=asyncio.FIRST_COMPLETED)
                if process_task in completed:
                    await _cancel_and_drain(receive_task)
                    receive_task = None
                    result = process_task.result()
                    reply, _actions, _sid = result
                    await writer.send_json({"type": "reply", "content": reply})
                    if isinstance(result, ProcessResult):
                        acknowledged = await complete_turn(session_id, result.turn_id, result.generation)
                        if not acknowledged:
                            await ws.close(code=1011)
                            return
                    await writer.send_json({"type": "done"})
                    await ws.close()
                    return
                assert receive_task is not None
                try:
                    control = ConfirmationResponse.model_validate(receive_task.result())
                except ValidationError:
                    await writer.send_json({"type": "step_failed", "step_id": "confirmation", "error_code": "INVALID_CLIENT_EVENT", "message": "invalid confirmation", "retryable": False, "duration_ms": 0})
                else:
                    if not resolve_confirmation(session_id, control.confirmation_id, control.approved):
                        await writer.send_json({"type": "step_failed", "step_id": "confirmation", "error_code": "INVALID_CONFIRMATION", "message": "confirmation is invalid", "retryable": False, "duration_ms": 0})
                receive_task = asyncio.create_task(ws.receive_json())
        except WebSocketDisconnect:
            await _cancel_and_drain(process_task)
        except Exception as exc:
            logger.exception("Agent streaming failed")
            await _cancel_and_drain(process_task)
            with suppress(RuntimeError, WebSocketDisconnect):
                await writer.send_json({"type": "step_failed", "step_id": getattr(exc, "phase", "agent"), "error_code": "AGENT_ERROR", "message": "Agent processing failed", "retryable": False, "duration_ms": 0})
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
        request = RetryStepRequest.model_validate(payload) if payload.get("type") == "retry_step" else ChatRequest.model_validate(payload)
    except (WebSocketDisconnect, ValidationError, TypeError, ValueError):
        return
    if isinstance(request, RetryStepRequest):
        try:
            await retry_failed_step(request.session_id, request.step_id, request.retry_token, writer.send_json)
            await writer.send_json({"type": "done"})
        except Exception:
            pass
        return
    session_id = request.session_id or str(uuid.uuid4())
    process_task = asyncio.create_task(process_message(session_id, request.message, on_event=writer.send_json))
    receive_task = asyncio.create_task(ws.receive_json())
    try:
        while True:
            completed, _ = await asyncio.wait({process_task, receive_task}, return_when=asyncio.FIRST_COMPLETED)
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
                        if not await complete_turn(session_id, result.turn_id, result.generation):
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
                if not resolve_confirmation(session_id, control.confirmation_id, control.approved):
                    await writer.send_json({"type": "step_failed", "step_id": "confirmation", "error_code": "INVALID_CONFIRMATION", "message": "confirmation is invalid", "retryable": False, "duration_ms": 0})
            except ValidationError:
                await writer.send_json({"type": "step_failed", "step_id": "confirmation", "error_code": "INVALID_CLIENT_EVENT", "message": "invalid confirmation", "retryable": False, "duration_ms": 0})
            receive_task = asyncio.create_task(ws.receive_json())
    except WebSocketDisconnect:
        await _cancel_and_drain(process_task)
    except Exception as exc:
        await _cancel_and_drain(process_task)
        with suppress(Exception):
            if not getattr(exc, "event_emitted", False):
                await writer.send_json({"type": "step_failed", "step_id": getattr(exc, "phase", "agent"), "error_code": "AGENT_ERROR", "message": str(exc), "retryable": False, "duration_ms": 0})
            await writer.send_json({"type": "done"})
            await ws.close(code=1011)
    finally:
        await _cancel_and_drain(receive_task)
        await _cancel_and_drain(process_task)
