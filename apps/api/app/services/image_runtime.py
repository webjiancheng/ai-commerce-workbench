from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.core.crypto import decrypt_secret, encrypt_secret, has_settings_secret_key
from app.models.provider_config import ProviderConfig
from app.services.openai_client import get_runtime_override
from app.services.provider_configs import get_default_provider_config


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


def _effective_provider_name(provider: ProviderConfig | None, *, api_key: str | None, base_url: str | None, model: str) -> str:
    if provider is not None and provider.provider_name != "stub":
        return provider.provider_name
    if api_key or base_url or (model and model != "stub-v1"):
        return "openai_compatible"
    return "stub"


def resolve_image_runtime(session: Session, *, override: dict[str, Any] | None = None) -> dict[str, Any]:
    provider = get_default_provider_config(session, provider_type="image")
    config = provider.config_json if provider else {}
    capabilities = provider.capabilities_json if provider else {}
    pricing = provider.pricing_json if provider else {}
    provider_api_key = _decrypt_provider_api_key(provider.secret_config_json if provider else None)
    base_url = str(config.get("base_url") or "").strip().rstrip("/") or None
    model = str(config.get("default_model") or "stub-v1").strip() or "stub-v1"
    size = str(config.get("default_size") or "1024x1024").strip() or "1024x1024"
    quality = str(config.get("quality") or "auto").strip() or "auto"
    background = str(config.get("background") or "auto").strip() or "auto"
    output_format = str(config.get("output_format") or "png").strip() or "png"

    runtime: dict[str, Any] = {
        "provider_source": "provider" if provider else "fallback",
        "provider_id": provider.id if provider else None,
        "provider_name": _effective_provider_name(provider, api_key=provider_api_key, base_url=base_url, model=model),
        "provider_display_name": provider.display_name if provider else "Stub Image Provider (Local)",
        "enabled": bool(provider.enabled) if provider else True,
        "api_key": provider_api_key,
        "base_url": base_url,
        "model": model,
        "size": size,
        "quality": quality,
        "background": background,
        "output_format": output_format,
        "supports_reference_image": bool(capabilities.get("supports_reference_image"))
        if provider
        else False,
        "pricing_json": pricing or {},
    }

    current_override = override if override is not None else get_runtime_override()
    if isinstance(current_override, dict):
        image_api_key = str(current_override.get("image_api_key") or "").strip()
        image_base_url = str(current_override.get("image_base_url") or "").strip().rstrip("/")
        image_model = str(current_override.get("image_model") or "").strip()
        image_size = str(current_override.get("image_size") or "").strip()
        image_quality = str(current_override.get("image_quality") or "").strip()
        if image_api_key or image_base_url or image_model:
            runtime.update(
                {
                    "provider_source": "request",
                    "provider_id": None,
                    "provider_name": "openai_compatible",
                    "provider_display_name": "Request Image Runtime",
                    "api_key": image_api_key or runtime.get("api_key"),
                    "base_url": image_base_url or runtime.get("base_url"),
                    "model": image_model or runtime.get("model") or "gpt-image-1",
                    "supports_reference_image": True,
                }
            )
        if image_size:
            runtime["size"] = image_size
        if image_quality:
            runtime["quality"] = image_quality

    if runtime["provider_name"] == "openai_compatible" and not runtime.get("model"):
        runtime["model"] = "gpt-image-1"
    if runtime["provider_name"] == "openai_compatible":
        runtime["supports_reference_image"] = True
    return runtime


def build_image_provider_snapshot(runtime: dict[str, Any]) -> dict[str, Any]:
    api_key = str(runtime.get("api_key") or "").strip()
    if api_key and not has_settings_secret_key():
        raise RuntimeError(
            "Missing AI_CAIJI_SETTINGS_SECRET_KEY for persisting image provider secrets"
        )
    return {
        "id": runtime.get("provider_id"),
        "provider_type": "image",
        "provider_name": runtime.get("provider_name") or "stub",
        "display_name": runtime.get("provider_display_name") or "Image Provider",
        "config_json": {
            "base_url": runtime.get("base_url"),
            "default_model": runtime.get("model"),
            "default_size": runtime.get("size"),
            "quality": runtime.get("quality") or "auto",
            "background": runtime.get("background") or "auto",
            "output_format": runtime.get("output_format") or "png",
        },
        "capabilities_json": {
            "api_key_configured": bool(api_key),
            "supports_reference_image": bool(runtime.get("supports_reference_image")),
            "supports_4grid": True,
        },
        "pricing_json": runtime.get("pricing_json") or {},
        "secret_config_json": (
            {
                "api_key_enc": encrypt_secret(api_key),
                "api_key_last4": api_key[-4:],
            }
            if api_key
            else None
        ),
    }
