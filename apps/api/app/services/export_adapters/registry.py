from __future__ import annotations

from app.services.export_adapters.base import ExportAdapter
from app.services.export_adapters.miaoshou_temu_non_apparel import MiaoshouTemuNonApparelAdapter
from app.services.export_adapters.temu_half_managed_jewelry_upload import TemuHalfManagedJewelryUploadAdapter


_ADAPTERS: dict[str, ExportAdapter] = {
    "temu_half_managed_jewelry_upload": TemuHalfManagedJewelryUploadAdapter(),
    "miaoshou_temu_non_apparel": MiaoshouTemuNonApparelAdapter(),
}


def get_export_adapter(adapter_key: str | None) -> ExportAdapter:
    key = (adapter_key or "miaoshou_temu_non_apparel").strip()
    adapter = _ADAPTERS.get(key)
    if adapter is None:
        raise ValueError(f"Unsupported export adapter: {key}")
    return adapter


def list_export_adapters() -> list[dict[str, object]]:
    items: list[dict[str, object]] = []
    for key, adapter in _ADAPTERS.items():
        enabled = key in {"miaoshou_temu_non_apparel", "temu_half_managed_jewelry_upload"}
        items.append(
            {
                "adapter_key": key,
                "display_name": adapter.display_name,
                "enabled": enabled,
                "is_default": key == "miaoshou_temu_non_apparel",
            }
        )
    return items
