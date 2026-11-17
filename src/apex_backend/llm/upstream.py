"""Server-side settings for the upstream OpenAI-compatible model (Kimi by default)."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from urllib.parse import urlparse

DEFAULT_BASE_URL = "https://api.moonshot.ai/v1"
DEFAULT_MODEL = "kimi-k3.1-pro"


@dataclass(frozen=True)
class LlmUpstream:
    """Where the server sends chat completions. The key never leaves the server."""

    base_url: str
    api_key: str
    model: str
    timeout: float = 90.0
    max_tokens: int = 8192

    def __post_init__(self) -> None:
        parsed = urlparse(self.base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ValueError("APEX_LLM_UPSTREAM_BASE_URL must be an HTTP(S) URL.")
        if not self.api_key or not self.model:
            raise ValueError("LLM upstream needs an API key and a model id.")
        if not 0 < self.timeout <= 600 or not 1 <= self.max_tokens <= 200_000:
            raise ValueError("LLM upstream timeout or max_tokens is out of range.")

    @property
    def completions_url(self) -> str:
        return f"{self.base_url.rstrip('/')}/chat/completions"

    @classmethod
    def from_env(cls, env: Mapping[str, str] = os.environ) -> LlmUpstream | None:
        """Read APEX_LLM_* settings; None when no upstream key is set (serving off)."""
        key = env.get("APEX_LLM_UPSTREAM_API_KEY", "").strip()
        if not key:
            return None
        return cls(
            base_url=env.get("APEX_LLM_UPSTREAM_BASE_URL", "").strip() or DEFAULT_BASE_URL,
            api_key=key,
            model=env.get("APEX_LLM_MODEL", "").strip() or DEFAULT_MODEL,
            timeout=float(env.get("APEX_LLM_TIMEOUT", "90")),
            max_tokens=int(env.get("APEX_LLM_MAX_TOKENS", "8192")),
        )


__all__ = ["DEFAULT_BASE_URL", "DEFAULT_MODEL", "LlmUpstream"]
