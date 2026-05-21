from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.models.product_task import ProductTask


_SEVERITY_ORDER = {"warning": 1, "blocking": 2, "failed": 3}


def _normalize_reasons(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _choose_primary_reason(reasons: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not reasons:
        return None
    return max(reasons, key=lambda item: _SEVERITY_ORDER.get(str(item.get("level") or ""), 0))


def record_task_exception(
    task: ProductTask,
    *,
    code: str,
    level: str,
    status: str,
    message: str,
) -> None:
    now = datetime.now(timezone.utc)
    reasons = [item for item in _normalize_reasons(task.exception_reasons_json) if item.get("code") != code]
    reasons.append(
        {
            "code": code,
            "level": level,
            "status": status,
            "message": message,
            "updated_at": now.isoformat(),
        }
    )
    task.exception_reasons_json = reasons
    task.exception_updated_at = now

    primary = _choose_primary_reason(reasons)
    if primary is not None:
        task.exception_level = str(primary.get("level") or level)
        task.exception_status = str(primary.get("status") or status)
        task.last_error_message = str(primary.get("message") or message)


def clear_task_exception(task: ProductTask, *, code: str) -> None:
    reasons = [item for item in _normalize_reasons(task.exception_reasons_json) if item.get("code") != code]
    task.exception_reasons_json = reasons
    task.exception_updated_at = datetime.now(timezone.utc)

    primary = _choose_primary_reason(reasons)
    if primary is None:
        task.exception_level = None
        task.exception_status = None
        task.last_error_message = None
        return

    task.exception_level = str(primary.get("level") or "")
    task.exception_status = str(primary.get("status") or "")
    task.last_error_message = str(primary.get("message") or "")
