from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.schemas.export_field_mapping import (
    ExportFieldMappingBatchUpdate,
    ExportFieldMappingOut,
    ExportFieldMappingUpdate,
)
from app.services.export_mappings import (
    batch_update_export_field_mappings,
    get_export_field_mapping,
    list_export_field_mappings,
    update_export_field_mapping,
)


router = APIRouter(tags=["export-mappings"])


@router.get("/api/export-field-mappings", response_model=list[ExportFieldMappingOut])
def list_export_field_mappings_endpoint(
    template_id: int = Query(..., ge=1),
    session: Session = Depends(get_db_session),
) -> list[ExportFieldMappingOut]:
    items = list_export_field_mappings(session, template_id=template_id)
    return [ExportFieldMappingOut.model_validate(i) for i in items]


@router.patch("/api/export-field-mappings/{mapping_id}", response_model=ExportFieldMappingOut)
def patch_export_field_mapping_endpoint(
    mapping_id: int,
    payload: ExportFieldMappingUpdate = Body(...),
    session: Session = Depends(get_db_session),
) -> ExportFieldMappingOut:
    mapping = get_export_field_mapping(session, mapping_id)
    if mapping is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mapping not found")
    try:
        updated = update_export_field_mapping(session, mapping, payload)
        return ExportFieldMappingOut.model_validate(updated)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/api/export-field-mappings/batch-update")
def batch_update_export_field_mappings_endpoint(
    payload: ExportFieldMappingBatchUpdate = Body(...),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    try:
        updated = batch_update_export_field_mappings(session, payload)
        return {"ok": True, "updated": updated}
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

