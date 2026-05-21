from __future__ import annotations

import re
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.prompt_types import PROMPT_SCOPES, PROMPT_TYPES
from app.models.prompt_template import PromptTemplate
from app.schemas.prompt_template import PromptTemplateCreate, PromptTemplateUpdate


PLACEHOLDER_RE = re.compile(r"{{\s*([a-zA-Z0-9_]+)\s*}}")


def validate_prompt_type(prompt_type: str) -> None:
    if prompt_type not in PROMPT_TYPES:
        raise ValueError(f"Unsupported prompt_type: {prompt_type}")


def validate_scope(scope: str) -> None:
    if scope not in PROMPT_SCOPES:
        raise ValueError(f"Unsupported scope: {scope}")


def render_template_text(*, template_text: str, variables: dict[str, Any]) -> str:
    def replace(match: re.Match[str]) -> str:
        key = match.group(1)
        value = variables.get(key)
        if value is None:
            return match.group(0)
        if isinstance(value, (dict, list)):
            return str(value)
        return str(value)

    return PLACEHOLDER_RE.sub(replace, template_text)


def create_prompt_template(session: Session, payload: PromptTemplateCreate) -> PromptTemplate:
    validate_prompt_type(payload.prompt_type)
    validate_scope(payload.scope)

    item = PromptTemplate(
        name=payload.name,
        prompt_type=payload.prompt_type,
        scope=payload.scope,
        category_id=payload.category_id,
        task_id=payload.task_id,
        template_text=payload.template_text,
        variables_json=payload.variables_json,
        version=payload.version,
        enabled=payload.enabled,
    )
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


def list_prompt_templates(
    session: Session,
    *,
    limit: int,
    offset: int,
    prompt_type: str | None = None,
    scope: str | None = None,
    category_id: str | None = None,
    task_id: int | None = None,
) -> tuple[list[PromptTemplate], int]:
    query = select(PromptTemplate)
    count_query = select(func.count()).select_from(PromptTemplate)

    if prompt_type:
        query = query.where(PromptTemplate.prompt_type == prompt_type)
        count_query = count_query.where(PromptTemplate.prompt_type == prompt_type)
    if scope:
        query = query.where(PromptTemplate.scope == scope)
        count_query = count_query.where(PromptTemplate.scope == scope)
    if category_id:
        query = query.where(PromptTemplate.category_id == category_id)
        count_query = count_query.where(PromptTemplate.category_id == category_id)
    if task_id is not None:
        query = query.where(PromptTemplate.task_id == task_id)
        count_query = count_query.where(PromptTemplate.task_id == task_id)

    total = session.scalar(count_query) or 0
    items = session.scalars(
        query.order_by(PromptTemplate.updated_at.desc(), PromptTemplate.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return items, total


def get_prompt_template(session: Session, template_id: int) -> PromptTemplate | None:
    return session.get(PromptTemplate, template_id)


def update_prompt_template(
    session: Session, template: PromptTemplate, payload: PromptTemplateUpdate
) -> PromptTemplate:
    updates = payload.model_dump(exclude_unset=True)
    for field_name, value in updates.items():
        setattr(template, field_name, value)
    session.add(template)
    session.commit()
    session.refresh(template)
    return template


def resolve_prompt(
    session: Session,
    *,
    prompt_type: str,
    task_id: int,
    category_id: str | None,
) -> PromptTemplate | None:
    """
    Priority: task override > category > global.
    Only considers enabled templates.
    When multiple templates exist in same scope, prefer higher version then newer updated_at.
    """
    validate_prompt_type(prompt_type)

    def pick(scope: str) -> PromptTemplate | None:
        query = (
            select(PromptTemplate)
            .where(
                PromptTemplate.prompt_type == prompt_type,
                PromptTemplate.scope == scope,
                PromptTemplate.enabled.is_(True),
            )
            .order_by(PromptTemplate.version.desc(), PromptTemplate.updated_at.desc(), PromptTemplate.id.desc())
        )
        if scope == "task":
            query = query.where(PromptTemplate.task_id == task_id)
        elif scope == "category":
            query = query.where(PromptTemplate.category_id == category_id)
        else:
            query = query.where(PromptTemplate.category_id.is_(None), PromptTemplate.task_id.is_(None))
        return session.scalar(query.limit(1))

    return pick("task") or pick("category") or pick("global")

