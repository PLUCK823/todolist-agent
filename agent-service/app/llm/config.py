"""Environment-backed configuration for production model providers."""

from __future__ import annotations

import math
import os
from dataclasses import dataclass

from pydantic import SecretStr


PROVIDER_ALIASES = {"gemini": "google"}
PROVIDER_DEFAULTS: dict[str, tuple[str | None, str | None]] = {
    "openai": ("gpt-4o", None),
    "anthropic": ("claude-sonnet-4-5", None),
    "google": ("gemini-2.5-flash", None),
    "deepseek": ("deepseek-v4-flash", "https://api.deepseek.com"),
    "openai-compatible": (None, None),
}


@dataclass(frozen=True, repr=False)
class ModelConfig:
    """Normalized model settings with a redacted credential representation."""

    provider: str
    model: str
    api_key: SecretStr
    base_url: str | None
    temperature: float

    @classmethod
    def from_env(cls) -> "ModelConfig":
        """Read and validate the unified LLM environment contract."""

        from .base import ModelConfigurationError

        raw_provider = os.getenv("LLM_PROVIDER", "openai").strip().lower()
        provider = PROVIDER_ALIASES.get(raw_provider, raw_provider)
        if provider not in PROVIDER_DEFAULTS:
            raise ModelConfigurationError(
                f"Unsupported LLM_PROVIDER: {provider or '(empty)'}"
            )

        default_model, default_url = PROVIDER_DEFAULTS[provider]
        model = os.getenv("LLM_MODEL", "").strip() or default_model
        api_key = os.getenv("LLM_API_KEY", "").strip()
        base_url = os.getenv("LLM_BASE_URL", "").strip() or default_url

        if not api_key:
            raise ModelConfigurationError(
                f"LLM_API_KEY is required for provider {provider}"
            )
        if not model:
            raise ModelConfigurationError(
                f"LLM_MODEL is required for provider {provider}"
            )
        if provider == "openai-compatible" and not base_url:
            raise ModelConfigurationError(
                "LLM_BASE_URL is required for provider openai-compatible"
            )

        raw_temperature = os.getenv("LLM_TEMPERATURE", "0.1").strip()
        try:
            temperature = float(raw_temperature)
        except ValueError as exc:
            raise ModelConfigurationError(
                "LLM_TEMPERATURE must be a number between 0.0 and 2.0"
            ) from exc
        if not math.isfinite(temperature) or not 0.0 <= temperature <= 2.0:
            raise ModelConfigurationError(
                "LLM_TEMPERATURE must be a finite number between 0.0 and 2.0"
            )

        return cls(
            provider=provider,
            model=model,
            api_key=SecretStr(api_key),
            base_url=base_url,
            temperature=temperature,
        )

    def __repr__(self) -> str:
        return (
            f"ModelConfig(provider={self.provider!r}, model={self.model!r}, "
            f"base_url={self.base_url!r}, temperature={self.temperature!r}, "
            "api_key=SecretStr('**********'))"
        )
