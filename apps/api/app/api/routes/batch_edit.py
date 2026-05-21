from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.models.batch_edit_queue import BatchEditQueueItem
from app.models.product_asset import ProductAsset


router = APIRouter(tags=["batch-edit"])


class AddToBatchEditRequest(BaseModel):
    operation_type: str = Field(min_length=1, max_length=64)
    payload_json: dict = Field(default_factory=dict)


@router.post("/api/assets/{asset_id}/add-to-batch-edit")
def add_to_batch_edit_endpoint(
    asset_id: int,
    payload: AddToBatchEditRequest = Body(...),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    asset = session.get(ProductAsset, asset_id)
    if asset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    item = BatchEditQueueItem(
        product_task_id=asset.product_task_id,
        asset_id=asset.id,
        slot=asset.slot,
        operation_type=payload.operation_type,
        status="queued",
        payload_json=payload.payload_json or {},
    )
    session.add(item)
    session.commit()
    session.refresh(item)
    return {"ok": True, "id": item.id}


@router.get("/api/batch-edit-queue")
def list_batch_edit_queue_endpoint(
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    q = select(BatchEditQueueItem).order_by(BatchEditQueueItem.created_at.desc(), BatchEditQueueItem.id.desc())
    if status_filter:
        q = q.where(BatchEditQueueItem.status == status_filter)
    items = session.scalars(q.limit(limit)).all()
    return {
        "ok": True,
        "items": [
            {
                "id": i.id,
                "product_task_id": i.product_task_id,
                "asset_id": i.asset_id,
                "slot": i.slot,
                "operation_type": i.operation_type,
                "status": i.status,
                "payload_json": i.payload_json,
                "created_at": i.created_at,
            }
            for i in items
        ],
    }

