from datetime import datetime

from sqlalchemy import DateTime, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class RawProduct(Base):
    __tablename__ = "raw_products"
    __table_args__ = (
        Index("ix_raw_products_created_at", "created_at"),
        Index("ix_raw_products_platform_sku", "platform_sku"),
        Index("ix_raw_products_source_id", "source_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    platform: Mapped[str | None] = mapped_column(String(64), nullable=True)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    price: Mapped[str | None] = mapped_column(String(64), nullable=True)
    original_price: Mapped[str | None] = mapped_column(String(64), nullable=True)
    currency: Mapped[str | None] = mapped_column(String(32), nullable=True)
    source_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    platform_sku: Mapped[str | None] = mapped_column(String(128), nullable=True)
    category_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    shop_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    attributes_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    sku_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    stock: Mapped[str | None] = mapped_column(Text, nullable=True)
    collector: Mapped[str | None] = mapped_column(String(128), nullable=True)
    main_image: Mapped[str | None] = mapped_column(Text, nullable=True)
    screenshot_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    video_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    main_images: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    carousel_images: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    sku_images: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    detail_images: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    size_chart_images: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    debug_payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
