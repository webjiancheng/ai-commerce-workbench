import base64
import binascii
from pathlib import Path

from slugify import slugify

from app.core.config import get_settings


def ensure_storage_dir() -> Path:
    settings = get_settings()
    root = Path(settings.storage_root)
    target = root / settings.screenshot_dir_name
    target.mkdir(parents=True, exist_ok=True)
    return target


def save_data_url_image(*, product_id: str, data_url: str) -> str:
    if "," not in data_url:
        raise ValueError("Invalid dataUrl payload")

    header, encoded = data_url.split(",", 1)
    if ";base64" not in header:
        raise ValueError("Only base64 screenshots are supported")

    content_type = header.split(";")[0].removeprefix("data:")
    extension = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp",
    }.get(content_type, "bin")

    try:
        payload = base64.b64decode(encoded)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Invalid base64 screenshot payload") from exc

    safe_name = slugify(product_id, separator="-") or "screenshot"
    target_dir = ensure_storage_dir()
    file_path = target_dir / f"{safe_name}.{extension}"
    file_path.write_bytes(payload)

    settings = get_settings()
    return f"{settings.public_base_url}/storage/{settings.screenshot_dir_name}/{file_path.name}"
