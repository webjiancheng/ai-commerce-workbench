from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.task_status import ExportStatus, ImageStatus, TaskMainStatus
from app.db.session import get_db_session
from app.models.cost_record import CostRecord
from app.models.product_task import ProductTask
from app.models.raw_product import RawProduct


router = APIRouter(tags=["dashboard"])


@router.get("/api/dashboard/stats")
def dashboard_stats_endpoint(session: Session = Depends(get_db_session)) -> dict[str, object]:
    today = datetime.now(timezone.utc).date()

    collected_today = session.scalar(
        select(func.count()).select_from(RawProduct).where(func.date(RawProduct.created_at) == today)
    ) or 0

    pending_ai = session.scalar(
        select(func.count()).select_from(ProductTask).where(ProductTask.main_status.in_([TaskMainStatus.collected.value, TaskMainStatus.normalized.value]))
    ) or 0

    pending_images = session.scalar(
        select(func.count()).select_from(ProductTask).where(ProductTask.image_status == ImageStatus.pending.value)
    ) or 0

    exceptions = session.scalar(
        select(func.count()).select_from(ProductTask).where(ProductTask.exception_level.is_not(None))
    ) or 0

    export_ready = session.scalar(
        select(func.count()).select_from(ProductTask).where(ProductTask.export_status == ExportStatus.ready.value)
    ) or 0

    export_failed = session.scalar(
        select(func.count()).select_from(ProductTask).where(ProductTask.export_status == ExportStatus.failed.value)
    ) or 0

    estimated_cost_today = session.scalar(
        select(func.coalesce(func.sum(CostRecord.estimated_cost), 0)).where(func.date(CostRecord.created_at) == today)
    ) or 0

    return {
        "ok": True,
        "today": str(today),
        "today_collected_raw_products": int(collected_today),
        "pending_ai_tasks": int(pending_ai),
        "pending_image_tasks": int(pending_images),
        "exception_tasks": int(exceptions),
        "export_ready_tasks": int(export_ready),
        "export_failed_tasks": int(export_failed),
        "today_estimated_cost": float(estimated_cost_today),
    }

