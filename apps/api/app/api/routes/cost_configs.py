from __future__ import annotations

from fastapi import APIRouter, Body, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.services.cost_configs import get_cost_config, update_cost_config


router = APIRouter(tags=["cost-configs"])


@router.get("/api/cost-configs")
def get_cost_configs_endpoint(session: Session = Depends(get_db_session)) -> dict[str, object]:
    row = get_cost_config(session)
    return {"ok": True, "enabled": row.enabled, "config_json": row.config_json, "updated_at": row.updated_at}


class PatchCostConfigRequest(BaseModel):
    enabled: bool | None = None
    config_json: dict | None = Field(default=None)


@router.patch("/api/cost-configs")
def patch_cost_configs_endpoint(
    payload: PatchCostConfigRequest = Body(...),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    row = update_cost_config(session, enabled=payload.enabled, config_json=payload.config_json)
    return {"ok": True, "enabled": row.enabled, "config_json": row.config_json, "updated_at": row.updated_at}

