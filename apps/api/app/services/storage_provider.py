from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from slugify import slugify

from app.core.config import get_settings


@dataclass(frozen=True)
class StoredObject:
    storage_key: str
    public_url: str


class LocalStorageProvider:
    provider_name = "local"

    def __init__(self, *, base_dir: str = "assets") -> None:
        self._base_dir = base_dir

    def put_bytes(self, *, key_prefix: str, filename: str, data: bytes) -> StoredObject:
        settings = get_settings()
        root = Path(settings.storage_root)
        safe_prefix = "/".join([slugify(p, separator="-") or "x" for p in key_prefix.split("/") if p])
        safe_filename = slugify(Path(filename).stem, separator="-") or "file"
        ext = Path(filename).suffix or ".bin"

        rel_dir = Path(self._base_dir) / safe_prefix
        abs_dir = root / rel_dir
        abs_dir.mkdir(parents=True, exist_ok=True)

        # Ensure uniqueness for versioning (caller is expected to version, this is a guard).
        candidate = abs_dir / f"{safe_filename}{ext}"
        if candidate.exists():
            candidate = abs_dir / f"{safe_filename}-{_short_hash(data)}{ext}"

        candidate.write_bytes(data)
        storage_key = str((rel_dir / candidate.name).as_posix())
        public_url = f"{settings.public_base_url}/storage/{storage_key}"
        return StoredObject(storage_key=storage_key, public_url=public_url)


def _short_hash(data: bytes) -> str:
    import hashlib

    return hashlib.sha1(data).hexdigest()[:8]

