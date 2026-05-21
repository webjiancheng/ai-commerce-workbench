from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class ImageGenerationJobOut(BaseModel):
    id: int
    product_task_id: int
    job_type: str
    slot: str
    target_slots_json: list[str] = Field(default_factory=list)
    reference_asset_ids_json: list[int] = Field(default_factory=list)
    input_asset_ids_json: list[int] = Field(default_factory=list)
    prompt_template_id: int | None
    prompt_snapshot: dict[str, Any] = Field(default_factory=dict)
    final_prompt: str
    provider: str
    model_name: str
    size: str
    provider_config_snapshot: dict[str, Any] = Field(default_factory=dict)
    status: str
    progress: int
    error_message: str | None
    parent_asset_id: int | None
    output_asset_ids_json: list[int] = Field(default_factory=list)
    started_at: datetime | None
    finished_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

