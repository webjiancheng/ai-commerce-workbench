from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.task_status import CategoryStatus, ExportStatus, ImageStatus, TaskMainStatus, TitleStatus
from app.models.export_field_draft import ExportFieldDraft
from app.models.export_record import ExportRecord
from app.models.image_generation_job import ImageGenerationJob
from app.models.product_ai_result import ProductAIResult
from app.models.product_asset import ProductAsset
from app.models.product_task import ProductTask


def recalculate_exceptions(session: Session, *, task: ProductTask) -> ProductTask:
    reasons: list[dict[str, Any]] = []
    level: str | None = None
    status: str | None = None
    last_error: str | None = None

    ai = session.scalar(select(ProductAIResult).where(ProductAIResult.task_id == task.id))
    draft = session.scalar(select(ExportFieldDraft).where(ExportFieldDraft.product_task_id == task.id))

    # low confidence category
    if task.category_status == CategoryStatus.low_confidence.value:
        reasons.append({"code": "category_low_confidence", "level": "warning"})
        level = _max_level(level, "warning")

    # AI failures
    if task.main_status == TaskMainStatus.failed.value or task.title_status == TitleStatus.failed.value:
        reasons.append({"code": "ai_failed", "level": "failed"})
        level = _max_level(level, "failed")
        status = "failed"

    # ProductDNA missing
    if ai is None or not ((ai.product_dna or {}).get("output") if isinstance(ai, ProductAIResult) else None):
        # Only blocking when task already in AI ready or later
        if task.main_status not in (TaskMainStatus.draft.value, TaskMainStatus.collected.value, TaskMainStatus.normalized.value):
            reasons.append({"code": "product_dna_missing", "level": "blocking"})
            level = _max_level(level, "blocking")

    # image generation failures
    failed_image_jobs = session.scalar(
        select(func.count()).select_from(ImageGenerationJob).where(
            ImageGenerationJob.product_task_id == task.id, ImageGenerationJob.status == "failed"
        )
    ) or 0
    if failed_image_jobs:
        reasons.append({"code": "image_job_failed", "level": "warning", "count": int(failed_image_jobs)})
        level = _max_level(level, "warning")

    # required final images for export (carousel_1~4)
    for slot in ("carousel_1", "carousel_2", "carousel_3", "carousel_4"):
        has_final = session.scalar(
            select(func.count()).select_from(ProductAsset).where(
                ProductAsset.product_task_id == task.id,
                ProductAsset.slot == slot,
                ProductAsset.selected_for_export.is_(True),
                ProductAsset.public_url.is_not(None),
            )
        )
        if not has_final:
            reasons.append({"code": "missing_final_image", "level": "blocking", "slot": slot})
            level = _max_level(level, "blocking")

    # export draft missing / warnings
    if draft is None:
        reasons.append({"code": "export_draft_missing", "level": "warning"})
        level = _max_level(level, "warning")
    else:
        for w in (draft.warnings_json or []):
            if isinstance(w, dict) and w.get("type") == "missing":
                reasons.append({"code": "export_draft_missing_field", "level": "blocking", "field": w.get("field")})
                level = _max_level(level, "blocking")

    # export validation failure from latest export_record
    last_record = session.scalar(
        select(ExportRecord)
        .where(ExportRecord.product_task_id == task.id)
        .order_by(ExportRecord.created_at.desc(), ExportRecord.id.desc())
        .limit(1)
    )
    if last_record is not None:
        errs = (last_record.validation_result_json or {}).get("errors")
        if isinstance(errs, list) and errs:
            reasons.append({"code": "export_validation_failed", "level": "blocking", "count": len(errs)})
            level = _max_level(level, "blocking")
            last_error = str(errs[0].get("message") if isinstance(errs[0], dict) else "export validation failed")

    # derive status
    if level is None:
        status = None
    else:
        status = "exception"

    task.exception_level = level
    task.exception_status = status
    task.exception_reasons_json = reasons
    if last_error:
        task.last_error_message = last_error
    task.exception_updated_at = datetime.now(timezone.utc)
    session.add(task)
    session.commit()
    session.refresh(task)
    return task


def _max_level(current: str | None, incoming: str) -> str:
    order = {"warning": 1, "blocking": 2, "failed": 3}
    if current is None:
        return incoming
    return incoming if order.get(incoming, 0) > order.get(current, 0) else current

