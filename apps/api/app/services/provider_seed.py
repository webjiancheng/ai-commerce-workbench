from __future__ import annotations

import os

from app.core.config import get_settings
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.provider_config import ProviderConfig


def seed_default_provider_configs(session: Session) -> None:
    """
    Stage-6:
    - Image provider: stub (local deterministic generation) as default.
    - Storage provider: local (static /storage).
    - Text provider: OpenAI-compatible default route (model config from settings).
    """

    settings = get_settings()
    has_env_key = bool((settings.openai_api_key or os.environ.get("OPENAI_API_KEY") or "").strip())

    existing = session.scalars(select(ProviderConfig)).all()
    existing_keys = {(p.provider_type, p.provider_name) for p in existing}

    def ensure(
        *,
        provider_type: str,
        provider_name: str,
        display_name: str,
        enabled: bool,
        is_default: bool,
        config_json: dict,
        capabilities_json: dict,
        pricing_json: dict | None = None,
    ) -> None:
        key = (provider_type, provider_name)
        if key in existing_keys:
            return
        session.add(
            ProviderConfig(
                provider_type=provider_type,
                provider_name=provider_name,
                display_name=display_name,
                enabled=enabled,
                is_default=is_default,
                config_json=config_json,
                capabilities_json=capabilities_json,
                pricing_json=pricing_json or {},
            )
        )

    ensure(
        provider_type="text",
        provider_name="openai_compatible_default",
        display_name="OpenAI Compatible Text (Default)",
        enabled=True,
        is_default=True,
        config_json={
            "base_url": "https://api.openai.com/v1",
            "default_model": settings.openai_model,
            "default_vision_model": settings.openai_vision_model,
        },
        capabilities_json={
            "supports_json_mode": True,
            "supports_response_format": True,
            "api_key_configured": has_env_key,
        },
        pricing_json={},
    )

    ensure(
        provider_type="image",
        provider_name="stub",
        display_name="Stub Image Provider (Local)",
        enabled=True,
        is_default=True,
        config_json={
            "default_model": "stub-v1",
            "default_size": "1024x1024",
        },
        capabilities_json={
            "supports_reference_image": False,
            "supports_4grid": True,
            "api_key_configured": False,
        },
        pricing_json={"estimated_cost_per_image": 0.0},
    )

    ensure(
        provider_type="storage",
        provider_name="local",
        display_name="Local Storage (/storage)",
        enabled=True,
        is_default=True,
        config_json={"base_dir": "assets"},
        capabilities_json={"public_url": True},
    )

    session.commit()
