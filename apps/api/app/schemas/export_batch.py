from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class ExportBatchOut(BaseModel):
    id: int
    batch_no: str
    template_id: int | None
    template_version: str
    total_count: int
    success_count: int
    failed_count: int
    exported_file_path: str | None
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

