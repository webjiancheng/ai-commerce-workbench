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
    rule = DefaultRule(**payload.model_dump())
    session.add(rule)
    session.commit()
    session.refresh(rule)
    return rule


def get_default_rule(session: Session, rule_id: int) -> DefaultRule | None:
    return session.get(DefaultRule, rule_id)


def update_default_rule(session: Session, rule: DefaultRule, payload: DefaultRuleUpdate) -> DefaultRule:
    updates = payload.model_dump(exclude_unset=True)
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

