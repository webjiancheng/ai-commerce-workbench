from __future__ import annotations

import hashlib

from PIL import Image, ImageDraw, ImageFont

from app.services.image_providers.base import GeneratedImage


class StubImageProvider:
    provider_name = "stub"

    def generate_image(
        self,
        *,
        prompt: str,
        reference_images: list[bytes] | None,
        size: str,
        model: str,
        extra_options: dict | None = None,
    ) -> GeneratedImage:
        width, height = _parse_size(size)
        seed = hashlib.sha256((prompt + "|" + model + "|" + size).encode("utf-8")).hexdigest()
        bg = _hex_to_rgb(seed[:6])
        fg = (255 - bg[0], 255 - bg[1], 255 - bg[2])

        image = Image.new("RGB", (width, height), bg)
        draw = ImageDraw.Draw(image)
        font = _load_font(18)
        small = _load_font(14)

        draw.rectangle([10, 10, width - 10, height - 10], outline=fg, width=3)
        draw.text((18, 18), "STUB IMAGE", fill=fg, font=font)
        draw.text((18, 44), f"model={model}", fill=fg, font=small)
        draw.text((18, 64), f"size={size}", fill=fg, font=small)
        digest = seed[:12]
        draw.text((18, 84), f"seed={digest}", fill=fg, font=small)
        ref_count = len(reference_images or [])
        draw.text((18, 104), f"refs={ref_count}", fill=fg, font=small)

        # Do not render the full prompt (too long). Render head only.
        prompt_head = (prompt or "").strip().replace("\n", " ")
        prompt_head = prompt_head[:160] + ("…" if len(prompt_head) > 160 else "")
        draw.multiline_text((18, 132), prompt_head, fill=fg, font=small, spacing=4)

        out = _to_png_bytes(image)
        return GeneratedImage(content_type="image/png", data=out, width=width, height=height)


def _to_png_bytes(image: Image.Image) -> bytes:
    import io

    buf = io.BytesIO()
    image.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def _parse_size(size: str) -> tuple[int, int]:
    if "x" not in size:
        return (1024, 1024)
    a, b = size.lower().split("x", 1)
    try:
        w = int(a.strip())
        h = int(b.strip())
    except ValueError:
        return (1024, 1024)
    w = max(256, min(4096, w))
    h = max(256, min(4096, h))
    return (w, h)


def _hex_to_rgb(hex6: str) -> tuple[int, int, int]:
    try:
        r = int(hex6[0:2], 16)
        g = int(hex6[2:4], 16)
        b = int(hex6[4:6], 16)
        return (r, g, b)
    except Exception:
        return (30, 41, 59)


def _load_font(size: int) -> ImageFont.ImageFont:
    # Use default font (no external dependency).
    try:
        return ImageFont.load_default()
    except Exception:
        return ImageFont.load_default()
