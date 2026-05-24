from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AiImportBatch(Base):
    __tablename__ = "ai_import_batches"
    __table_args__ = (
        Index("ix_ai_import_batches_status", "status"),
        Index("ix_ai_import_batches_created_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False, default="AI导入批次")
    template_file_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    original_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    raw_json_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    sheet_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    parsed_common_fields_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    parsed_headers_json: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    parsed_rows_json: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    parsed_warnings_json: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    validation_result_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="uploaded", server_default="uploaded")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    export_file_path: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
