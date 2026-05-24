from __future__ import annotations

from app.services.image_providers.base import ImageProvider
from app.services.image_providers.openai_compatible_provider import OpenAICompatibleImageProvider
from app.services.image_providers.stub_provider import StubImageProvider


_PROVIDERS: dict[str, ImageProvider] = {
    "openai_compatible": OpenAICompatibleImageProvider(),
    "stub": StubImageProvider(),
}


def list_image_providers() -> list[dict[str, str]]:
    return [{"provider_name": name} for name in sorted(_PROVIDERS.keys())]


def get_image_provider(provider_name: str) -> ImageProvider:
    provider = _PROVIDERS.get(provider_name)
    if provider is None:
        raise ValueError(f"Unsupported image provider: {provider_name}")
    return provider
