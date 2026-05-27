from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
API_ROOT = REPO_ROOT / "apps" / "api"
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from sqlalchemy import select  # noqa: E402

from app.db.session import SessionLocal  # noqa: E402
from app.models.ai_import_batch import AiImportBatch  # noqa: E402
from app.models.ai_import_draft import AiImportDraft  # noqa: E402
from app.models.default_rule import DefaultRule  # noqa: E402
from app.models.export_field_draft import ExportFieldDraft  # noqa: E402
from app.services.temu_upload_template import (  # noqa: E402
    LEGACY_FIELD_ALIASES,
    normalize_listing_field_key,
    normalize_listing_fields,
)


def collect_json_keys(value: Any) -> set[str]:
    keys: set[str] = set()
    if isinstance(value, dict):
        for key, inner in value.items():
            key_text = str(key).strip()
            if key_text:
                keys.add(key_text)
            keys |= collect_json_keys(inner)
    elif isinstance(value, list):
        for item in value:
            keys |= collect_json_keys(item)
    return keys


def summarize_legacy_keys(keys: set[str]) -> dict[str, str]:
    hits: dict[str, str] = {}
    for key in sorted(keys):
        if key in LEGACY_FIELD_ALIASES:
            hits[key] = LEGACY_FIELD_ALIASES[key]
    return hits


def audit_default_rules(session) -> dict[str, Any]:
    items = session.scalars(select(DefaultRule).order_by(DefaultRule.id.asc())).all()
    affected: list[dict[str, Any]] = []
    for item in items:
        raw = item.values_json or {}
        raw_keys = collect_json_keys(raw)
        legacy = summarize_legacy_keys(raw_keys)
        normalized = normalize_listing_fields(raw, keep_unknown=True, include_auxiliary=True)
        changed = normalized != raw
        if legacy or changed:
            affected.append(
                {
                    "id": item.id,
                    "name": item.name,
                    "legacy_keys": legacy,
                    "normalizes": changed,
                }
            )
    return {"total": len(items), "affected": affected}


def audit_export_field_drafts(session) -> dict[str, Any]:
    items = session.scalars(select(ExportFieldDraft).order_by(ExportFieldDraft.id.asc())).all()
    affected: list[dict[str, Any]] = []
    for item in items:
        raw_fields = item.fields_json or {}
        raw_sources = item.field_sources_json or {}
        raw_keys = collect_json_keys(raw_fields)
        legacy = summarize_legacy_keys(raw_keys)
        normalized_fields = normalize_listing_fields(raw_fields, keep_unknown=True, include_auxiliary=True)
        normalized_source_keys = {normalize_listing_field_key(key): value for key, value in raw_sources.items()}
        field_changed = normalized_fields != raw_fields
        source_changed = normalized_source_keys != raw_sources
        if legacy or field_changed or source_changed:
            affected.append(
                {
                    "id": item.id,
                    "product_task_id": item.product_task_id,
                    "legacy_keys": legacy,
                    "fields_normalize": field_changed,
                    "source_keys_normalize": source_changed,
                }
            )
    return {"total": len(items), "affected": affected}


def audit_ai_imports(session) -> dict[str, Any]:
    batches = session.scalars(select(AiImportBatch).order_by(AiImportBatch.id.asc())).all()
    drafts = session.scalars(select(AiImportDraft).order_by(AiImportDraft.id.asc())).all()

    affected_batches: list[dict[str, Any]] = []
    affected_drafts: list[dict[str, Any]] = []

    for item in batches:
        header_keys = {str(x).strip() for x in (item.parsed_headers_json or []) if str(x).strip()}
        common_keys = collect_json_keys(item.parsed_common_fields_json or {})
        row_keys = collect_json_keys(item.parsed_rows_json or [])
        legacy = summarize_legacy_keys(header_keys | common_keys | row_keys)
        normalized_headers = [normalize_listing_field_key(str(x).strip()) for x in (item.parsed_headers_json or []) if str(x).strip()]
        normalized_rows = [normalize_listing_fields(row or {}, keep_unknown=True, include_auxiliary=False) for row in (item.parsed_rows_json or [])]
        changed = normalized_headers != (item.parsed_headers_json or []) or normalized_rows != (item.parsed_rows_json or [])
        if legacy or changed:
            affected_batches.append(
                {
                    "id": item.id,
                    "name": item.name,
                    "legacy_keys": legacy,
                    "normalizes": changed,
                }
            )

    for item in drafts:
        header_keys = {str(x).strip() for x in (item.headers_json or []) if str(x).strip()}
        common_keys = collect_json_keys(item.common_fields_json or {})
        row_keys = collect_json_keys(item.rows_json or [])
        settings_keys = set(str(k).strip() for k in (item.field_settings_json or {}).keys())
        legacy = summarize_legacy_keys(header_keys | common_keys | row_keys | settings_keys)
        normalized_headers = [normalize_listing_field_key(str(x).strip()) for x in (item.headers_json or []) if str(x).strip()]
        normalized_settings = {normalize_listing_field_key(str(k).strip()): v for k, v in (item.field_settings_json or {}).items()}
        setting_misaligned = set(normalized_headers) != set(normalized_settings.keys())
        changed = normalized_headers != (item.headers_json or []) or setting_misaligned
        if legacy or changed:
            affected_drafts.append(
                {
                    "id": item.id,
                    "batch_id": item.batch_id,
                    "legacy_keys": legacy,
                    "headers_normalize": normalized_headers != (item.headers_json or []),
                    "field_settings_misaligned": setting_misaligned,
                }
            )

    return {
        "batch_total": len(batches),
        "draft_total": len(drafts),
        "affected_batches": affected_batches,
        "affected_drafts": affected_drafts,
    }


def main() -> int:
    session = SessionLocal()
    try:
        report = {
            "default_rules": audit_default_rules(session),
            "export_field_drafts": audit_export_field_drafts(session),
            "ai_imports": audit_ai_imports(session),
        }

        summary = Counter(
            {
                "default_rules_affected": len(report["default_rules"]["affected"]),
                "export_field_drafts_affected": len(report["export_field_drafts"]["affected"]),
                "ai_import_batches_affected": len(report["ai_imports"]["affected_batches"]),
                "ai_import_drafts_affected": len(report["ai_imports"]["affected_drafts"]),
            }
        )

        print(json.dumps({"summary": summary, "report": report}, ensure_ascii=False, indent=2))
        return 0
    finally:
        session.close()


if __name__ == "__main__":
    raise SystemExit(main())
