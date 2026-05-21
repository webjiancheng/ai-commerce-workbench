from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class UsageLimit(Base):
    __tablename__ = "usage_limits"
    __table_args__ = (
        Index("ix_usage_limits_scope", "scope_type", "scope_id"),
        Index("ix_usage_limits_limit_type", "limit_type"),
        Index("ix_usage_limits_date", "date"),
        Index("uq_usage_limits_unique", "scope_type", "scope_id", "limit_type", "date", unique=True),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    scope_type: Mapped[str] = mapped_column(String(32), nullable=False)  # day|task|slot|provider
    scope_id: Mapped[str] = mapped_column(String(64), nullable=False)
    limit_type: Mapped[str] = mapped_column(String(64), nullable=False)
    max_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    used_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    date: Mapped[str] = mapped_column(String(16), nullable=False)  # YYYY-MM-DD

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

