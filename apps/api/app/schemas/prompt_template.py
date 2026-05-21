from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class PromptTemplateBase(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    prompt_type: str = Field(min_length=1, max_length=64)
    scope: str = Field(min_length=1, max_length=16)
    category_id: str | None = Field(default=None, max_length=64)
    task_id: int | None = None
    template_text: str = Field(min_length=1)
    variables_json: dict[str, Any] = Field(default_factory=dict)
    version: int = Field(default=1, ge=1)
    enabled: bool = True


class PromptTemplateCreate(PromptTemplateBase):
    pass


class PromptTemplateUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    category_id: str | None = Field(default=None, max_length=64)
    task_id: int | None = None
    template_text: str | None = Field(default=None, min_length=1)
    variables_json: dict[str, Any] | None = None
    version: int | None = Field(default=None, ge=1)
    enabled: bool | None = None


class PromptTemplateItem(PromptTemplateBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PromptTemplateListResponse(BaseModel):
    items: list[PromptTemplateItem]
    total: int
    limit: int
    offset: int


class PromptRenderRequest(BaseModel):
    template_text: str
    variables: dict[str, Any] = Field(default_factory=dict)


class PromptRenderResponse(BaseModel):
    rendered_text: str

