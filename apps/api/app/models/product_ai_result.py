from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ProductAIResult(Base):
    __tablename__ = "product_ai_results"
    __table_args__ = (
        Index("ix_product_ai_results_created_at", "created_at"),
        Index("ix_product_ai_results_task_id", "task_id", unique=True),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(
        ForeignKey("product_tasks.id", ondelete="CASCADE"), nullable=False
    )

    # Stage-4: keep each task's JSON outputs + snapshots.
    # Each field stores a dict containing at least: input, output, prompt, model, created_at.
    prompt_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    product_info: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    category_match: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    product_dna: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    title_cn: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    title_en: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    product_description: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    title_package: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    image_prompt_package: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
