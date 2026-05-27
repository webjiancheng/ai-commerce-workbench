from __future__ import annotations

from pathlib import Path
from typing import Any, Protocol


class ExportAdapter(Protocol):
    adapter_key: str
    display_name: str

    def get_template_meta(self) -> dict[str, Any]:
        ...

    def write_excel(
        self,
        *,
        common_fields: dict[str, Any],
        rows: list[dict[str, Any]],
        batch_no: str,
        template_file_path: str | None = None,
        preferred_sheet_name: str | None = None,
    ) -> str:
        ...


def ensure_export_dir(storage_root: str, exports_dir_name: str) -> Path:
    out_dir = Path(storage_root) / exports_dir_name
    out_dir.mkdir(parents=True, exist_ok=True)
    return out_dir
