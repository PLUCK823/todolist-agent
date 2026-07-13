"""FastAPI application — REST + WebSocket endpoints for the Agent service."""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from contextlib import suppress
from datetime import datetime, timezone
from typing import Optional

from fastapi import (
    FastAPI,
    HTTPException,
    Query,
    Request,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, ValidationError

from .agent import (
    ProcessResult,
    complete_turn,
    delete_history,
    get_history,
    process_message,
    resolve_confirmation,
)
from .schemas import ChatRequest, ConfirmationResponse

logger = logging.getLogger(__name__)

app = FastAPI(title="Agent TodoList - Agent Service", version="0.1.0")


class _WebSocketWriter:
    """Single ordered write boundary shared by endpoint and Agent sink."""

    def __init__(self, ws: WebSocket):
        self._ws = ws
        self._lock = asyncio.Lock()

    async def send_json(self, event: dict) -> None:
        async with self._lock:
            await self._ws.send_json(event)


async def _cancel_and_drain(task: asyncio.Task, timeout: float = 0.1) -> None:
    """Cancel a task and consume its result without unbounded cleanup waits."""
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


# ---------------------------------------------------------------------------
# Exception handler — makes HTTPException details the response body
# ---------------------------------------------------------------------------


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    if isinstance(exc.detail, dict) and "code" in exc.detail:
        return JSONResponse(status_code=exc.status_code, content=exc.detail)
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": exc.status_code, "message": str(exc.detail), "data": None},
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class ToolAction(BaseModel):
    type: str
    result: Optional[dict] = None
    error: Optional[str] = None


class ChatData(BaseModel):
    reply: str
    session_id: str
    actions: list[dict] = Field(default_factory=list)


class ApiResponse(BaseModel):
    code: int = 0
    message: str = "ok"
    data: Optional[object] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _ok(data: object = None) -> dict:
    return {"code": 0, "message": "ok", "data": data}


def _err(code: int, message: str, status: int = 400) -> HTTPException:
    return HTTPException(
        status_code=status,
        detail={"code": code, "message": message, "data": None},
    )


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# REST endpoints
# ---------------------------------------------------------------------------


@app.get("/api/agent/health")
async def health():
    return {"status": "ok", "timestamp": _now_iso()}


@app.post("/api/agent/chat")
async def chat(req: ChatRequest):
    """Process a natural-language message and return the agent's reply."""
    try:
        reply, actions, sid = await process_message(req.session_id, req.message)
    except Exception as exc:
        logger.exception("Agent chat failed")
        raise _err(50004, f"Agent 处理失败: {exc}", 500)

    return _ok(ChatData(reply=reply, session_id=sid, actions=actions).model_dump())


@app.get("/api/agent/history")
async def history(session_id: str = Query(..., min_length=1)):
    """Return the conversation history for a session."""
    conv = get_history(session_id)
    if conv is None:
        raise _err(40402, "会话不存在", 404)

    # Serialize messages to JSON-friendly dicts
    serialized = []
    for m in conv.get("messages", []):
        serialized.append(
            {
                "role": getattr(m, "type", "unknown"),
                "content": getattr(m, "content", ""),
            }
        )

    return _ok({"session_id": session_id, "messages": serialized})


@app.delete("/api/agent/history")
async def delete_history_endpoint(session_id: str = Query(..., min_length=1)):
    """Delete a conversation session."""
    existed = await delete_history(session_id)
    if not existed:
        raise _err(40402, "会话不存在", 404)
    return _ok({"deleted": True, "session_id": session_id})


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------


@app.websocket("/api/agent/stream")
async def stream(ws: WebSocket):
    """Stream agent processing steps over WebSocket.

    Events emitted (in order):
        step_started (understand) -> step_completed (understand) ->
        [step_started (tool) -> action_completed | step_failed]* ->
        reply* -> done
    """
    await ws.accept()
    writer = _WebSocketWriter(ws)

    try:
        raw = await ws.receive_text()
    except WebSocketDisconnect:
        return

    try:
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = raw
        payload = parsed if isinstance(parsed, dict) else {"message": raw}
        request = ChatRequest.model_validate(payload)
    except (ValidationError, TypeError, ValueError) as exc:
        await writer.send_json(
            {
                "type": "step_failed",
                "step_id": "request",
                "error_code": "INVALID_CLIENT_EVENT",
                "message": str(exc),
                "retryable": False,
                "duration_ms": 0,
            }
        )
        await writer.send_json({"type": "done"})
        await ws.close(code=1008)
        return

    # Fix the ID before processing so confirmation tokens can be bound to the
    # connection's session while process_message is still awaiting approval.
    session_id = request.session_id or str(uuid.uuid4())
    process_task = asyncio.create_task(
        process_message(session_id, request.message, on_event=writer.send_json)
    )
    receive_task: asyncio.Task[dict] | None = asyncio.create_task(ws.receive_json())

    try:
        while True:
            wait_for = {process_task}
            if receive_task is not None:
                wait_for.add(receive_task)
            completed, _ = await asyncio.wait(
                wait_for, return_when=asyncio.FIRST_COMPLETED
            )

            if process_task in completed:
                if receive_task is not None:
                    await _cancel_and_drain(receive_task)
                    receive_task = None
                result = process_task.result()
                reply, _actions, _sid = result
                await writer.send_json({"type": "reply", "content": reply})
                if isinstance(result, ProcessResult):
                    acknowledged = await complete_turn(
                        session_id, result.turn_id, result.generation
                    )
                    if not acknowledged:
                        raise RuntimeError(
                            "final reply acknowledgement lost a session race"
                        )
                await writer.send_json({"type": "done"})
                await ws.close()
                return

            assert receive_task is not None
            try:
                control = ConfirmationResponse.model_validate(receive_task.result())
            except ValidationError as exc:
                await writer.send_json(
                    {
                        "type": "step_failed",
                        "step_id": "confirmation",
                        "error_code": "INVALID_CLIENT_EVENT",
                        "message": str(exc),
                        "retryable": False,
                        "duration_ms": 0,
                    }
                )
            else:
                if not resolve_confirmation(
                    session_id, control.confirmation_id, control.approved
                ):
                    await writer.send_json(
                        {
                            "type": "step_failed",
                            "step_id": "confirmation",
                            "error_code": "INVALID_CONFIRMATION",
                            "message": "确认请求不存在、已使用或不属于当前会话",
                            "retryable": False,
                            "duration_ms": 0,
                        }
                    )
            receive_task = asyncio.create_task(ws.receive_json())
    except WebSocketDisconnect:
        await _cancel_and_drain(process_task)
    except Exception as exc:
        logger.exception("Agent streaming failed")
        if not process_task.done():
            await _cancel_and_drain(process_task)
        with suppress(RuntimeError, WebSocketDisconnect):
            if not getattr(exc, "event_emitted", False):
                await writer.send_json(
                    {
                        "type": "step_failed",
                        "step_id": getattr(exc, "phase", "agent"),
                        "error_code": "AGENT_ERROR",
                        "message": str(exc),
                        "retryable": False,
                        "duration_ms": 0,
                    }
                )
            await writer.send_json({"type": "done"})
            await ws.close(code=1011)
    finally:
        if receive_task is not None and not receive_task.done():
            await _cancel_and_drain(receive_task)
        if not process_task.done():
            await _cancel_and_drain(process_task)
