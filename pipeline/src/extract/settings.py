"""Pipeline configuration loaded from environment variables.

Uses ``pydantic-settings`` (a separate package in pydantic v2 — see CLAUDE.md
notes). Reads from process env and from a ``.env`` file in the pipeline
directory if one exists.

Usage:
    from extract.settings import settings
    print(settings.anthropic_api_key)
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Pipeline-wide settings.

    SecretStr is used for keys so they never accidentally render in logs or
    repr() output. Call ``.get_secret_value()`` when actually passing to a SDK.
    """

    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[2] / ".env",
        env_file_encoding="utf-8",
        env_prefix="",          # use literal env var names
        extra="ignore",         # ignore unrelated env vars (CI sets many)
        case_sensitive=False,   # ANTHROPIC_API_KEY or anthropic_api_key both work
    )

    # ── Required (must be set in env or .env) ──────────────────────────────
    anthropic_api_key: SecretStr = Field(
        ...,
        description="Claude API auth. From https://console.anthropic.com/settings/keys",
    )
    supabase_url: str = Field(
        ...,
        description="Project URL, e.g. https://abc.supabase.co",
    )
    supabase_service_role_key: SecretStr = Field(
        ...,
        description="Service role key — bypasses RLS. Server-side only; never ship to client.",
    )

    # ── Optional with defaults ─────────────────────────────────────────────
    wanderfree_model: str = Field(
        default="claude-sonnet-4-6",
        description="Claude model identifier used for extraction.",
    )
    wanderfree_max_tokens: int = Field(
        default=8192,
        description="Max output tokens per Claude call. 8K covers ~30 benefit calls per response.",
    )
    wanderfree_request_timeout_seconds: int = Field(
        default=120,
        description="Per-request timeout for source fetches (NOT the Claude API).",
    )
    wanderfree_user_agent: str = Field(
        default="WanderFree-Pipeline/0.1 (+https://github.com/harryclemente/WanderFree)",
        description="User-Agent for source fetches. Set to identify the bot.",
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached settings accessor.

    pydantic-settings re-reads env on every instantiation; we cache so
    repeated lookups are free and so any test override applied via
    ``get_settings.cache_clear()`` propagates cleanly.
    """
    return Settings()  # type: ignore[call-arg]  — Pydantic loads from env
