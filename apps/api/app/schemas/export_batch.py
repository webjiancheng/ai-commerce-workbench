from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class ExportBatchOut(BaseModel):
    id: int
    batch_no: str
    template_id: int | None
    template_version: str
    export_mode: str
    default_rule_id: int | None
    default_rule_name: str | None
    original_filename: str | None
    total_count: int
    sku_row_count: int
    success_count: int
    failed_count: int
    exported_file_path: str | None
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
