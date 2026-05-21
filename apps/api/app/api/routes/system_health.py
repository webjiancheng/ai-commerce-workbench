from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import get_db_session
from app.services.export_templates import get_default_export_template
from app.services.provider_configs import get_default_provider_config


router = APIRouter(tags=["system"])


@router.get("/api/system/health")
def system_health_endpoint(session: Session = Depends(get_db_session)) -> dict[str, object]:
    settings = get_settings()

    db_ok = True
    db_error = None
    try:
        session.execute(text("SELECT 1"))
    except Exception as exc:
        db_ok = False
        db_error = str(exc)

    storage_root = Path(settings.storage_root)
    storage_ok = storage_root.exists()

    image_provider = get_default_provider_config(session, provider_type="image")
    storage_provider = get_default_provider_config(session, provider_type="storage")
    export_tpl = get_default_export_template(session, platform="temu")

    def _p(p):
        if p is None:
            return None
        secret = p.secret_config_json or {}
        last4 = secret.get("api_key_last4") if isinstance(secret, dict) else None
        return {
            "id": p.id,
            "provider_name": p.provider_name,
            "display_name": p.display_name,
            "enabled": p.enabled,
            "api_key_configured": bool(last4),
        }

    return {
        "ok": True,
        "api": {"ok": True},
        "db": {"ok": db_ok, "error": db_error},
        "redis": {"ok": None, "note": "not configured"},
        "worker": {"ok": None, "note": "BackgroundTasks (no separate worker)"},
        "storage": {"ok": storage_ok, "root": str(storage_root)},
        "defaults": {
            "image_provider": _p(image_provider),
            "storage_provider": _p(storage_provider),
            "export_template": {"id": export_tpl.id, "version": export_tpl.version} if export_tpl else None,
        },
    }

