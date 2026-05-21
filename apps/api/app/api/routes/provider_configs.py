from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.schemas.provider_config import ProviderConfigCreate, ProviderConfigOut, ProviderConfigUpdate
from app.services.provider_configs import (
    create_provider_config,
    get_default_provider_config,
    get_provider_config,
    list_provider_configs,
    set_default_provider_config,
    update_provider_config,
)


router = APIRouter(tags=["provider-configs"])

def _to_out(item) -> ProviderConfigOut:
    secret = item.secret_config_json or {}
    last4 = secret.get("api_key_last4") if isinstance(secret, dict) else None
    configured = bool(last4)  # we never expose raw key
    out = ProviderConfigOut.model_validate(item)
    out.api_key_configured = configured
    out.masked_key = f"****{last4}" if configured else None
    return out


@router.get("/api/provider-configs", response_model=list[ProviderConfigOut])
def list_provider_configs_endpoint(
    provider_type: str | None = Query(default=None),
    session: Session = Depends(get_db_session),
) -> list[ProviderConfigOut]:
    return [_to_out(item) for item in list_provider_configs(session, provider_type=provider_type)]


@router.post("/api/provider-configs", response_model=ProviderConfigOut)
def create_provider_config_endpoint(
    payload: ProviderConfigCreate = Body(...),
    session: Session = Depends(get_db_session),
) -> ProviderConfigOut:
    try:
        item = create_provider_config(session, payload)
        return _to_out(item)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.patch("/api/provider-configs/{provider_id}", response_model=ProviderConfigOut)
def patch_provider_config_endpoint(
    provider_id: int,
    payload: ProviderConfigUpdate = Body(...),
    session: Session = Depends(get_db_session),
) -> ProviderConfigOut:
    provider = get_provider_config(session, provider_id)
    if provider is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Provider config not found")
    try:
        updated = update_provider_config(session, provider, payload)
        return _to_out(updated)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/api/provider-configs/{provider_id}/set-default")
def set_default_provider_config_endpoint(
    provider_id: int,
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    provider = get_provider_config(session, provider_id)
    if provider is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Provider config not found")
    set_default_provider_config(session, provider_type=provider.provider_type, provider_id=provider.id)
    return {"ok": True, "id": provider.id, "provider_type": provider.provider_type}


@router.get("/api/image-providers", response_model=list[ProviderConfigOut])
def list_image_providers_endpoint(session: Session = Depends(get_db_session)) -> list[ProviderConfigOut]:
    items = list_provider_configs(session, provider_type="image")
    items = [i for i in items if i.enabled]
    return [_to_out(i) for i in items]


@router.get("/api/image-providers/default", response_model=ProviderConfigOut)
def get_default_image_provider_endpoint(session: Session = Depends(get_db_session)) -> ProviderConfigOut:
    provider = get_default_provider_config(session, provider_type="image")
    if provider is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Default image provider not found")
    return _to_out(provider)
