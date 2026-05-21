from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PromptTemplate(Base):
    __tablename__ = "prompt_templates"
    __table_args__ = (
        Index("ix_prompt_templates_created_at", "created_at"),
        Index("ix_prompt_templates_prompt_type", "prompt_type"),
        Index("ix_prompt_templates_scope", "scope"),
        Index("ix_prompt_templates_category_id", "category_id"),
        Index("ix_prompt_templates_task_id", "task_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    prompt_type: Mapped[str] = mapped_column(String(64), nullable=False)

    # scope: global/category/task
    scope: Mapped[str] = mapped_column(String(16), nullable=False)
    category_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    task_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    template_text: Mapped[str] = mapped_column(Text, nullable=False)
    variables_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

