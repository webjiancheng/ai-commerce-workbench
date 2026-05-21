from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ExportRecord(Base):
    __tablename__ = "export_records"
    __table_args__ = (
        Index("ix_export_records_task_id", "product_task_id"),
        Index("ix_export_records_batch_no", "batch_no"),
        Index("ix_export_records_status", "status"),
        Index("ix_export_records_created_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_task_id: Mapped[int] = mapped_column(
        ForeignKey("product_tasks.id", ondelete="CASCADE"), nullable=False
    )
    template_id: Mapped[int] = mapped_column(
        ForeignKey("export_templates.id", ondelete="SET NULL"), nullable=True
    )
    template_version: Mapped[str] = mapped_column(String(64), nullable=False)

    export_fields_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    field_sources_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    validation_result_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending", server_default="pending")
    batch_no: Mapped[str] = mapped_column(String(64), nullable=False)

    exported_file_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    exported_file_path: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

