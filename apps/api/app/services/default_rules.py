from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.default_rule import DefaultRule
from app.schemas.default_rule import DefaultRuleCreate, DefaultRuleUpdate


def list_default_rules(
    session: Session,
    *,
    rule_type: str | None = None,
    scope: str | None = None,
    platform: str | None = None,
    site: str | None = None,
    fulfillment_mode: str | None = None,
    category_path: str | None = None,
    enabled: bool | None = None,
    limit: int = 200,
    offset: int = 0,
) -> tuple[list[DefaultRule], int]:
    query = select(DefaultRule)
    count_q = select(func.count()).select_from(DefaultRule)

    if rule_type:
        query = query.where(DefaultRule.rule_type == rule_type)
        count_q = count_q.where(DefaultRule.rule_type == rule_type)
    if scope:
        query = query.where(DefaultRule.scope == scope)
        count_q = count_q.where(DefaultRule.scope == scope)
    if platform:
        query = query.where(DefaultRule.platform == platform)
        count_q = count_q.where(DefaultRule.platform == platform)
    if site:
        query = query.where(DefaultRule.site == site)
        count_q = count_q.where(DefaultRule.site == site)
    if fulfillment_mode:
        query = query.where(DefaultRule.fulfillment_mode == fulfillment_mode)
        count_q = count_q.where(DefaultRule.fulfillment_mode == fulfillment_mode)
    if category_path:
        query = query.where(DefaultRule.category_path.contains(category_path))
        count_q = count_q.where(DefaultRule.category_path.contains(category_path))
    if enabled is not None:
        query = query.where(DefaultRule.enabled.is_(enabled))
        count_q = count_q.where(DefaultRule.enabled.is_(enabled))

    total = session.scalar(count_q) or 0
    items = session.scalars(
        query.order_by(DefaultRule.priority.desc(), DefaultRule.updated_at.desc(), DefaultRule.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return items, int(total)


def create_default_rule(session: Session, payload: DefaultRuleCreate) -> DefaultRule:
    data = payload.model_dump()
    if not data.get("conditions_json"):
        data["conditions_json"] = dict(data.get("match_json") or {})
    if not data.get("match_json"):
        data["match_json"] = dict(data.get("conditions_json") or {})
    if not data.get("values_json"):
        data["values_json"] = dict(data.get("output_json") or {})
    if not data.get("output_json"):
        data["output_json"] = dict(data.get("values_json") or {})
    rule = DefaultRule(**data)
    session.add(rule)
    session.commit()
    session.refresh(rule)
    return rule


def get_default_rule(session: Session, rule_id: int) -> DefaultRule | None:
    return session.get(DefaultRule, rule_id)


def update_default_rule(session: Session, rule: DefaultRule, payload: DefaultRuleUpdate) -> DefaultRule:
    updates = payload.model_dump(exclude_unset=True)
    if "conditions_json" in updates and "match_json" not in updates:
        updates["match_json"] = dict(updates.get("conditions_json") or {})
    if "match_json" in updates and "conditions_json" not in updates:
        updates["conditions_json"] = dict(updates.get("match_json") or {})
    if "values_json" in updates and "output_json" not in updates:
        updates["output_json"] = dict(updates.get("values_json") or {})
    if "output_json" in updates and "values_json" not in updates:
        updates["values_json"] = dict(updates.get("output_json") or {})
    for k, v in updates.items():
        setattr(rule, k, v)
    session.add(rule)
    session.commit()
    session.refresh(rule)
    return rule


def disable_default_rule(session: Session, rule: DefaultRule) -> DefaultRule:
    rule.enabled = False
    session.add(rule)
    session.commit()
    session.refresh(rule)
    return rule
