from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.core.task_status import (
    CategoryStatus,
    ExportStatus,
    GenerationMode,
    ImagePromptStatus,
    ImageStatus,
    TaskMainStatus,
    TitleStatus,
)


class CategoryTop3Item(BaseModel):
    path: str
    confidence: float | None = None


class ProductAiSummary(BaseModel):
    category_best_path: str | None = None
    category_confidence: float | None = None
    category_top3: list[CategoryTop3Item] = Field(default_factory=list)
    category_candidates: list[dict[str, Any]] = Field(default_factory=list)
    product_info: dict | None = None
    title_cn: str | None = None
    title_en: str | None = None
    title_package: dict | None = None
    image_prompt_package: dict | None = None


class ProductTaskCreateResponse(BaseModel):
    ok: bool
    id: int
    raw_product_id: int
    main_status: TaskMainStatus
    generation_mode: GenerationMode
    existed: bool = False
    split_index: int = 1
    split_total: int = 1


class ProductTaskUpdate(BaseModel):
    main_status: TaskMainStatus | None = None
    category_status: CategoryStatus | None = None
    title_status: TitleStatus | None = None
    image_prompt_status: ImagePromptStatus | None = None
    image_status: ImageStatus | None = None
    export_status: ExportStatus | None = None
    selected_category_id: str | None = None
    generation_mode: GenerationMode | None = None
    notes: str | None = None


class ProductTaskListItem(BaseModel):
    id: int
    raw_product_id: int
    title: str
    source_url: str | None
    screenshot_url: str | None
    product_platform: str | None
    source_id: str | None
    platform_sku: str | None
    generation_mode: GenerationMode
    main_status: TaskMainStatus
    category_status: CategoryStatus
    title_status: TitleStatus
    image_prompt_status: ImagePromptStatus
    image_status: ImageStatus
    export_status: ExportStatus
    selected_category_id: str | None
    category_candidates_json: list[object] = Field(default_factory=list)
    exception_status: str | None = None
    exception_level: str | None = None
    exception_reasons_json: list[object] = Field(default_factory=list)
    last_error_message: str | None = None
    retry_count: int = 0
    exception_updated_at: datetime | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ProductTaskDetail(ProductTaskListItem):
    notes: str | None
    updated_at: datetime
    ai: ProductAiSummary | None = None

    model_config = ConfigDict(from_attributes=True)


class ProductTaskListResponse(BaseModel):
    items: list[ProductTaskListItem]
    total: int
    limit: int
    offset: int


class ProductTaskTimelineEvent(BaseModel):
    ts: datetime | None = None
    stage: str
    status: str
    title: str
    message: str
    source: str
    meta: dict[str, Any] = Field(default_factory=dict)


class ProductTaskTimelineSummary(BaseModel):
    main_status: TaskMainStatus
    category_status: CategoryStatus
    title_status: TitleStatus
    image_prompt_status: ImagePromptStatus
    image_status: ImageStatus
    export_status: ExportStatus
    exception_status: str | None = None
    exception_level: str | None = None
    last_error_message: str | None = None
    current_step: str


class ProductTaskTimelineResponse(BaseModel):
    task_id: int
    raw_product_id: int
    summary: ProductTaskTimelineSummary
    events: list[ProductTaskTimelineEvent] = Field(default_factory=list)
