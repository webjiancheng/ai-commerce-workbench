from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ExportBatch(Base):
    __tablename__ = "export_batches"
    __table_args__ = (
        Index("uq_export_batches_batch_no", "batch_no", unique=True),
        Index("ix_export_batches_status", "status"),
        Index("ix_export_batches_created_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    batch_no: Mapped[str] = mapped_column(String(64), nullable=False)
    template_id: Mapped[int] = mapped_column(
        ForeignKey("export_templates.id", ondelete="SET NULL"), nullable=True
    )
    template_version: Mapped[str] = mapped_column(String(64), nullable=False)
    export_mode: Mapped[str] = mapped_column(String(32), nullable=False, default="default_rule", server_default="default_rule")
    default_rule_id: Mapped[int | None] = mapped_column(
        ForeignKey("default_rules.id", ondelete="SET NULL"), nullable=True
    )
    default_rule_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    original_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    total_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    sku_row_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    success_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    failed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    exported_file_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending", server_default="pending")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
