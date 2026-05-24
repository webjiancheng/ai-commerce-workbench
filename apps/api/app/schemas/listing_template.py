from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class ListingTemplateOut(BaseModel):
    id: int
    name: str
    platform: str | None
    category_path: str | None
    category_keywords: str | None
    description: str | None
    uniform_defaults_json: dict[str, Any] = Field(default_factory=dict)
    category_fields_json: dict[str, Any] = Field(default_factory=dict)
    is_builtin: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ListingTemplateCreate(BaseModel):
    name: str
    platform: str | None = None
    category_path: str | None = None
    category_keywords: str | None = None
    description: str | None = None
    uniform_defaults_json: dict[str, Any] = Field(default_factory=dict)
    category_fields_json: dict[str, Any] = Field(default_factory=dict)
    is_builtin: bool = False
    is_active: bool = True


class ListingTemplateUpdate(BaseModel):
    name: str | None = None
    platform: str | None = None
    category_path: str | None = None
    category_keywords: str | None = None
    description: str | None = None
    uniform_defaults_json: dict[str, Any] | None = None
    category_fields_json: dict[str, Any] | None = None
    is_active: bool | None = None