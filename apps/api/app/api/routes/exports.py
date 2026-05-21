from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.models.export_batch import ExportBatch
from app.schemas.export_batch import ExportBatchOut
from app.services.export_runner import preview_exports, run_exports


router = APIRouter(tags=["exports"])


class ExportRunRequest(BaseModel):
    product_task_ids: list[int] = Field(default_factory=list)


@router.post("/api/exports/preview")
def preview_exports_endpoint(
    payload: ExportRunRequest = Body(...),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    if not payload.product_task_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="product_task_ids required")
    try:
        out = preview_exports(session, product_task_ids=payload.product_task_ids)
        return {"ok": True, **out}
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/api/exports/run")
def run_exports_endpoint(
    payload: ExportRunRequest = Body(...),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    if not payload.product_task_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="product_task_ids required")
    try:
        out = run_exports(session, product_task_ids=payload.product_task_ids)
        batch = out["batch"]
        return {
            "ok": True,
            "batch_no": out["batch_no"],
            "batch": ExportBatchOut.model_validate(batch),
            "download_url": out["download_url"],
        }
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/api/exports/history", response_model=list[ExportBatchOut])
def list_export_history_endpoint(
    limit: int = Query(default=20, ge=1, le=200),
    session: Session = Depends(get_db_session),
) -> list[ExportBatchOut]:
    batches = session.scalars(select(ExportBatch).order_by(ExportBatch.created_at.desc()).limit(limit)).all()
    return [ExportBatchOut.model_validate(b) for b in batches]


@router.get("/api/exports/{batch_id}/download")
def download_export_batch_endpoint(batch_id: int, session: Session = Depends(get_db_session)) -> dict[str, object]:
    batch = session.get(ExportBatch, batch_id)
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Export batch not found")
    if not batch.exported_file_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Export file not ready")
    from app.core.config import get_settings

    settings = get_settings()
    return {"ok": True, "download_url": f"{settings.public_base_url}/storage/{batch.exported_file_path}"}

