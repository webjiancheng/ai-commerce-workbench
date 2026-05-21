from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.schemas.export_template import ExportTemplateCreate, ExportTemplateOut, ExportTemplateUpdate
from app.services.export_templates import (
    create_export_template,
    get_default_export_template,
    get_export_template,
    list_export_templates,
    set_default_export_template,
    update_export_template,
)


router = APIRouter(tags=["export-templates"])


@router.get("/api/export-templates", response_model=list[ExportTemplateOut])
def list_export_templates_endpoint(session: Session = Depends(get_db_session)) -> list[ExportTemplateOut]:
    return [ExportTemplateOut.model_validate(t) for t in list_export_templates(session)]


@router.post("/api/export-templates", response_model=ExportTemplateOut)
def create_export_template_endpoint(
    payload: ExportTemplateCreate = Body(...),
    session: Session = Depends(get_db_session),
) -> ExportTemplateOut:
    try:
        tpl = create_export_template(session, payload)
        return ExportTemplateOut.model_validate(tpl)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/api/export-templates/{template_id}", response_model=ExportTemplateOut)
def get_export_template_endpoint(template_id: int, session: Session = Depends(get_db_session)) -> ExportTemplateOut:
    tpl = get_export_template(session, template_id)
    if tpl is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Export template not found")
    return ExportTemplateOut.model_validate(tpl)


@router.patch("/api/export-templates/{template_id}", response_model=ExportTemplateOut)
def patch_export_template_endpoint(
    template_id: int,
    payload: ExportTemplateUpdate = Body(...),
    session: Session = Depends(get_db_session),
) -> ExportTemplateOut:
    tpl = get_export_template(session, template_id)
    if tpl is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Export template not found")
    try:
        updated = update_export_template(session, tpl, payload)
        return ExportTemplateOut.model_validate(updated)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/api/export-templates/{template_id}/set-default")
def set_default_export_template_endpoint(
    template_id: int, session: Session = Depends(get_db_session)
) -> dict[str, object]:
    tpl = get_export_template(session, template_id)
    if tpl is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Export template not found")
    set_default_export_template(session, template_id=template_id)
    return {"ok": True, "id": template_id}


@router.get("/api/export-templates/{template_id}/fields")
def get_export_template_fields_endpoint(
    template_id: int, session: Session = Depends(get_db_session)
) -> dict[str, object]:
    tpl = get_export_template(session, template_id)
    if tpl is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Export template not found")
    return {"ok": True, "template_id": template_id, "fields": tpl.fields_json or []}


@router.get("/api/export-template/fields")
def get_current_template_fields_endpoint(session: Session = Depends(get_db_session)) -> dict[str, object]:
    tpl = get_default_export_template(session, platform="temu")
    if tpl is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Default export template not found")
    return {"ok": True, "template_id": tpl.id, "fields": tpl.fields_json or [], "version": tpl.version}

