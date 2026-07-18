"""Business-level ownership and title rules for durable Agent sessions."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any
from uuid import UUID

from .history_models import SessionDetail, SessionSummary
from .history_repository import DEFAULT_SESSION_TITLE, HistoryRepository


DeleteHistoryCallback = Callable[[str], Awaitable[bool]]


def title_from_first_message(message: str) -> str:
    return " ".join(message.split())[:48]


class HistoryService:
    def __init__(self, repository: HistoryRepository, delete_history_callback: DeleteHistoryCallback):
        self._repository = repository
        self._delete_history_callback = delete_history_callback

    async def list_sessions(self, owner_id: UUID) -> list[SessionSummary]:
        return await self._repository.list_sessions(owner_id)

    async def create_session(
        self, owner_id: UUID, title: str | None = None, first_message: str | None = None
    ) -> SessionSummary:
        chosen = title.strip() if title is not None else ""
        if not chosen and first_message:
            chosen = title_from_first_message(first_message)
        return await self._repository.create_session(owner_id, chosen or DEFAULT_SESSION_TITLE)

    async def get_session(self, owner_id: UUID, session_id: UUID) -> SessionDetail | None:
        return await self._repository.get_session(owner_id, session_id)

    async def rename_session(self, owner_id: UUID, session_id: UUID, title: str) -> SessionSummary | None:
        return await self._repository.rename_session(owner_id, session_id, title)

    async def delete_session(self, owner_id: UUID, session_id: UUID) -> bool:
        deleted = await self._repository.delete_session(owner_id, session_id)
        if deleted:
            await self._delete_history_callback(str(session_id))
        return deleted
