from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class ProductAssetOut(BaseModel):
    id: int
    product_task_id: int
    sku_id: str | None
    slot: str
    asset_type: str
    source_type: str
    version: int
    parent_asset_id: int | None
    generation_job_id: int | None
    storage_key: str | None
    public_url: str | None
    mime_type: str | None
    width: int | None
    height: int | None
    prompt_template_id: int | None
    prompt_snapshot: dict[str, Any] = Field(default_factory=dict)
    image_strategy_snapshot: dict[str, Any] = Field(default_factory=dict)
    provider: str | None
    model_name: str | None
    selected_for_export: bool
    status: str
    crop_group_id: str | None
    crop_index: int | None
    crop_box_json: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

