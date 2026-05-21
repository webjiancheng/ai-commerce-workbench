from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.models.product_task import ProductTask
from app.services.exceptions import recalculate_exceptions


router = APIRouter(tags=["exceptions"])


@router.post("/api/product-tasks/{task_id}/recalculate-exceptions")
def recalc_exceptions_endpoint(task_id: int, session: Session = Depends(get_db_session)) -> dict[str, object]:
    task = session.get(ProductTask, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product task not found")
    updated = recalculate_exceptions(session, task=task)
    return {"ok": True, "task_id": task_id, "exception_level": updated.exception_level, "reasons": updated.exception_reasons_json}

