from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AiImportDraft(Base):
    __tablename__ = "ai_import_drafts"
    __table_args__ = (
        Index("ix_ai_import_drafts_batch_id", "batch_id", unique=True),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    batch_id: Mapped[int] = mapped_column(
        ForeignKey("ai_import_batches.id", ondelete="CASCADE"),
        nullable=False,
    )
    common_fields_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    headers_json: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    rows_json: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    field_settings_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    validation_result_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
