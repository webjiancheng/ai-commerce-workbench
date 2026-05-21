from __future__ import annotations

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models.provider_config import ProviderConfig
from app.schemas.provider_config import ProviderConfigCreate, ProviderConfigUpdate
from app.core.crypto import encrypt_secret, mask_secret


def list_provider_configs(
    session: Session, *, provider_type: str | None = None
) -> list[ProviderConfig]:
    query = select(ProviderConfig).order_by(ProviderConfig.provider_type.asc(), ProviderConfig.id.desc())
    if provider_type:
        query = query.where(ProviderConfig.provider_type == provider_type)
    return session.scalars(query).all()


def create_provider_config(session: Session, payload: ProviderConfigCreate) -> ProviderConfig:
    data = payload.model_dump(exclude={"api_key"})
    item = ProviderConfig(**data)
    if payload.api_key:
        encrypted = encrypt_secret(payload.api_key)
        item.secret_config_json = {"api_key_enc": encrypted, "api_key_last4": payload.api_key[-4:]}
        caps = dict(item.capabilities_json or {})
        caps["api_key_configured"] = True
        item.capabilities_json = caps
    session.add(item)
    session.commit()
    session.refresh(item)
    if item.is_default:
        set_default_provider_config(session, provider_type=item.provider_type, provider_id=item.id)
        session.refresh(item)
    return item


def get_provider_config(session: Session, provider_id: int) -> ProviderConfig | None:
    return session.get(ProviderConfig, provider_id)


def update_provider_config(
    session: Session, provider: ProviderConfig, payload: ProviderConfigUpdate
) -> ProviderConfig:
    updates = payload.model_dump(exclude_unset=True, exclude={"api_key"})
    for field_name, value in updates.items():
        setattr(provider, field_name, value)
    if payload.api_key:
        encrypted = encrypt_secret(payload.api_key)
        provider.secret_config_json = {"api_key_enc": encrypted, "api_key_last4": payload.api_key[-4:]}
        caps = dict(provider.capabilities_json or {})
        caps["api_key_configured"] = True
        provider.capabilities_json = caps
    session.add(provider)
    session.commit()
    session.refresh(provider)
    if provider.is_default:
        set_default_provider_config(session, provider_type=provider.provider_type, provider_id=provider.id)
        session.refresh(provider)
    return provider


def set_default_provider_config(session: Session, *, provider_type: str, provider_id: int) -> None:
    session.execute(
        update(ProviderConfig)
        .where(ProviderConfig.provider_type == provider_type, ProviderConfig.id != provider_id)
        .values(is_default=False)
    )
    session.execute(
        update(ProviderConfig)
        .where(ProviderConfig.id == provider_id)
        .values(is_default=True)
    )
    session.commit()


def get_default_provider_config(session: Session, *, provider_type: str) -> ProviderConfig | None:
    return session.scalar(
        select(ProviderConfig)
        .where(ProviderConfig.provider_type == provider_type, ProviderConfig.enabled.is_(True), ProviderConfig.is_default.is_(True))
        .order_by(ProviderConfig.updated_at.desc(), ProviderConfig.id.desc())
        .limit(1)
    )
