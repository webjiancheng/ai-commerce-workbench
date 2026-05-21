from __future__ import annotations

import os
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any

from openai import OpenAI
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.crypto import decrypt_secret
from app.db.session import SessionLocal
from app.services.provider_configs import get_default_provider_config

_runtime_override_ctx: ContextVar[dict[str, Any] | None] = ContextVar(
    "ai_caiji_runtime_override",
    default=None,
)


def _decrypt_provider_api_key(secret_config: dict[str, Any] | None) -> str | None:
    if not isinstance(secret_config, dict):
        return None
    encrypted = secret_config.get("api_key_enc")
    if not isinstance(encrypted, str) or not encrypted.strip():
        return None
    try:
        return decrypt_secret(encrypted.strip())
    except Exception:
        return None


def set_runtime_override(override: dict[str, Any] | None) -> None:
    _runtime_override_ctx.set(override or None)


@contextmanager
def runtime_override(override: dict[str, Any] | None):
    token = _runtime_override_ctx.set(override or None)
    try:
        yield
    finally:
        _runtime_override_ctx.reset(token)


def resolve_text_runtime(session: Session | None = None, *, override: dict[str, Any] | None = None) -> dict[str, Any]:
    settings = get_settings()
    env_api_key = (settings.openai_api_key or os.environ.get("OPENAI_API_KEY") or "").strip() or None

    runtime: dict[str, Any] = {
        "provider_source": "env",
        "provider_id": None,
        "provider_name": "env",
        "provider_display_name": "ENV OpenAI",
        "api_key": env_api_key,
        "base_url": None,
        "model": settings.openai_model,
        "vision_model": settings.openai_vision_model,
    }

    owns_session = session is None
    local_session: Session | None = session
    if owns_session:
        local_session = SessionLocal()

    try:
        if local_session is None:
            return runtime
        provider = get_default_provider_config(local_session, provider_type="text")
        if provider is None or not provider.enabled:
            return runtime

        config = provider.config_json or {}
        provider_api_key = _decrypt_provider_api_key(provider.secret_config_json)
        default_model = str(config.get("default_model") or "").strip()
        default_vision_model = str(config.get("default_vision_model") or "").strip()
        base_url = str(config.get("base_url") or "").strip().rstrip("/")
        if not base_url:
            base_url = None

        runtime.update(
            {
                "provider_source": "provider",
                "provider_id": provider.id,
                "provider_name": provider.provider_name,
                "provider_display_name": provider.display_name,
                "api_key": provider_api_key or env_api_key,
                "base_url": base_url,
                "model": default_model or settings.openai_model,
                "vision_model": default_vision_model or default_model or settings.openai_vision_model,
            }
        )
        current_override = override if override is not None else _runtime_override_ctx.get()
        if isinstance(current_override, dict):
            override_api_key = str(current_override.get("api_key") or "").strip()
            override_base_url = str(current_override.get("base_url") or "").strip().rstrip("/")
            override_model = str(current_override.get("model") or "").strip()
            override_vision_model = str(current_override.get("vision_model") or "").strip()
            if override_api_key:
                runtime.update(
                    {
                        "provider_source": "request",
                        "provider_id": None,
                        "provider_name": "request",
                        "provider_display_name": "Request Runtime",
                        "api_key": override_api_key,
                    }
                )
            if override_base_url:
                runtime["base_url"] = override_base_url
            if override_model:
                runtime["model"] = override_model
            if override_vision_model:
                runtime["vision_model"] = override_vision_model
        return runtime
    finally:
        if owns_session and local_session is not None:
            local_session.close()


def is_openai_configured(session: Session | None = None, *, override: dict[str, Any] | None = None) -> bool:
    runtime = resolve_text_runtime(session, override=override)
    return bool(runtime.get("api_key"))


def get_openai_client(session: Session | None = None, *, override: dict[str, Any] | None = None) -> OpenAI:
    runtime = resolve_text_runtime(session, override=override)
    api_key = runtime.get("api_key")
    if not api_key:
        raise RuntimeError(
            "Missing AI API key. Configure default text provider key or set AI_CAIJI_OPENAI_API_KEY / OPENAI_API_KEY."
        )
    base_url = runtime.get("base_url")
    if isinstance(base_url, str) and base_url.strip():
        return OpenAI(api_key=api_key, base_url=base_url.strip())
    return OpenAI(api_key=api_key)


def get_text_model(session: Session | None = None, *, override: dict[str, Any] | None = None) -> str:
    runtime = resolve_text_runtime(session, override=override)
    model = str(runtime.get("model") or "").strip()
    if model:
        return model
    return get_settings().openai_model


def get_vision_model(session: Session | None = None, *, override: dict[str, Any] | None = None) -> str:
    runtime = resolve_text_runtime(session, override=override)
    model = str(runtime.get("vision_model") or "").strip()
    if model:
        return model
    return get_settings().openai_vision_model
