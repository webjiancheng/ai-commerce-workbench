from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class ExportFieldMappingOut(BaseModel):
    id: int
    template_id: int
    field_key: str
    field_name: str
    column_index: int
    required: bool
    source_type: str | None
    source_path: str | None
    default_value: str | None
    transform_rule_json: dict[str, Any] = Field(default_factory=dict)
    validation_rule_json: dict[str, Any] = Field(default_factory=dict)
    enabled: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ExportFieldMappingUpdate(BaseModel):
    required: bool | None = None
    source_type: str | None = None
    source_path: str | None = None
    default_value: str | None = None
    transform_rule_json: dict[str, Any] | None = None
    validation_rule_json: dict[str, Any] | None = None
    enabled: bool | None = None


class ExportFieldMappingBatchItem(BaseModel):
    id: int
    source_type: str | None = None
    source_path: str | None = None
    default_value: str | None = None
    enabled: bool | None = None
    required: bool | None = None


class ExportFieldMappingBatchUpdate(BaseModel):
    items: list[ExportFieldMappingBatchItem] = Field(default_factory=list)

