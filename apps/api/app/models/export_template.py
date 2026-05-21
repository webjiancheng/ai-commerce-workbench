from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ExportTemplate(Base):
    __tablename__ = "export_templates"
    __table_args__ = (
        Index("ix_export_templates_platform", "platform"),
        Index("ix_export_templates_enabled", "enabled"),
        Index("ix_export_templates_default", "is_default"),
        Index("uq_export_templates_platform_version", "platform", "version", unique=True),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    version: Mapped[str] = mapped_column(String(64), nullable=False)
    platform: Mapped[str] = mapped_column(String(64), nullable=False)
    template_type: Mapped[str] = mapped_column(String(64), nullable=False, default="temu_miaoshou")
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    header_row_index: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    fields_json: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

