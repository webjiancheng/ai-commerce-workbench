from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal, get_db_session
from app.models.image_generation_job import ImageGenerationJob
from app.models.product_asset import ProductAsset
from app.models.product_task import ProductTask
from app.models.provider_config import ProviderConfig
from app.services.costing import estimate_image_cost
from app.services.image_generation import create_job, resolve_image_prompt, run_job
from app.services.image_runtime import build_image_provider_snapshot
from app.services.provider_configs import get_default_provider_config


router = APIRouter(tags=["batch-ops"])


class EstimateImageCostRequest(BaseModel):
    product_task_ids: list[int] = Field(default_factory=list)
    job_type: str = Field(default="single_slot")  # single_slot | carousel_4grid
    slots: list[str] | None = None
    provider_config_id: int | None = None


@router.post("/api/product-tasks/batch/estimate-image-cost")
def estimate_image_cost_endpoint(
    payload: EstimateImageCostRequest = Body(...),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    if not payload.product_task_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="product_task_ids required")

    provider = (
        session.get(ProviderConfig, payload.provider_config_id)
        if payload.provider_config_id
        else get_default_provider_config(session, provider_type="image")
    )
    if provider is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="image provider not configured")

    if payload.job_type == "carousel_4grid":
        calls = len(payload.product_task_ids)
    else:
        slots = payload.slots or ["carousel_1"]
        calls = len(payload.product_task_ids) * len(slots)

    estimate = estimate_image_cost(provider_config=provider, job_type=payload.job_type, count=calls)
    return {"ok": True, "calls": calls, "estimate": estimate}


class RetryFailedRequest(BaseModel):
    product_task_ids: list[int] = Field(default_factory=list)
    retry_image_jobs: bool = True


@router.post("/api/product-tasks/batch/retry-failed")
def retry_failed_endpoint(
    background: BackgroundTasks,
    payload: RetryFailedRequest = Body(...),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    if not payload.product_task_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="product_task_ids required")

    job_ids: list[int] = []
    for task_id in payload.product_task_ids:
        task = session.get(ProductTask, task_id)
        if task is None:
            continue

        if payload.retry_image_jobs:
            failed_jobs = session.scalars(
                select(ImageGenerationJob)
                .where(ImageGenerationJob.product_task_id == task_id, ImageGenerationJob.status == "failed")
                .order_by(ImageGenerationJob.created_at.desc(), ImageGenerationJob.id.desc())
            ).all()
            for fj in failed_jobs[:3]:
                # skip if there is already a success job for same slot/job_type after it
                newer_success = session.scalar(
                    select(ImageGenerationJob)
                    .where(
                        ImageGenerationJob.product_task_id == task_id,
                        ImageGenerationJob.slot == fj.slot,
                        ImageGenerationJob.job_type == fj.job_type,
                        ImageGenerationJob.status == "success",
                        ImageGenerationJob.created_at > fj.created_at,
                    )
                    .limit(1)
                )
                if newer_success is not None:
                    continue

                provider = get_default_provider_config(session, provider_type="image")
                if provider is None:
                    continue
                config = provider.config_json or {}
                model_name = str(config.get("default_model") or fj.model_name)
                size = str(config.get("default_size") or fj.size)

                template_id, prompt_snapshot, final_prompt = resolve_image_prompt(
                    session,
                    task=task,
                    prompt_type="image_prompt_carousel_4grid" if fj.job_type == "carousel_4grid" else f"image_prompt_{fj.slot}",
                    category_id=task.selected_category_id,
                )
                job = create_job(
                    session,
                    task=task,
                    job_type=fj.job_type,
                    slot=fj.slot,
                    target_slots=fj.target_slots_json or [fj.slot],
                    provider_name=provider.provider_name,
                    model_name=model_name,
                    size=size,
                    provider_config_snapshot=build_image_provider_snapshot(
                        {
                            "provider_id": provider.id,
                            "provider_name": provider.provider_name,
                            "provider_display_name": provider.display_name,
                            "api_key": None,
                            "base_url": config.get("base_url"),
                            "model": model_name,
                            "size": size,
                            "quality": config.get("quality") or "auto",
                            "background": config.get("background") or "auto",
                            "output_format": config.get("output_format") or "png",
                            "supports_reference_image": bool((provider.capabilities_json or {}).get("supports_reference_image")),
                            "pricing_json": provider.pricing_json or {},
                        }
                    )
                    | {"secret_config_json": provider.secret_config_json},
                    prompt_template_id=template_id,
                    prompt_snapshot=prompt_snapshot,
                    final_prompt=final_prompt,
                    input_asset_ids=fj.input_asset_ids_json or [],
                )
                task.retry_count = int(task.retry_count or 0) + 1
                session.add(task)
                session.commit()
                job_ids.append(job.id)

    def _bg(job_ids_to_run: list[int]) -> None:
        try:
            with SessionLocal() as bg:
                for jid in job_ids_to_run:
                    run_job(bg, job_id=jid)
        except Exception:
            return

    if job_ids:
        background.add_task(_bg, job_ids)
    return {"ok": True, "queued_job_ids": job_ids, "count": len(job_ids)}
