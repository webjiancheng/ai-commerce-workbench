from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class ExportTemplateBase(BaseModel):
    name: str
    version: str
    platform: str
    template_type: str
    file_path: str
    header_row_index: int = 1
    fields_json: list[dict[str, Any]] = Field(default_factory=list)
    enabled: bool = True
    is_default: bool = False


class ExportTemplateCreate(BaseModel):
    name: str
    version: str
    platform: str
    template_type: str = "temu_miaoshou"
    file_path: str
    header_row_index: int = 1
    enabled: bool = True
    is_default: bool = False


class ExportTemplateUpdate(BaseModel):
    name: str | None = None
    enabled: bool | None = None
    is_default: bool | None = None
    header_row_index: int | None = None
    file_path: str | None = None
    fields_json: list[dict[str, Any]] | None = None


class ExportTemplateOut(ExportTemplateBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

