from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ListingTemplate(Base):
    """类目字段方案，描述某个类目需要的默认字段与类目属性字段"""

    __tablename__ = "listing_templates"
    __table_args__ = (
        Index("ix_listing_templates_platform", "platform"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    platform: Mapped[str | None] = mapped_column(String(32), nullable=True)
    category_path: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    category_keywords: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    uniform_defaults_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    category_fields_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    is_builtin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
