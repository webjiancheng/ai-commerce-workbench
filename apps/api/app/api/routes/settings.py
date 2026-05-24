from __future__ import annotations

from urllib.parse import urlparse, urlunparse

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel, Field
from openai import OpenAI
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.core.task_status import GenerationMode
from app.services.image_runtime import resolve_image_runtime
from app.services.openai_client import is_openai_configured
from app.services.cost_configs import get_cost_config
from app.services.export_templates import get_default_export_template
from app.services.provider_configs import get_default_provider_config


router = APIRouter(tags=["settings"])


class AiCompatTestIn(BaseModel):
    base_url: str = Field(min_length=1)
    api_key: str = Field(min_length=1)


def _normalize_openai_compat_base_url(url: str) -> str:
    u = (url or "").strip().rstrip("/")
    parsed = urlparse(u)
    path = parsed.path or ""
    if path in ("", "/"):
        path = "/v1"
    return urlunparse((parsed.scheme, parsed.netloc, path, "", "", ""))


@router.get("/api/settings/overview")
def settings_overview_endpoint(session: Session = Depends(get_db_session)) -> dict[str, object]:
    image_provider = get_default_provider_config(session, provider_type="image")
    text_provider = get_default_provider_config(session, provider_type="text")
    storage_provider = get_default_provider_config(session, provider_type="storage")
    export_tpl = get_default_export_template(session, platform="temu")
    cost_cfg = get_cost_config(session)

    def _provider(p):
        if p is None:
            return None
        secret = p.secret_config_json or {}
        last4 = secret.get("api_key_last4") if isinstance(secret, dict) else None
        return {
            "id": p.id,
            "provider_type": p.provider_type,
            "provider_name": p.provider_name,
            "display_name": p.display_name,
            "enabled": p.enabled,
            "is_default": p.is_default,
            "api_key_configured": bool(last4),
            "masked_key": f"****{last4}" if last4 else None,
            "config_json": p.config_json or {},
            "capabilities_json": p.capabilities_json or {},
            "pricing_json": p.pricing_json or {},
        }

    return {
        "ok": True,
        "defaults": {
            "image_provider": _provider(image_provider),
            "text_provider": _provider(text_provider),
            "storage_provider": _provider(storage_provider),
            "export_template": {
                "id": export_tpl.id,
                "name": export_tpl.name,
                "version": export_tpl.version,
                "platform": export_tpl.platform,
            }
            if export_tpl
            else None,
        },
        "cost_config": {"enabled": cost_cfg.enabled, "config_json": cost_cfg.config_json, "updated_at": cost_cfg.updated_at},
    }


@router.post("/api/ai/test-openai-compatible")
def test_openai_compatible_endpoint(payload: AiCompatTestIn) -> dict[str, object]:
    base_url = _normalize_openai_compat_base_url(payload.base_url)
    try:
        client = OpenAI(api_key=payload.api_key, base_url=base_url, timeout=20.0)
        models_resp = client.models.list()
        items = getattr(models_resp, "data", []) or []
        models: list[str] = []
        for item in items:
            model_id = getattr(item, "id", None)
            if isinstance(model_id, str) and model_id.strip():
                models.append(model_id.strip())
        return {"ok": True, "base_url": base_url, "models": sorted(list(set(models)))}
    except Exception as exc:
        return {"ok": False, "base_url": base_url, "detail": str(exc)}


@router.get("/api/settings/task-readiness")
def task_readiness_endpoint(
    generation_mode: GenerationMode = Query(default=GenerationMode.title_and_4grid),
    x_ai_api_key: str | None = Header(default=None),
    x_ai_base_url: str | None = Header(default=None),
    x_ai_model: str | None = Header(default=None),
    x_ai_image_api_key: str | None = Header(default=None),
    x_ai_image_base_url: str | None = Header(default=None),
    x_ai_image_model: str | None = Header(default=None),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    needs_ai = generation_mode not in {GenerationMode.task_only, GenerationMode.no_ai}
    override = {
        "api_key": (x_ai_api_key or "").strip(),
        "base_url": (x_ai_base_url or "").strip(),
        "model": (x_ai_model or "").strip(),
        "image_api_key": (x_ai_image_api_key or "").strip(),
        "image_base_url": (x_ai_image_base_url or "").strip(),
        "image_model": (x_ai_image_model or "").strip(),
    }
    ai_ready = is_openai_configured(session, override=override)
    image_runtime = resolve_image_runtime(session, override=override)
    image_ready = bool(
        image_runtime.get("enabled")
        and image_runtime.get("provider_name")
        and str(image_runtime.get("provider_name")) != "stub"
        and image_runtime.get("api_key")
    )
    needs_image = generation_mode in {
        GenerationMode.title_and_4grid,
        GenerationMode.title_and_image_prompts,
        GenerationMode.full_later,
    }
    return {
        "ok": True,
        "generation_mode": generation_mode.value,
        "checks": {
            "openai_configured": ai_ready,
            "image_provider_configured": image_ready,
        },
        "can_create_task": ((not needs_ai) or ai_ready) and ((not needs_image) or image_ready),
        "blocking_message": (
            "请先在 AI 配置中设置可用的文本模型 API Key（默认 text provider 或环境变量）后再生成任务。"
            if needs_ai and not ai_ready
            else "请先配置可用的图片模型（默认后端 provider 或当前浏览器里的图片运行时）后再生成任务。"
            if needs_image and not image_ready
            else None
        ),
    }
