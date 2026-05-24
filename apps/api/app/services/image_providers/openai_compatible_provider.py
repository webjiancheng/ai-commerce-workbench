from __future__ import annotations

import base64
from typing import Any

from openai import OpenAI

from app.services.image_providers.base import GeneratedImage


class OpenAICompatibleImageProvider:
    provider_name = "openai_compatible"

    def generate_image(
        self,
        *,
        prompt: str,
        reference_images: list[bytes] | None,
        size: str,
        model: str,
        extra_options: dict | None = None,
        provider_options: dict | None = None,
    ) -> GeneratedImage:
        options = provider_options or {}
        api_key = str(options.get("api_key") or "").strip()
        if not api_key:
            raise RuntimeError("Missing image provider API key")

        base_url = str(options.get("base_url") or "").strip() or None
        quality = str(options.get("quality") or "auto").strip() or "auto"
        background = str(options.get("background") or "auto").strip() or "auto"
        output_format = str(options.get("output_format") or "png").strip() or "png"

        client = OpenAI(api_key=api_key, base_url=base_url, timeout=180.0)
        if reference_images:
            images = [
                (f"reference_{idx + 1}.{output_format}", data, f"image/{output_format}")
                for idx, data in enumerate(reference_images)
            ]
            response = client.images.edit(
                model=model,
                image=images,
                prompt=prompt,
                size=size,
                quality=quality,
                background=background,
                output_format=output_format,
            )
        else:
            response = client.images.generate(
                model=model,
                prompt=prompt,
                size=size,
                quality=quality,
                background=background,
                output_format=output_format,
            )

        data_items = getattr(response, "data", None) or []
        if not data_items:
            raise RuntimeError("Image provider returned no image data")
        first = data_items[0]
        b64_json = getattr(first, "b64_json", None)
        if not isinstance(b64_json, str) or not b64_json.strip():
            raise RuntimeError("Image provider response missing b64_json")
        payload = base64.b64decode(b64_json)
        width, height = _parse_size(size)
        content_type = {
            "png": "image/png",
            "jpeg": "image/jpeg",
            "jpg": "image/jpeg",
            "webp": "image/webp",
        }.get(output_format.lower(), "image/png")
        return GeneratedImage(content_type=content_type, data=payload, width=width, height=height)


def _parse_size(size: str) -> tuple[int, int]:
    if "x" not in size:
        return (1024, 1024)
    a, b = size.lower().split("x", 1)
    try:
        return (int(a.strip()), int(b.strip()))
    except ValueError:
        return (1024, 1024)
