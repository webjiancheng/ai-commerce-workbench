from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class DefaultRuleBase(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    rule_type: str = Field(min_length=1, max_length=32)
    scope: str = Field(min_length=1, max_length=32)
    platform: str | None = Field(default=None, max_length=32)
    site: str | None = Field(default=None, max_length=32)
    fulfillment_mode: str | None = Field(default=None, max_length=32)
    category_path: str | None = None
    match_json: dict[str, Any] = Field(default_factory=dict)
    conditions_json: dict[str, Any] = Field(default_factory=dict)
    output_json: dict[str, Any] = Field(default_factory=dict)
    values_json: dict[str, Any] = Field(default_factory=dict)
    priority: int = 0
    enabled: bool = True


class DefaultRuleCreate(DefaultRuleBase):
    pass


class DefaultRuleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    rule_type: str | None = Field(default=None, min_length=1, max_length=32)
    scope: str | None = Field(default=None, min_length=1, max_length=32)
    platform: str | None = Field(default=None, max_length=32)
    site: str | None = Field(default=None, max_length=32)
    fulfillment_mode: str | None = Field(default=None, max_length=32)
    category_path: str | None = None
    match_json: dict[str, Any] | None = None
    conditions_json: dict[str, Any] | None = None
    output_json: dict[str, Any] | None = None
    values_json: dict[str, Any] | None = None
    priority: int | None = None
    enabled: bool | None = None


class DefaultRuleOut(DefaultRuleBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
