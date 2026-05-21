from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class ExportRecordOut(BaseModel):
    id: int
    product_task_id: int
    template_id: int | None
    template_version: str
    export_fields_json: dict[str, Any] = Field(default_factory=dict)
    field_sources_json: dict[str, Any] = Field(default_factory=dict)
    validation_result_json: dict[str, Any] = Field(default_factory=dict)
    status: str
    batch_no: str
    exported_file_path: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

