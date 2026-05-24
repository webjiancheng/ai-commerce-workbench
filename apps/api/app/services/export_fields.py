from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.task_status import ExportStatus
from app.models.default_rule import DefaultRule
from app.models.export_field_draft import ExportFieldDraft
from app.models.product_ai_result import ProductAIResult
from app.models.product_task import ProductTask
from app.models.raw_product import RawProduct


PRIORITY_ORDER: dict[str, int] = {
    "global_default": 10,
    "keyword_rule": 20,
    "category_default": 30,
    "product_override": 40,
    "manual_override": 50,
}


def get_export_field_draft(session: Session, *, task_id: int) -> ExportFieldDraft | None:
    return session.scalar(select(ExportFieldDraft).where(ExportFieldDraft.product_task_id == task_id).limit(1))


def apply_default_rules(session: Session, *, task: ProductTask) -> ExportFieldDraft:
    return apply_default_rules_with_options(session, task=task, selected_rule_id=None)


def apply_default_rules_with_options(
    session: Session,
    *,
    task: ProductTask,
    selected_rule_id: int | None,
) -> ExportFieldDraft:
    existing = get_export_field_draft(session, task_id=task.id)
    fields: dict[str, Any] = {}
    sources: dict[str, Any] = {}
    warnings: list[dict[str, Any]] = []

    # Preserve manual overrides from existing draft
    locked_fields: set[str] = set()
    if existing is not None and isinstance(existing.field_sources_json, dict):
        for k, meta in existing.field_sources_json.items():
            if isinstance(meta, dict) and meta.get("source") == "manual_override":
                locked_fields.add(k)
                fields[k] = (existing.fields_json or {}).get(k)
                sources[k] = meta

    # Base fields from raw + AI (product_override)
    base_fields, base_sources = _build_base_fields(session, task=task)
    for k, v in base_fields.items():
        _set_field(fields, sources, warnings, key=k, value=v, source_meta=base_sources.get(k), priority="product_override", locked=locked_fields)

    # Apply enabled rules (priority desc)
    rules_query = (
        select(DefaultRule)
        .where(DefaultRule.enabled.is_(True))
        .order_by(DefaultRule.priority.desc(), DefaultRule.updated_at.desc(), DefaultRule.id.desc())
    )
    if selected_rule_id is not None:
        rules_query = rules_query.where(DefaultRule.id == selected_rule_id)
    rules = session.scalars(rules_query).all()

    context = _build_context(session, task=task, base_fields=fields)
    for rule in rules:
        priority_key = _rule_priority_key(rule)
        if priority_key not in PRIORITY_ORDER:
            continue
        if not _match_rule(rule, context):
            continue
        out = rule.values_json or rule.output_json or {}
        if not isinstance(out, dict):
            continue
        for k, v in out.items():
            _set_field(
                fields,
                sources,
                warnings,
                key=str(k),
                value=v,
                source_meta={
                    "source": rule.rule_type,
                    "rule_id": rule.id,
                    "rule_name": rule.name,
                    "priority": priority_key,
                    "applied_at": _now_iso(),
                },
                priority=priority_key,
                locked=locked_fields,
            )

    _apply_sensitive_linkage(fields, sources, warnings, locked_fields)
    _apply_sku_flatten(fields, sources, warnings, context, locked_fields)
    _apply_missing_warnings(fields, warnings)

    if existing is None:
        draft = ExportFieldDraft(
            product_task_id=task.id,
            fields_json=fields,
            field_sources_json=sources,
            warnings_json=warnings,
            status="ready",
        )
        session.add(draft)
        task.export_status = ExportStatus.ready.value
        session.add(task)
        session.commit()
        session.refresh(draft)
        return draft

    existing.fields_json = fields
    existing.field_sources_json = sources
    existing.warnings_json = warnings
    existing.status = "ready"
    session.add(existing)
    task.export_status = ExportStatus.ready.value
    session.add(task)
    session.commit()
    session.refresh(existing)
    return existing


def patch_export_fields_manual(
    session: Session,
    *,
    task: ProductTask,
    updates: dict[str, Any],
) -> ExportFieldDraft:
    draft = get_export_field_draft(session, task_id=task.id)
    if draft is None:
        draft = ExportFieldDraft(product_task_id=task.id, fields_json={}, field_sources_json={}, warnings_json=[], status="draft")
        session.add(draft)
        session.commit()
        session.refresh(draft)

    fields = dict(draft.fields_json or {})
    sources = dict(draft.field_sources_json or {})
    warnings: list[dict[str, Any]] = list(draft.warnings_json or [])

    for k, v in (updates or {}).items():
        key = str(k)
        fields[key] = v
        sources[key] = {"source": "manual_override", "applied_at": _now_iso(), "priority": "manual_override"}

    _apply_sensitive_linkage(fields, sources, warnings, locked_fields=set([str(k) for k in (updates or {}).keys()]))

    draft.fields_json = fields
    draft.field_sources_json = sources
    draft.warnings_json = warnings
    draft.status = "ready"
    session.add(draft)
    session.commit()
    session.refresh(draft)
    return draft


def get_export_field_candidates(session: Session, *, task: ProductTask) -> dict[str, dict[str, Any]]:
    raw = session.get(RawProduct, task.raw_product_id)
    ai = session.scalar(select(ProductAIResult).where(ProductAIResult.task_id == task.id))
    draft = get_export_field_draft(session, task_id=task.id)

    ai_category = None
    ai_title_cn = None
    ai_title_en = None
    if isinstance(ai, ProductAIResult):
        category_out = (ai.category_match or {}).get("output") if isinstance(ai.category_match, dict) else None
        title_pkg_out = (ai.title_package or {}).get("output") if isinstance(ai.title_package, dict) else None
        title_en_out = (ai.title_en or {}).get("output") if isinstance(ai.title_en, dict) else None
        if isinstance(category_out, dict):
            ai_category = category_out.get("best_path") or category_out.get("selected_category")
        if isinstance(title_pkg_out, dict):
            ai_title_cn = title_pkg_out.get("title_cn") or ai_title_cn
            ai_title_en = title_pkg_out.get("title_en") or ai_title_en
        if isinstance(title_en_out, dict):
            ai_title_en = ai_title_en or title_en_out.get("title") or title_en_out.get("title_en")

    current_fields = dict((draft.fields_json or {}) if draft is not None else {})
    manual_fields = dict((draft.fields_json or {}) if draft is not None else {})
    field_sources = dict((draft.field_sources_json or {}) if draft is not None else {})

    candidates: dict[str, dict[str, Any]] = {
        "product_title_cn": {
            "raw": raw.title if raw else None,
            "ai": ai_title_cn,
            "current": current_fields.get("product_title_cn") or task.title,
            "manual": manual_fields.get("product_title_cn")
            if str((field_sources.get("product_title_cn") or {}).get("source") or "") == "manual_override"
            else None,
        },
        "product_title_en": {
            "raw": raw.title if raw else None,
            "ai": ai_title_en,
            "current": current_fields.get("product_title_en"),
            "manual": manual_fields.get("product_title_en")
            if str((field_sources.get("product_title_en") or {}).get("source") or "") == "manual_override"
            else None,
        },
        "category_path": {
            "raw": raw.category_path if raw else None,
            "ai": ai_category,
            "current": current_fields.get("category_path") or task.selected_category_id,
            "manual": manual_fields.get("category_path")
            if str((field_sources.get("category_path") or {}).get("source") or "") == "manual_override"
            else None,
        },
        "selected_category_id": {
            "raw": raw.category_path if raw else None,
            "ai": ai_category,
            "current": current_fields.get("selected_category_id") or task.selected_category_id,
            "manual": manual_fields.get("selected_category_id")
            if str((field_sources.get("selected_category_id") or {}).get("source") or "") == "manual_override"
            else None,
        },
        "product_description": {
            "raw": raw.attributes_text if raw else None,
            "ai": None,
            "current": current_fields.get("product_description"),
            "manual": manual_fields.get("product_description")
            if str((field_sources.get("product_description") or {}).get("source") or "") == "manual_override"
            else None,
        },
        "raw_title": {
            "raw": raw.title if raw else None,
            "ai": ai_title_cn,
            "current": current_fields.get("raw_title"),
            "manual": None,
        },
        "platform": {
            "raw": raw.platform if raw else None,
            "ai": None,
            "current": current_fields.get("platform"),
            "manual": manual_fields.get("platform")
            if str((field_sources.get("platform") or {}).get("source") or "") == "manual_override"
            else None,
        },
        "platform_sku": {
            "raw": raw.platform_sku if raw else None,
            "ai": None,
            "current": current_fields.get("platform_sku"),
            "manual": manual_fields.get("platform_sku")
            if str((field_sources.get("platform_sku") or {}).get("source") or "") == "manual_override"
            else None,
        },
        "source_url": {
            "raw": raw.url if raw else task.source_url,
            "ai": None,
            "current": current_fields.get("source_url") or task.source_url,
            "manual": manual_fields.get("source_url")
            if str((field_sources.get("source_url") or {}).get("source") or "") == "manual_override"
            else None,
        },
    }
    return candidates


def patch_export_field_choice(
    session: Session,
    *,
    task: ProductTask,
    field_key: str,
    selected_source: str,
    manual_value: Any = None,
) -> ExportFieldDraft:
    draft = get_export_field_draft(session, task_id=task.id)
    if draft is None:
        draft = apply_default_rules(session, task=task)

    candidates = get_export_field_candidates(session, task=task)
    candidate_set = candidates.get(field_key, {})
    selected_source = selected_source.strip().lower()
    if selected_source not in {"raw", "ai", "manual"}:
        raise ValueError("selected_source must be raw | ai | manual")

    if selected_source == "manual":
        value = manual_value
        if value in (None, ""):
            raise ValueError("manual_value is required when selected_source=manual")
        source_meta = {"source": "manual_override", "applied_at": _now_iso(), "priority": "manual_override"}
    else:
        value = candidate_set.get(selected_source)
        if value in (None, ""):
            raise ValueError(f"{field_key} has no {selected_source} candidate value")
        source_meta = {
            "source": f"{selected_source}_selected",
            "applied_at": _now_iso(),
            "priority": "manual_override",
        }

    fields = dict(draft.fields_json or {})
    sources = dict(draft.field_sources_json or {})
    warnings: list[dict[str, Any]] = list(draft.warnings_json or [])
    fields[field_key] = value
    sources[field_key] = source_meta

    draft.fields_json = fields
    draft.field_sources_json = sources
    draft.warnings_json = warnings
    draft.status = "ready"
    session.add(draft)
    session.commit()
    session.refresh(draft)
    return draft


def _build_base_fields(session: Session, *, task: ProductTask) -> tuple[dict[str, Any], dict[str, Any]]:
    raw = session.get(RawProduct, task.raw_product_id)
    ai = session.scalar(select(ProductAIResult).where(ProductAIResult.task_id == task.id))

    out: dict[str, Any] = {
        "task_id": task.id,
        "raw_product_id": task.raw_product_id,
        "source_url": task.source_url or (raw.url if raw else None),
        "platform": raw.platform if raw else task.product_platform,
        "platform_sku": raw.platform_sku if raw else task.platform_sku,
        "source_id": raw.source_id if raw else task.source_id,
        "raw_title": raw.title if raw else task.title,
        "selected_category_id": task.selected_category_id,
    }
    sources: dict[str, Any] = {k: {"source": "raw_source"} for k in out.keys()}

    if isinstance(ai, ProductAIResult):
        category_out = (ai.category_match or {}).get("output") if isinstance(ai.category_match, dict) else None
        title_pkg_out = (ai.title_package or {}).get("output") if isinstance(ai.title_package, dict) else None
        cat_path = (category_out or {}).get("best_path") if isinstance(category_out, dict) else None
        if isinstance(category_out, dict):
            cat_path = cat_path or category_out.get("selected_category")
        title_cn = (title_pkg_out or {}).get("title_cn") if isinstance(title_pkg_out, dict) else None
        title_en = (title_pkg_out or {}).get("title_en") if isinstance(title_pkg_out, dict) else None
        if title_en is None and isinstance(ai.title_en, dict):
            title_en = (((ai.title_en or {}).get("output") or {}).get("title"))

        effective_category_path = task.selected_category_id or cat_path or (raw.category_path if raw else None)
        ai_fields = {
            "category_path": effective_category_path,
            "selected_category_id": task.selected_category_id or cat_path,
            "product_title_cn": title_cn,
            "product_title_en": title_en,
        }
        for k, v in ai_fields.items():
            if v is not None:
                out[k] = v
                sources[k] = {"source": "ai_generated"}

    # defaults scaffold
    out.setdefault("is_sensitive", False)
    sources.setdefault("is_sensitive", {"source": "fixed_default"})
    return out, sources


def _build_context(session: Session, *, task: ProductTask, base_fields: dict[str, Any]) -> dict[str, Any]:
    raw = session.get(RawProduct, task.raw_product_id)
    ai = session.scalar(select(ProductAIResult).where(ProductAIResult.task_id == task.id))

    category_path = base_fields.get("category_path") or base_fields.get("selected_category_id") or ""
    title = str(base_fields.get("product_title_cn") or base_fields.get("raw_title") or "")
    description = str(base_fields.get("product_description") or "")

    return {
        "task_id": task.id,
        "platform": (task.product_platform or (raw.platform if raw else "") or "").strip().lower(),
        "site": str((base_fields.get("site") or "")).strip().lower(),
        "fulfillment_mode": str((base_fields.get("fulfillment_mode") or "")).strip().lower(),
        "selected_category_id": task.selected_category_id or category_path,
        "category_path": category_path,
        "title": title,
        "description": description,
        "raw": raw,
        "ai": ai,
        "dna_keywords": [],
        "raw_sku_text": raw.sku_text if raw else None,
        "fields": base_fields,
    }


def _rule_priority_key(rule: DefaultRule) -> str:
    t = (rule.rule_type or "").strip()
    if t == "category_default":
        return "category_default"
    if t == "keyword_rule":
        return "keyword_rule"
    if t == "fixed_default":
        return "global_default"
    # other types fall back to keyword_rule-ish behavior for now
    if t in ("sensitive_rule", "sku_flatten_rule"):
        return "keyword_rule"
    return "global_default"


def _match_rule(rule: DefaultRule, ctx: dict[str, Any]) -> bool:
    match = rule.conditions_json or rule.match_json or {}
    if not isinstance(match, dict):
        return False

    if rule.platform and str(ctx.get("platform") or "").strip().lower() != str(rule.platform).strip().lower():
        return False
    if rule.site and str(ctx.get("site") or "").strip().lower() != str(rule.site).strip().lower():
        return False
    if rule.fulfillment_mode and str(ctx.get("fulfillment_mode") or "").strip().lower() != str(rule.fulfillment_mode).strip().lower():
        return False
    if rule.category_path:
        hay = str(ctx.get("category_path") or "").strip().lower()
        if str(rule.category_path).strip().lower() not in hay:
            return False

    # global: always match when no constraints
    if not match:
        return True

    # category id exact
    cat_id = match.get("category_id")
    if cat_id is not None:
        wanted = str(cat_id).strip()
        selected = str(ctx.get("selected_category_id") or "").strip()
        path_value = str(ctx.get("category_path") or "").strip()
        if selected != wanted and path_value != wanted:
            return False

    # category path substring
    c_contains = match.get("category_path_contains")
    if c_contains is not None:
        hay = str(ctx.get("category_path") or "").lower()
        if isinstance(c_contains, list):
            needles = [str(item).strip().lower() for item in c_contains if str(item).strip()]
            if needles and not any(item in hay for item in needles):
                return False
        else:
            needle = str(c_contains).strip().lower()
            if needle and needle not in hay:
                return False

    # keyword match in title/desc
    keywords = match.get("keywords")
    if keywords is not None:
        if not isinstance(keywords, list) or not keywords:
            return False
        hay = (str(ctx.get("title") or "") + "\n" + str(ctx.get("description") or "")).lower()
        ok = any(str(k).lower() in hay for k in keywords if k is not None and str(k).strip())
        if not ok:
            return False

    # dna keyword match
    dna_keywords = match.get("dna_keywords")
    if dna_keywords is not None:
        if not isinstance(dna_keywords, list) or not dna_keywords:
            return False
        have = set([str(x).lower() for x in (ctx.get("dna_keywords") or [])])
        want = set([str(x).lower() for x in dna_keywords if x is not None])
        if not (have & want):
            return False

    # field equals
    field_equals = match.get("field_equals")
    if field_equals is not None:
        if not isinstance(field_equals, dict):
            return False
        for k, v in field_equals.items():
            if (ctx.get("fields") or {}).get(str(k)) != v:
                return False

    return True


def _set_field(
    fields: dict[str, Any],
    sources: dict[str, Any],
    warnings: list[dict[str, Any]],
    *,
    key: str,
    value: Any,
    source_meta: dict[str, Any] | None,
    priority: str,
    locked: set[str],
) -> None:
    if key in locked:
        return

    existing_source = sources.get(key)
    existing_priority = None
    if isinstance(existing_source, dict):
        existing_priority = existing_source.get("priority")
    existing_rank = PRIORITY_ORDER.get(str(existing_priority), PRIORITY_ORDER.get("global_default"))
    new_rank = PRIORITY_ORDER.get(priority, 0)

    if key not in fields:
        fields[key] = value
        meta = dict(source_meta or {})
        meta.setdefault("priority", priority)
        meta.setdefault("source", meta.get("source") or "rule_engine")
        sources[key] = meta
        return

    if new_rank < existing_rank:
        return

    if new_rank == existing_rank and fields.get(key) not in (None, "", []) and value not in (None, "", []):
        warnings.append(
            {
                "type": "conflict",
                "field": key,
                "message": "same-priority rules conflict; kept latest",
                "existing": fields.get(key),
                "incoming": value,
                "at": _now_iso(),
            }
        )

    fields[key] = value
    meta = dict(source_meta or {})
    meta.setdefault("priority", priority)
    meta.setdefault("source", meta.get("source") or "rule_engine")
    sources[key] = meta


def _apply_missing_warnings(fields: dict[str, Any], warnings: list[dict[str, Any]]) -> None:
    required = ["product_title_cn", "category_path"]
    for f in required:
        v = fields.get(f)
        if v is None or (isinstance(v, str) and not v.strip()):
            warnings.append({"type": "missing", "field": f, "message": "required field missing", "at": _now_iso()})


def _apply_sensitive_linkage(
    fields: dict[str, Any],
    sources: dict[str, Any],
    warnings: list[dict[str, Any]],
    locked_fields: set[str],
) -> None:
    is_sensitive = fields.get("is_sensitive")
    if is_sensitive in (False, "false", 0, "0", None):
        # clear sensitive subfields
        for k in list(fields.keys()):
            if k.startswith("sensitive_") and k not in locked_fields:
                fields[k] = None
                sources[k] = {"source": "sensitive_rule", "priority": "keyword_rule", "applied_at": _now_iso()}
    else:
        # if sensitive but missing details -> warning
        required = ["sensitive_type"]
        for k in required:
            if not fields.get(k):
                warnings.append({"type": "missing", "field": k, "message": "sensitive field required", "at": _now_iso()})


def _apply_sku_flatten(
    fields: dict[str, Any],
    sources: dict[str, Any],
    warnings: list[dict[str, Any]],
    ctx: dict[str, Any],
    locked_fields: set[str],
) -> None:
    raw_text = ctx.get("raw_sku_text")
    if not raw_text:
        return

    spec1_name, spec2_name = _infer_specs_from_sku_text(str(raw_text))
    if spec1_name:
        _set_field(
            fields,
            sources,
            warnings,
            key="sku_spec1_name",
            value=spec1_name,
            source_meta={"source": "sku_flatten_rule", "applied_at": _now_iso()},
            priority="keyword_rule",
            locked=locked_fields,
        )
    if spec2_name:
        _set_field(
            fields,
            sources,
            warnings,
            key="sku_spec2_name",
            value=spec2_name,
            source_meta={"source": "sku_flatten_rule", "applied_at": _now_iso()},
            priority="keyword_rule",
            locked=locked_fields,
        )


def _infer_specs_from_sku_text(text: str) -> tuple[str | None, str | None]:
    t = text.strip()
    # Try JSON
    try:
        obj = json.loads(t)
        if isinstance(obj, dict):
            for key in ("spec1", "spec_1", "规格1", "Spec1"):
                if key in obj and isinstance(obj[key], str) and obj[key].strip():
                    spec1 = obj[key].strip()
                    spec2 = None
                    for k2 in ("spec2", "spec_2", "规格2", "Spec2"):
                        if k2 in obj and isinstance(obj[k2], str) and obj[k2].strip():
                            spec2 = obj[k2].strip()
                            break
                    return spec1, spec2
    except Exception:
        pass

    # Heuristic: look for "规格1: xxx" "规格2: yyy"
    m1 = re.search(r"(规格1|规格一|Spec1|spec1)[:：]\\s*([^\\n,;，；]+)", t, re.IGNORECASE)
    m2 = re.search(r"(规格2|规格二|Spec2|spec2)[:：]\\s*([^\\n,;，；]+)", t, re.IGNORECASE)
    spec1 = m1.group(2).strip() if m1 else None
    spec2 = m2.group(2).strip() if m2 else None
    return spec1, spec2


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
