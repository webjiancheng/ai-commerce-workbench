from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class GeneratedImage:
    content_type: str
    data: bytes
    width: int
    height: int


class ImageProvider(Protocol):
    provider_name: str

    def generate_image(
        self,
        *,
        prompt: str,
        reference_images: list[bytes] | None,
        size: str,
        model: str,
        extra_options: dict | None = None,
    ) -> GeneratedImage: ...

