"""Shared model-provider interfaces and safe failures."""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

from langchain_core.language_models.chat_models import BaseChatModel

if TYPE_CHECKING:
    from .config import ModelConfig


class ModelConfigurationError(RuntimeError):
    """An operator-actionable model configuration failure without secrets."""


class ProviderAdapter(Protocol):
    """Construct a LangChain chat model for one configured provider."""

    name: str
    aliases: tuple[str, ...]

    def create(self, config: ModelConfig) -> BaseChatModel:
        """Create the configured chat model."""

        raise NotImplementedError
