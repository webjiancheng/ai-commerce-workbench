from __future__ import annotations

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models.export_template import ExportTemplate
from app.schemas.export_template import ExportTemplateCreate, ExportTemplateUpdate


def list_export_templates(session: Session) -> list[ExportTemplate]:
    return session.scalars(select(ExportTemplate).order_by(ExportTemplate.updated_at.desc(), ExportTemplate.id.desc())).all()


def create_export_template(session: Session, payload: ExportTemplateCreate) -> ExportTemplate:
    tpl = ExportTemplate(
        name=payload.name,
        version=payload.version,
        platform=payload.platform,
        template_type=payload.template_type,
        file_path=payload.file_path,
        header_row_index=payload.header_row_index,
        fields_json=[],
        enabled=payload.enabled,
        is_default=payload.is_default,
    )
    session.add(tpl)
    session.commit()
    session.refresh(tpl)
    if tpl.is_default:
        set_default_export_template(session, template_id=tpl.id)
        session.refresh(tpl)
    return tpl


def get_export_template(session: Session, template_id: int) -> ExportTemplate | None:
    return session.get(ExportTemplate, template_id)


def update_export_template(session: Session, tpl: ExportTemplate, payload: ExportTemplateUpdate) -> ExportTemplate:
    updates = payload.model_dump(exclude_unset=True)
    for k, v in updates.items():
        setattr(tpl, k, v)
    session.add(tpl)
    session.commit()
    session.refresh(tpl)
    if tpl.is_default:
        set_default_export_template(session, template_id=tpl.id)
        session.refresh(tpl)
    return tpl


def set_default_export_template(session: Session, *, template_id: int) -> None:
    tpl = session.get(ExportTemplate, template_id)
    if tpl is None:
        return
    session.execute(
        update(ExportTemplate)
        .where(ExportTemplate.platform == tpl.platform, ExportTemplate.id != template_id)
        .values(is_default=False)
    )
    session.execute(update(ExportTemplate).where(ExportTemplate.id == template_id).values(is_default=True))
    session.commit()


def get_default_export_template(session: Session, *, platform: str = "temu") -> ExportTemplate | None:
    return session.scalar(
        select(ExportTemplate)
        .where(ExportTemplate.platform == platform, ExportTemplate.enabled.is_(True), ExportTemplate.is_default.is_(True))
        .order_by(ExportTemplate.updated_at.desc(), ExportTemplate.id.desc())
        .limit(1)
    )

