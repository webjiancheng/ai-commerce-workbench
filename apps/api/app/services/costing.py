from __future__ import annotations

from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.models.cost_record import CostRecord
from app.models.provider_config import ProviderConfig


def estimate_image_cost(
    *,
    provider_config: ProviderConfig,
    job_type: str,
    count: int,
) -> dict[str, Any]:
    pricing = provider_config.pricing_json or {}
    unit = pricing.get("estimated_cost_per_image")
    try:
        unit_cost = Decimal(str(unit)) if unit is not None else Decimal("0")
    except Exception:
        unit_cost = Decimal("0")

    # carousel_4grid is 1 call generating 5 assets (1 parent + 4 crops), but provider call count is 1
    api_calls = count
    estimated = unit_cost * Decimal(str(api_calls))
    return {
        "provider": provider_config.provider_name,
        "job_type": job_type,
        "count": count,
        "api_calls": api_calls,
        "unit_cost": float(unit_cost),
        "estimated_cost": float(estimated),
        "currency": pricing.get("currency") or "USD",
    }


def record_image_cost(
    session: Session,
    *,
    product_task_id: int,
    job_id: int | None,
    provider: str,
    model_name: str,
    job_type: str,
    estimated_cost: float | None,
    actual_cost: float | None,
    currency: str = "USD",
) -> None:
    row = CostRecord(
        product_task_id=product_task_id,
        job_id=job_id,
        provider=provider,
        model_name=model_name,
        job_type=job_type,
        estimated_cost=estimated_cost,
        actual_cost=actual_cost,
        currency=currency,
    )
    session.add(row)
    session.commit()

