from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.cost_config import CostConfig
from app.core.defaults import DEFAULT_LIMITS


def get_cost_config(session: Session) -> CostConfig:
    row = session.scalar(select(CostConfig).order_by(CostConfig.id.asc()).limit(1))
    if row is not None:
        return row
    row = CostConfig(
        name="default",
        enabled=True,
        config_json={
            "limits": DEFAULT_LIMITS,
            "daily_budget": None,
            "currency": "USD",
        },
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def update_cost_config(session: Session, *, enabled: bool | None, config_json: dict | None) -> CostConfig:
    row = get_cost_config(session)
    if enabled is not None:
        row.enabled = enabled
    if config_json is not None:
        row.config_json = config_json
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def get_limit_value(session: Session, key: str) -> int | None:
    row = get_cost_config(session)
    if not row.enabled:
        return None
    limits = (row.config_json or {}).get("limits") if isinstance(row.config_json, dict) else None
    if isinstance(limits, dict) and key in limits:
        try:
            return int(limits[key])
        except Exception:
            return None
    return None
