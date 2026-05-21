from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ExportFieldDraft(Base):
    __tablename__ = "export_field_drafts"
    __table_args__ = (
        Index("ix_export_field_drafts_task_id", "product_task_id", unique=True),
        Index("ix_export_field_drafts_status", "status"),
        Index("ix_export_field_drafts_updated_at", "updated_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_task_id: Mapped[int] = mapped_column(
        ForeignKey("product_tasks.id", ondelete="CASCADE"), nullable=False
    )
    fields_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    field_sources_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    warnings_json: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft", server_default="draft")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

