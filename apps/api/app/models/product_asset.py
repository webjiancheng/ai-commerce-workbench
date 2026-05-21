from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ProductAsset(Base):
    __tablename__ = "product_assets"
    __table_args__ = (
        Index("ix_product_assets_task_slot", "product_task_id", "slot"),
        Index("ix_product_assets_task_created_at", "product_task_id", "created_at"),
        Index("ix_product_assets_generation_job_id", "generation_job_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_task_id: Mapped[int] = mapped_column(
        ForeignKey("product_tasks.id", ondelete="CASCADE"),
        nullable=False,
    )
    sku_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    slot: Mapped[str] = mapped_column(String(32), nullable=False)

    asset_type: Mapped[str] = mapped_column(String(32), nullable=False)
    source_type: Mapped[str] = mapped_column(String(32), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")

    parent_asset_id: Mapped[int | None] = mapped_column(
        ForeignKey("product_assets.id", ondelete="SET NULL"), nullable=True
    )
    generation_job_id: Mapped[int | None] = mapped_column(
        ForeignKey("image_generation_jobs.id", ondelete="SET NULL"), nullable=True
    )

    storage_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    public_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)

    prompt_template_id: Mapped[int | None] = mapped_column(
        ForeignKey("prompt_templates.id", ondelete="SET NULL"), nullable=True
    )
    prompt_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    image_strategy_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    provider: Mapped[str | None] = mapped_column(String(64), nullable=True)
    model_name: Mapped[str | None] = mapped_column(String(128), nullable=True)

    selected_for_export: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ready", server_default="ready")

    crop_group_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    crop_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    crop_box_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

