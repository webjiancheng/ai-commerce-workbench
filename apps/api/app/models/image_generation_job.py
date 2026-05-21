from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ImageGenerationJob(Base):
    __tablename__ = "image_generation_jobs"
    __table_args__ = (
        Index("ix_image_generation_jobs_task", "product_task_id"),
        Index("ix_image_generation_jobs_status", "status"),
        Index("ix_image_generation_jobs_created_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_task_id: Mapped[int] = mapped_column(
        ForeignKey("product_tasks.id", ondelete="CASCADE"), nullable=False
    )

    job_type: Mapped[str] = mapped_column(String(32), nullable=False)  # single_slot | carousel_4grid
    slot: Mapped[str] = mapped_column(String(32), nullable=False)

    target_slots_json: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    reference_asset_ids_json: Mapped[list[int]] = mapped_column(JSONB, nullable=False, default=list)
    input_asset_ids_json: Mapped[list[int]] = mapped_column(JSONB, nullable=False, default=list)

    prompt_template_id: Mapped[int | None] = mapped_column(
        ForeignKey("prompt_templates.id", ondelete="SET NULL"), nullable=True
    )
    prompt_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    final_prompt: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")

    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    model_name: Mapped[str] = mapped_column(String(128), nullable=False)
    size: Mapped[str] = mapped_column(String(32), nullable=False)
    provider_config_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    status: Mapped[str] = mapped_column(String(32), nullable=False, default="queued", server_default="queued")
    progress: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    parent_asset_id: Mapped[int | None] = mapped_column(
        ForeignKey("product_assets.id", ondelete="SET NULL"), nullable=True
    )
    output_asset_ids_json: Mapped[list[int]] = mapped_column(JSONB, nullable=False, default=list)

    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

