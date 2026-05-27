from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from typing import Literal

from app.db.session import get_db_session
from app.models.product_task import ProductTask
from app.schemas.export_field_draft import ExportFieldDraftOut
from app.services.export_fields import (
    apply_default_rules_with_merge_mode,
    apply_default_rules_with_options,
    get_export_field_candidates,
    get_export_field_draft,
    patch_export_field_choice,
    patch_export_fields_manual,
)
from app.services.temu_upload_template import get_temu_upload_template_meta


router = APIRouter(tags=["export-fields"])


class ApplyDefaultRulesRequest(BaseModel):
    default_rule_id: int | None = None


class BatchApplyTemplateRequest(BaseModel):
    product_task_ids: list[int] = Field(default_factory=list)
    default_rule_id: int = Field(ge=1)
    overwrite_mode: Literal["fill_empty", "overwrite_system", "force_overwrite"] = "overwrite_system"


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
        "template_meta": get_temu_upload_template_meta(),
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


@router.post("/api/product-tasks/batch/apply-template")
def batch_apply_template_endpoint(
    payload: BatchApplyTemplateRequest = Body(...),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    task_ids = [int(task_id) for task_id in payload.product_task_ids if int(task_id) > 0]
    if not task_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="product_task_ids required")

    applied: list[dict[str, object]] = []
    missing_ids: list[int] = []
    for task_id in task_ids:
        task = session.get(ProductTask, task_id)
        if task is None:
            missing_ids.append(task_id)
            continue
        draft = apply_default_rules_with_merge_mode(
            session,
            task=task,
            selected_rule_id=payload.default_rule_id,
            overwrite_mode=payload.overwrite_mode,
        )
        applied.append(
            {
                "task_id": task_id,
                "draft": ExportFieldDraftOut.model_validate(draft).model_dump(),
            }
        )

    return {
        "ok": True,
        "default_rule_id": payload.default_rule_id,
        "overwrite_mode": payload.overwrite_mode,
        "requested_count": len(task_ids),
        "applied_count": len(applied),
        "missing_task_ids": missing_ids,
        "items": applied,
    }


class PatchExportFieldsRequest(BaseModel):
    fields: dict[str, object] = Field(default_factory=dict)


class BatchPatchExportFieldsRequest(BaseModel):
    product_task_ids: list[int] = Field(default_factory=list)
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


@router.post("/api/product-tasks/batch/patch-export-fields")
def batch_patch_export_fields_endpoint(
    payload: BatchPatchExportFieldsRequest = Body(...),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    task_ids = [int(task_id) for task_id in payload.product_task_ids if int(task_id) > 0]
    if not task_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="product_task_ids required")
    if not payload.fields:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="fields required")

    patched: list[dict[str, object]] = []
    missing_ids: list[int] = []
    for task_id in task_ids:
        task = session.get(ProductTask, task_id)
        if task is None:
            missing_ids.append(task_id)
            continue
        draft = patch_export_fields_manual(session, task=task, updates=payload.fields)
        patched.append(
            {
                "task_id": task_id,
                "draft": ExportFieldDraftOut.model_validate(draft).model_dump(),
            }
        )

    return {
        "ok": True,
        "requested_count": len(task_ids),
        "patched_count": len(patched),
        "missing_task_ids": missing_ids,
        "items": patched,
    }


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
