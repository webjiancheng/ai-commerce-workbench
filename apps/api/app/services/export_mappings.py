from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.export_field_mapping import ExportFieldMapping
from app.schemas.export_field_mapping import ExportFieldMappingBatchUpdate, ExportFieldMappingUpdate


def list_export_field_mappings(session: Session, *, template_id: int) -> list[ExportFieldMapping]:
    return session.scalars(
        select(ExportFieldMapping)
        .where(ExportFieldMapping.template_id == template_id)
        .order_by(ExportFieldMapping.column_index.asc(), ExportFieldMapping.id.asc())
    ).all()


def get_export_field_mapping(session: Session, mapping_id: int) -> ExportFieldMapping | None:
    return session.get(ExportFieldMapping, mapping_id)


def update_export_field_mapping(
    session: Session, mapping: ExportFieldMapping, payload: ExportFieldMappingUpdate
) -> ExportFieldMapping:
    updates = payload.model_dump(exclude_unset=True)
    for k, v in updates.items():
        setattr(mapping, k, v)
    session.add(mapping)
    session.commit()
    session.refresh(mapping)
    return mapping


def batch_update_export_field_mappings(session: Session, payload: ExportFieldMappingBatchUpdate) -> int:
    updated = 0
    for item in payload.items:
        mapping = session.get(ExportFieldMapping, item.id)
        if mapping is None:
            continue
        changes = item.model_dump(exclude_unset=True)
        changes.pop("id", None)
        for k, v in changes.items():
            setattr(mapping, k, v)
        session.add(mapping)
        updated += 1
    if updated:
        session.commit()
    return updated

