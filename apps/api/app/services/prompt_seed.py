from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.prompt_template import PromptTemplate


def seed_default_prompt_templates(session: Session) -> int:
    """
    Seed default global prompt templates from a JSON file.
    Prompts are stored outside python code to meet the constraint:
    "All prompts must not be hardcoded in code".
    """
    repo_root = Path(__file__).resolve().parents[4]
    seed_path = repo_root / "apps" / "api" / "app" / "data" / "default_prompt_templates.json"
    if not seed_path.exists():
        return 0

    payload = json.loads(seed_path.read_text(encoding="utf-8"))
    items = payload.get("items") if isinstance(payload, dict) else None
    if not isinstance(items, list):
        return 0

    created = 0
    for item in items:
        if not isinstance(item, dict):
            continue
        prompt_type = str(item.get("prompt_type") or "").strip()
        scope = str(item.get("scope") or "").strip()
        if not prompt_type or not scope:
            continue

        exists = session.scalar(
            select(PromptTemplate)
            .where(
                PromptTemplate.prompt_type == prompt_type,
                PromptTemplate.scope == scope,
                PromptTemplate.category_id.is_(None),
                PromptTemplate.task_id.is_(None),
            )
            .limit(1)
        )
        template_text = str(item.get("template_text") or "")
        if not template_text:
            continue

        if exists is not None:
            exists.name = str(item.get("name") or exists.name)
            exists.template_text = template_text
            exists.variables_json = item.get("variables_json") or {}
            exists.version = int(item.get("version") or exists.version or 1)
            exists.enabled = bool(item.get("enabled") if item.get("enabled") is not None else True)
            session.add(exists)
            created += 1
            continue

        template = PromptTemplate(
            name=str(item.get("name") or f"{prompt_type} ({scope})"),
            prompt_type=prompt_type,
            scope=scope,
            category_id=item.get("category_id"),
            task_id=item.get("task_id"),
            template_text=template_text,
            variables_json=item.get("variables_json") or {},
            version=int(item.get("version") or 1),
            enabled=bool(item.get("enabled") if item.get("enabled") is not None else True),
        )
        session.add(template)
        created += 1

    if created:
        session.commit()
    return created
