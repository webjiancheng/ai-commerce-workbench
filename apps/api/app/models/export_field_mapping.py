from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ExportFieldMapping(Base):
    __tablename__ = "export_field_mappings"
    __table_args__ = (
        Index("ix_export_field_mappings_template_id", "template_id"),
        Index("ix_export_field_mappings_field_key", "field_key"),
        Index("ix_export_field_mappings_enabled", "enabled"),
        Index("uq_export_field_mappings_template_field", "template_id", "field_key", unique=True),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    template_id: Mapped[int] = mapped_column(
        ForeignKey("export_templates.id", ondelete="CASCADE"), nullable=False
    )

    field_key: Mapped[str] = mapped_column(String(128), nullable=False)
    field_name: Mapped[str] = mapped_column(String(256), nullable=False)
    column_index: Mapped[int] = mapped_column(Integer, nullable=False)
    required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")

    source_type: Mapped[str | None] = mapped_column(String(32), nullable=True)  # draft/raw/ai/task/asset/fixed
    source_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    default_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    transform_rule_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    validation_rule_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

