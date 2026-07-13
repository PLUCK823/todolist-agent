"""FastAPI application — REST + WebSocket endpoints for the Agent service."""

from __future__ import annotations

import json
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .agent import delete_history, get_history, process_message

logger = logging.getLogger(__name__)

app = FastAPI(title="Agent TodoList - Agent Service", version="0.1.0")


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


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1)
    session_id: Optional[str] = None


class ToolAction(BaseModel):
    type: str
    result: Optional[dict] = None
    error: Optional[str] = None


class ChatData(BaseModel):
    reply: str
    session_id: str
    actions: list[dict] = []


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
        serialized.append({
            "role": getattr(m, "type", "unknown"),
            "content": getattr(m, "content", ""),
        })

    return _ok({"session_id": session_id, "messages": serialized})


@app.delete("/api/agent/history")
async def delete_history_endpoint(session_id: str = Query(..., min_length=1)):
    """Delete a conversation session."""
    existed = delete_history(session_id)
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

    try:
        raw = await ws.receive_text()
    except WebSocketDisconnect:
        return

    # Parse the message (could be plain text or JSON)
    try:
        body = json.loads(raw)
        message = body.get("message", raw)
        session_id = body.get("session_id")
    except (json.JSONDecodeError, TypeError):
        message = raw
        session_id = None

    # ---- Step: understand ----
    understand_id = "understand"
    started = _now_iso()
    await ws.send_json({
        "type": "step_started",
        "step_id": understand_id,
        "label": "理解请求",
        "started_at": started,
    })

    t0 = time.monotonic()
    try:
        reply, actions, sid = await process_message(session_id, message)
    except Exception as exc:
        logger.exception("Agent streaming failed")
        duration_ms = int((time.monotonic() - t0) * 1000)
        await ws.send_json({
            "type": "step_failed",
            "step_id": understand_id,
            "error_code": "AGENT_ERROR",
            "message": str(exc),
            "retryable": False,
            "duration_ms": duration_ms,
        })
        await ws.send_json({"type": "done"})
        await ws.close()
        return

    duration_ms = int((time.monotonic() - t0) * 1000)
    await ws.send_json({
        "type": "step_completed",
        "step_id": understand_id,
        "duration_ms": duration_ms,
    })

    # ---- Steps: tool executions ----
    for action in actions:
        tool_name = action.get("type", "unknown")
        step_id = f"{tool_name}_{uuid.uuid4().hex[:8]}"

        await ws.send_json({
            "type": "step_started",
            "step_id": step_id,
            "label": "调用 Todo API",
            "tool": tool_name,
            "args": action.get("args", {}),
        })

        if "error" in action:
            await ws.send_json({
                "type": "step_failed",
                "step_id": step_id,
                "error_code": "TOOL_ERROR",
                "message": action["error"],
                "retryable": True,
                "duration_ms": 0,
            })
        else:
            await ws.send_json({
                "type": "action_completed",
                "step_id": step_id,
                "action": tool_name,
                "result": action.get("result", {}),
                "duration_ms": 0,
            })

    # ---- Reply ----
    await ws.send_json({"type": "reply", "content": reply})

    # ---- Done ----
    await ws.send_json({"type": "done"})
    await ws.close()
