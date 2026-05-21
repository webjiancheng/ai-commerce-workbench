from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class ExportFieldDraftOut(BaseModel):
    id: int
    product_task_id: int
    fields_json: dict[str, Any] = Field(default_factory=dict)
    field_sources_json: dict[str, Any] = Field(default_factory=dict)
    warnings_json: list[Any] = Field(default_factory=list)
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

