"""Provider registry and model construction entry point."""

from __future__ import annotations

from langchain_core.language_models.chat_models import BaseChatModel

from .base import ModelConfigurationError, ProviderAdapter
from .config import ModelConfig
from .providers import DEEPSEEK_ADAPTER, OPENAI_COMPATIBLE_ADAPTER


def _build_registry(
    adapters: tuple[ProviderAdapter, ...],
) -> dict[str, ProviderAdapter]:
    registry: dict[str, ProviderAdapter] = {}
    for adapter in adapters:
        for name in (adapter.name, *adapter.aliases):
            registry[name] = adapter
    return registry


_REGISTRY = _build_registry((DEEPSEEK_ADAPTER, OPENAI_COMPATIBLE_ADAPTER))


def resolve_adapter(provider: str) -> ProviderAdapter:
    """Return the registered adapter or a safe, actionable error."""

    normalized = provider.strip().lower()
    adapter = _REGISTRY.get(normalized)
    if adapter is None:
        supported = ", ".join(sorted(_REGISTRY))
        raise ModelConfigurationError(
            f"Unsupported model provider {normalized or '(empty)'}; "
            f"supported providers: {supported}"
        )
    return adapter


def create_model(config: ModelConfig) -> BaseChatModel:
    """Create a LangChain chat model from normalized configuration."""

    return resolve_adapter(config.provider).create(config)
