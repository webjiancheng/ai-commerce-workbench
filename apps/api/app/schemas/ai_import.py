from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class AiImportDraftOut(BaseModel):
    id: int
    batch_id: int
    common_fields_json: dict[str, Any] = Field(default_factory=dict)
    headers_json: list[str] = Field(default_factory=list)
    rows_json: list[dict[str, str]] = Field(default_factory=list)
    field_settings_json: dict[str, Any] = Field(default_factory=dict)
    validation_result_json: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AiImportBatchOut(BaseModel):
    id: int
    name: str
    template_file_path: str | None
    original_filename: str | None
    raw_json_text: str
    sheet_name: str | None
    parsed_common_fields_json: dict[str, Any] = Field(default_factory=dict)
    parsed_headers_json: list[str] = Field(default_factory=list)
    parsed_rows_json: list[dict[str, str]] = Field(default_factory=list)
    parsed_warnings_json: list[Any] = Field(default_factory=list)
    validation_result_json: dict[str, Any] = Field(default_factory=dict)
    status: str
    error_message: str | None
    export_file_path: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
