from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from openpyxl import load_workbook
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.export_batch import ExportBatch
from app.models.export_field_draft import ExportFieldDraft
from app.models.export_field_mapping import ExportFieldMapping
from app.models.export_record import ExportRecord
from app.models.export_template import ExportTemplate
from app.models.product_asset import ProductAsset
from app.models.product_task import ProductTask
from app.services.export_fields import apply_default_rules
from app.services.export_templates import get_default_export_template


_HTTP_RE = re.compile(r"^https?://", re.IGNORECASE)


@dataclass(frozen=True)
class PreviewRow:
    task_id: int
    export_fields: dict[str, Any]
    field_sources: dict[str, Any]
    validation: dict[str, Any]


def preview_exports(session: Session, *, product_task_ids: list[int]) -> dict[str, Any]:
    template = get_default_export_template(session, platform="temu")
    if template is None:
        raise RuntimeError("No default export template configured")

    mappings = session.scalars(
        select(ExportFieldMapping)
        .where(ExportFieldMapping.template_id == template.id)
        .order_by(ExportFieldMapping.column_index.asc(), ExportFieldMapping.id.asc())
    ).all()
    _validate_export_configuration(template=template, mappings=mappings)

    rows: list[PreviewRow] = []
    for task_id in product_task_ids:
        task = session.get(ProductTask, task_id)
        if task is None:
            continue
        draft = session.scalar(select(ExportFieldDraft).where(ExportFieldDraft.product_task_id == task_id).limit(1))
        if draft is None:
            draft = apply_default_rules(session, task=task)
        export_fields, field_sources, validation = _build_row(session, task=task, template=template, mappings=mappings, draft=draft)
        rows.append(PreviewRow(task_id=task_id, export_fields=export_fields, field_sources=field_sources, validation=validation))

    return {
        "template": {
            "id": template.id,
            "name": template.name,
            "version": template.version,
            "platform": template.platform,
            "header_row_index": template.header_row_index,
            "file_path": template.file_path,
        },
        "rows": [
            {
                "product_task_id": r.task_id,
                "export_fields": r.export_fields,
                "field_sources": r.field_sources,
                "validation_result": r.validation,
            }
            for r in rows
        ],
    }


def run_exports(session: Session, *, product_task_ids: list[int]) -> dict[str, Any]:
    template = get_default_export_template(session, platform="temu")
    if template is None:
        raise RuntimeError("No default export template configured")

    mappings = session.scalars(
        select(ExportFieldMapping)
        .where(ExportFieldMapping.template_id == template.id)
        .order_by(ExportFieldMapping.column_index.asc(), ExportFieldMapping.id.asc())
    ).all()
    _validate_export_configuration(template=template, mappings=mappings)

    batch_no = _new_batch_no()
    batch = ExportBatch(
        batch_no=batch_no,
        template_id=template.id,
        template_version=template.version,
        total_count=len(product_task_ids),
        success_count=0,
        failed_count=0,
        status="running",
    )
    session.add(batch)
    session.commit()
    session.refresh(batch)

    # Build all rows first and persist export_records
    built_rows: list[tuple[int, dict[str, Any], dict[str, Any], dict[str, Any]]] = []
    blocking_errors: list[str] = []
    for task_id in product_task_ids:
        task = session.get(ProductTask, task_id)
        if task is None:
            continue
        draft = session.scalar(select(ExportFieldDraft).where(ExportFieldDraft.product_task_id == task_id).limit(1))
        if draft is None:
            draft = apply_default_rules(session, task=task)
        export_fields, field_sources, validation = _build_row(session, task=task, template=template, mappings=mappings, draft=draft)
        status = "success" if not (validation.get("errors") or []) else "failed"
        if status == "failed":
            blocking_errors.append(f"task_id={task_id} 缺少必填字段或字段校验失败")
        rec = ExportRecord(
            product_task_id=task_id,
            template_id=template.id,
            template_version=template.version,
            export_fields_json=export_fields,
            field_sources_json=field_sources,
            validation_result_json=validation,
            status=status,
            batch_no=batch_no,
        )
        session.add(rec)
        session.commit()
        session.refresh(rec)
        built_rows.append((task_id, export_fields, field_sources, validation))
        if status == "success":
            batch.success_count += 1
        else:
            batch.failed_count += 1
        session.add(batch)
        session.commit()

    if blocking_errors:
        batch.status = "failed"
        session.add(batch)
        session.commit()
        raise RuntimeError("导出前校验未通过：" + "；".join(blocking_errors[:5]))

    # Generate excel
    exported_rel_path = _write_excel(template=template, mappings=mappings, rows=built_rows, batch_no=batch_no)
    batch.exported_file_path = exported_rel_path
    batch.status = "success"
    session.add(batch)
    session.commit()
    session.refresh(batch)

    # backfill records with file path
    session.query(ExportRecord).filter(ExportRecord.batch_no == batch_no).update({"exported_file_path": exported_rel_path})
    session.commit()

    settings = get_settings()
    download_url = f"{settings.public_base_url}/storage/{exported_rel_path}"
    return {"batch_no": batch_no, "batch": batch, "download_url": download_url}


def _validate_export_configuration(*, template: ExportTemplate, mappings: list[ExportFieldMapping]) -> None:
    enabled_mappings = [item for item in mappings if item.enabled]
    if not enabled_mappings:
        raise RuntimeError(f"导出模板 {template.name} 未配置字段映射规则")
    required_mappings = [item for item in enabled_mappings if item.required]
    if not required_mappings:
        raise RuntimeError(f"导出模板 {template.name} 未配置必填字段")


def _build_row(
    session: Session,
    *,
    task: ProductTask,
    template: ExportTemplate,
    mappings: list[ExportFieldMapping],
    draft: ExportFieldDraft | None,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    export_fields: dict[str, Any] = {}
    field_sources: dict[str, Any] = {}
    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []

    draft_fields = (draft.fields_json or {}) if draft is not None else {}

    selected_assets = _load_selected_assets(session, task_id=task.id)

    for m in mappings:
        key = m.field_key
        value = None
        source_meta: dict[str, Any] = {"mapping_id": m.id, "source_type": m.source_type, "source_path": m.source_path}

        if not m.enabled:
            value = ""
            source_meta["source_type"] = "disabled"
        elif m.source_type == "draft":
            path = (m.source_path or "").strip()
            path = path.removeprefix("export_field_drafts.").removeprefix("fields.")
            value = draft_fields.get(path)
        elif m.source_type == "asset":
            slots = _parse_slots(m.source_path or "")
            urls = [selected_assets.get(s) for s in slots]
            urls = [u for u in urls if u]
            value = ",".join(urls)
        elif m.source_type == "task":
            value = getattr(task, (m.source_path or "").strip(), None)
        elif m.source_type == "fixed":
            value = m.default_value
        else:
            value = None

        if (value is None or value == "") and m.default_value:
            value = m.default_value
            source_meta["source_type"] = source_meta.get("source_type") or "fixed"
            source_meta["default_applied"] = True

        export_fields[key] = value if value is not None else ""
        field_sources[key] = source_meta

        # validations
        if m.required and (value is None or (isinstance(value, str) and not value.strip())):
            errors.append({"field_key": key, "field_name": m.field_name, "type": "missing", "message": "required field missing"})

        if m.source_type == "asset" or ("图" in (m.field_name or "")):
            if value:
                parts = [p.strip() for p in str(value).split(",") if p.strip()]
                bad = [p for p in parts if not _HTTP_RE.match(p)]
                if bad:
                    errors.append({"field_key": key, "field_name": m.field_name, "type": "invalid_url", "message": "image url invalid", "bad": bad[:3]})
            elif m.required:
                errors.append({"field_key": key, "field_name": m.field_name, "type": "missing_image", "message": "image url missing"})

    return export_fields, field_sources, {"errors": errors, "warnings": warnings}


def _load_selected_assets(session: Session, *, task_id: int) -> dict[str, str]:
    rows = session.scalars(
        select(ProductAsset)
        .where(ProductAsset.product_task_id == task_id, ProductAsset.selected_for_export.is_(True))
        .order_by(ProductAsset.created_at.desc(), ProductAsset.id.desc())
    ).all()
    out: dict[str, str] = {}
    for a in rows:
        if a.public_url:
            out[a.slot] = a.public_url
    return out


def _parse_slots(source_path: str) -> list[str]:
    s = (source_path or "").strip()
    if not s:
        return []
    if s.startswith("assets."):
        # assets.carousel_1.selected.public_url
        parts = s.split(".")
        if len(parts) >= 2:
            return [parts[1]]
    # comma list
    return [p.strip() for p in s.split(",") if p.strip()]


def _write_excel(
    *,
    template: ExportTemplate,
    mappings: list[ExportFieldMapping],
    rows: list[tuple[int, dict[str, Any], dict[str, Any], dict[str, Any]]],
    batch_no: str,
) -> str:
    wb = load_workbook(template.file_path)
    ws = wb["Sheet1"] if "Sheet1" in wb.sheetnames else wb[wb.sheetnames[0]]
    start_row = int(template.header_row_index) + 1

    col_by_key = {m.field_key: m.column_index for m in mappings}

    for idx, (_task_id, export_fields, _sources, _validation) in enumerate(rows):
        r = start_row + idx
        for key, value in export_fields.items():
            col = col_by_key.get(key)
            if not col:
                continue
            ws.cell(row=r, column=col).value = value

    settings = get_settings()
    root = Path(settings.storage_root)
    out_dir = root / settings.exports_dir_name
    out_dir.mkdir(parents=True, exist_ok=True)
    filename = f"temu-export-{batch_no}.xlsx"
    out_path = out_dir / filename
    wb.save(out_path)
    # return storage relative path for static mount
    rel = f"{settings.exports_dir_name}/{filename}"
    return rel


def _new_batch_no() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S") + "-" + uuid.uuid4().hex[:8]
