from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ProductTask(Base):
    __tablename__ = "product_tasks"
    __table_args__ = (
        Index("ix_product_tasks_created_at", "created_at"),
        Index("ix_product_tasks_main_status", "main_status"),
        Index("ix_product_tasks_category_status", "category_status"),
        Index("ix_product_tasks_export_status", "export_status"),
        Index("ix_product_tasks_raw_product_id", "raw_product_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    raw_product_id: Mapped[int] = mapped_column(
        ForeignKey("raw_products.id", ondelete="CASCADE"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column("product_title", Text, nullable=False)
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    product_platform: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    platform_sku: Mapped[str | None] = mapped_column(String(128), nullable=True)
    screenshot_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    split_index: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    split_total: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    generation_mode: Mapped[str] = mapped_column(String(32), nullable=False, default="title_and_4grid", server_default="title_and_4grid")
    include_product_info: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    main_status: Mapped[str] = mapped_column(String(32), nullable=False)
    category_status: Mapped[str] = mapped_column(String(32), nullable=False)
    title_status: Mapped[str] = mapped_column(String(32), nullable=False)
    image_prompt_status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending", server_default="pending")
    image_status: Mapped[str] = mapped_column(String(32), nullable=False)
    export_status: Mapped[str] = mapped_column(String(32), nullable=False)
    selected_category_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    category_candidates_json: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Export / listing fields (added stage-8+)
    task_no: Mapped[str | None] = mapped_column(String(64), nullable=True)  # SPU货号
    title_package: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # {"title_cn": "", "title_en": ""}
    category_path: Mapped[str | None] = mapped_column(Text, nullable=True)  # 分类路径
    price_usd: Mapped[float | None] = mapped_column(Text, nullable=True)  # 申报价格(USD)

    # Stage-9 exception pool fields
    exception_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    exception_level: Mapped[str | None] = mapped_column(String(32), nullable=True)  # warning|blocking|failed
    exception_reasons_json: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    last_error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    exception_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
