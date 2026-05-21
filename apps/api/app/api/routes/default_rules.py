from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.schemas.default_rule import DefaultRuleCreate, DefaultRuleOut, DefaultRuleUpdate
from app.services.default_rules import (
    create_default_rule,
    disable_default_rule,
    get_default_rule,
    list_default_rules,
    update_default_rule,
)


router = APIRouter(tags=["default-rules"])


@router.get("/api/default-rules")
def list_default_rules_endpoint(
    rule_type: str | None = Query(default=None),
    scope: str | None = Query(default=None),
    enabled: bool | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    items, total = list_default_rules(
        session, rule_type=rule_type, scope=scope, enabled=enabled, limit=limit, offset=offset
    )
    return {
        "items": [DefaultRuleOut.model_validate(i) for i in items],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/api/default-rules", response_model=DefaultRuleOut)
def create_default_rule_endpoint(
    payload: DefaultRuleCreate = Body(...),
    session: Session = Depends(get_db_session),
) -> DefaultRuleOut:
    try:
        rule = create_default_rule(session, payload)
        return DefaultRuleOut.model_validate(rule)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/api/default-rules/{rule_id}", response_model=DefaultRuleOut)
def get_default_rule_endpoint(rule_id: int, session: Session = Depends(get_db_session)) -> DefaultRuleOut:
    rule = get_default_rule(session, rule_id)
    if rule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Default rule not found")
    return DefaultRuleOut.model_validate(rule)


@router.patch("/api/default-rules/{rule_id}", response_model=DefaultRuleOut)
def patch_default_rule_endpoint(
    rule_id: int,
    payload: DefaultRuleUpdate = Body(...),
    session: Session = Depends(get_db_session),
) -> DefaultRuleOut:
    rule = get_default_rule(session, rule_id)
    if rule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Default rule not found")
    try:
        updated = update_default_rule(session, rule, payload)
        return DefaultRuleOut.model_validate(updated)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.delete("/api/default-rules/{rule_id}", response_model=DefaultRuleOut)
def disable_default_rule_endpoint(rule_id: int, session: Session = Depends(get_db_session)) -> DefaultRuleOut:
    rule = get_default_rule(session, rule_id)
    if rule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Default rule not found")
    updated = disable_default_rule(session, rule)
    return DefaultRuleOut.model_validate(updated)

