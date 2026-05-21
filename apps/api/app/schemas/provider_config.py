from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class ProviderConfigBase(BaseModel):
    provider_type: str = Field(min_length=1, max_length=32)
    provider_name: str = Field(min_length=1, max_length=64)
    display_name: str = Field(min_length=1, max_length=128)
    enabled: bool = True
    is_default: bool = False
    config_json: dict[str, Any] = Field(default_factory=dict)
    capabilities_json: dict[str, Any] = Field(default_factory=dict)
    pricing_json: dict[str, Any] = Field(default_factory=dict)


class ProviderConfigCreate(ProviderConfigBase):
    api_key: str | None = Field(default=None, description="Optional API key plaintext; stored encrypted and never returned")


class ProviderConfigUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=128)
    enabled: bool | None = None
    is_default: bool | None = None
    config_json: dict[str, Any] | None = None
    api_key: str | None = Field(default=None, description="Optional API key plaintext; stored encrypted and never returned")
    capabilities_json: dict[str, Any] | None = None
    pricing_json: dict[str, Any] | None = None


class ProviderConfigOut(ProviderConfigBase):
    id: int
    api_key_configured: bool = False
    masked_key: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
