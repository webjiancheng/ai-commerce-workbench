from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.models.product_task import ProductTask
from app.schemas.export_field_draft import ExportFieldDraftOut
from app.services.export_fields import (
    apply_default_rules_with_options,
    get_export_field_candidates,
    get_export_field_draft,
    patch_export_field_choice,
    patch_export_fields_manual,
)


router = APIRouter(tags=["export-fields"])


class ApplyDefaultRulesRequest(BaseModel):
    default_rule_id: int | None = None


@router.get("/api/product-tasks/{task_id}/export-fields/preview")
def preview_export_fields_endpoint(
    task_id: int,
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    task = session.get(ProductTask, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product task not found")
    draft = get_export_field_draft(session, task_id=task_id)
    candidates = get_export_field_candidates(session, task=task)
    return {
        "ok": True,
        "task_id": task_id,
        "draft": ExportFieldDraftOut.model_validate(draft) if draft else None,
        "candidates": candidates,
    }


@router.post("/api/product-tasks/{task_id}/apply-default-rules")
def apply_default_rules_endpoint(
    task_id: int,
    payload: ApplyDefaultRulesRequest | None = Body(default=None),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    task = session.get(ProductTask, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product task not found")
    try:
        draft = apply_default_rules_with_options(
            session,
            task=task,
            selected_rule_id=payload.default_rule_id if payload else None,
        )
        return {"ok": True, "task_id": task_id, "draft": ExportFieldDraftOut.model_validate(draft)}
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


class PatchExportFieldsRequest(BaseModel):
    fields: dict[str, object] = Field(default_factory=dict)


class PatchExportFieldChoiceRequest(BaseModel):
    field_key: str = Field(min_length=1)
    selected_source: str = Field(min_length=1)
    manual_value: object | None = None


@router.patch("/api/product-tasks/{task_id}/export-fields")
def patch_export_fields_endpoint(
    task_id: int,
    payload: PatchExportFieldsRequest = Body(...),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    task = session.get(ProductTask, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product task not found")
    try:
        draft = patch_export_fields_manual(session, task=task, updates=payload.fields)
        return {"ok": True, "task_id": task_id, "draft": ExportFieldDraftOut.model_validate(draft)}
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.patch("/api/product-tasks/{task_id}/export-fields/choose")
def patch_export_field_choice_endpoint(
    task_id: int,
    payload: PatchExportFieldChoiceRequest = Body(...),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    task = session.get(ProductTask, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product task not found")
    try:
        draft = patch_export_field_choice(
            session,
            task=task,
            field_key=payload.field_key,
            selected_source=payload.selected_source,
            manual_value=payload.manual_value,
        )
        candidates = get_export_field_candidates(session, task=task)
        return {
            "ok": True,
            "task_id": task_id,
            "draft": ExportFieldDraftOut.model_validate(draft),
            "candidates": candidates,
        }
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
