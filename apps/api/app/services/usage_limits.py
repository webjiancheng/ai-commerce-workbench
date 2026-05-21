from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.usage_limit import UsageLimit
from app.services.cost_configs import get_limit_value
from app.core.defaults import DEFAULT_LIMITS




def ensure_limit_row(
    session: Session,
    *,
    scope_type: str,
    scope_id: str,
    limit_type: str,
    date: str,
    max_count: int,
) -> UsageLimit:
    row = session.scalar(
        select(UsageLimit)
        .where(
            UsageLimit.scope_type == scope_type,
            UsageLimit.scope_id == scope_id,
            UsageLimit.limit_type == limit_type,
            UsageLimit.date == date,
        )
        .limit(1)
    )
    if row is not None:
        return row
    row = UsageLimit(
        scope_type=scope_type,
        scope_id=scope_id,
        limit_type=limit_type,
        max_count=max_count,
        used_count=0,
        date=date,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def check_and_consume_image_generation(
    session: Session,
    *,
    task_id: int,
    slot: str,
    provider: str,
    count: int = 1,
) -> tuple[bool, str | None, list[dict[str, object]]]:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    rows = []
    max_daily = get_limit_value(session, "daily_image_generation_limit") or DEFAULT_LIMITS["daily_image_generation_limit"]
    max_task = get_limit_value(session, "task_regeneration_limit") or DEFAULT_LIMITS["task_regeneration_limit"]
    max_slot = get_limit_value(session, "slot_regeneration_limit") or DEFAULT_LIMITS["slot_regeneration_limit"]
    max_provider = get_limit_value(session, "provider_daily_image_generation_limit") or DEFAULT_LIMITS["provider_daily_image_generation_limit"]

    rows.append(
        ensure_limit_row(
            session,
            scope_type="day",
            scope_id=today,
            limit_type="daily_image_generation_limit",
            date=today,
            max_count=max_daily,
        )
    )
    rows.append(
        ensure_limit_row(
            session,
            scope_type="task",
            scope_id=str(task_id),
            limit_type="task_regeneration_limit",
            date=today,
            max_count=max_task,
        )
    )
    rows.append(
        ensure_limit_row(
            session,
            scope_type="slot",
            scope_id=f"{task_id}:{slot}",
            limit_type="slot_regeneration_limit",
            date=today,
            max_count=max_slot,
        )
    )
    rows.append(
        ensure_limit_row(
            session,
            scope_type="provider",
            scope_id=f"{provider}:{today}",
            limit_type="provider_daily_image_generation_limit",
            date=today,
            max_count=max_provider,
        )
    )

    exceeded = []
    for r in rows:
        if r.used_count + count > r.max_count:
            exceeded.append(
                {
                    "scope_type": r.scope_type,
                    "scope_id": r.scope_id,
                    "limit_type": r.limit_type,
                    "used_count": r.used_count,
                    "max_count": r.max_count,
                    "date": r.date,
                }
            )

    if exceeded:
        return False, "Usage limit exceeded", exceeded

    for r in rows:
        r.used_count += count
        session.add(r)
    session.commit()
    return True, None, []


def get_limits_snapshot(session: Session, *, task_id: int, slot: str, provider: str) -> list[dict[str, object]]:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    keys = [
        ("day", today, "daily_image_generation_limit"),
        ("task", str(task_id), "task_regeneration_limit"),
        ("slot", f"{task_id}:{slot}", "slot_regeneration_limit"),
        ("provider", f"{provider}:{today}", "provider_daily_image_generation_limit"),
    ]
    out: list[dict[str, object]] = []
    for scope_type, scope_id, limit_type in keys:
        row = session.scalar(
            select(UsageLimit)
            .where(
                UsageLimit.scope_type == scope_type,
                UsageLimit.scope_id == scope_id,
                UsageLimit.limit_type == limit_type,
                UsageLimit.date == today,
            )
            .limit(1)
        )
        if row is None:
            max_count = int(DEFAULT_LIMITS.get(limit_type, 0))
            row = ensure_limit_row(
                session,
                scope_type=scope_type,
                scope_id=scope_id,
                limit_type=limit_type,
                date=today,
                max_count=max_count,
            )
        out.append(
            {
                "scope_type": row.scope_type,
                "scope_id": row.scope_id,
                "limit_type": row.limit_type,
                "used_count": row.used_count,
                "max_count": row.max_count,
                "date": row.date,
            }
        )
    return out
