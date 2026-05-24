from __future__ import annotations

import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from urllib.request import urlopen

from PIL import Image
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.crypto import decrypt_secret
from app.core.task_status import ImageStatus, TaskMainStatus
from app.models.image_generation_job import ImageGenerationJob
from app.models.product_ai_result import ProductAIResult
from app.models.product_asset import ProductAsset
from app.models.product_task import ProductTask
from app.models.raw_product import RawProduct
from app.services.image_providers.registry import get_image_provider
from app.services.image_runtime import build_image_provider_snapshot, resolve_image_runtime
from app.services.image_context import (
    build_compact_four_grid_context,
    build_four_grid_context,
    build_product_info_context,
)
from app.services.prompt_templates import render_template_text, resolve_prompt
from app.services.storage_provider import LocalStorageProvider
from app.services.costing import record_image_cost
from app.services.task_exceptions import clear_task_exception, record_task_exception


SLOT_PURPOSE: dict[str, str] = {
    "main": "main hero image",
    "carousel_1": "carousel main hero image",
    "carousel_2": "carousel detail close-up image",
    "carousel_3": "carousel usage scene image",
    "carousel_4": "carousel selling point image",
    "sku_image": "sku hero image",
    "preview_1": "preview image 1",
    "preview_2": "preview image 2",
    "preview_3": "preview image 3",
    "carousel_4grid": "2x2 four-panel image for cropping into carousel_1~4",
    "size_chart": "dimension size chart image",
}

PROMPT_TYPE_ALIASES: dict[str, str] = {
    "image_prompt_sku_image": "image_prompt_main",
    "image_prompt_size_chart": "image_prompt_dimension",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _decrypt_job_api_key(secret_config: dict[str, Any] | None) -> str | None:
    if not isinstance(secret_config, dict):
        return None
    encrypted = secret_config.get("api_key_enc")
    if not isinstance(encrypted, str) or not encrypted.strip():
        return None
    try:
        return decrypt_secret(encrypted.strip())
    except Exception:
        return None


def create_job(
    session: Session,
    *,
    task: ProductTask,
    job_type: str,
    slot: str,
    target_slots: list[str],
    provider_name: str,
    model_name: str,
    size: str,
    provider_config_snapshot: dict[str, Any],
    prompt_template_id: int | None,
    prompt_snapshot: dict[str, Any],
    final_prompt: str,
    reference_asset_ids: list[int] | None = None,
    input_asset_ids: list[int] | None = None,
) -> ImageGenerationJob:
    job = ImageGenerationJob(
        product_task_id=task.id,
        job_type=job_type,
        slot=slot,
        target_slots_json=target_slots,
        reference_asset_ids_json=reference_asset_ids or [],
        input_asset_ids_json=input_asset_ids or [],
        prompt_template_id=prompt_template_id,
        prompt_snapshot=prompt_snapshot or {},
        final_prompt=final_prompt,
        provider=provider_name,
        model_name=model_name,
        size=size,
        provider_config_snapshot=provider_config_snapshot or {},
        status="queued",
        progress=0,
    )
    session.add(job)
    task.main_status = TaskMainStatus.image_running.value
    task.image_status = ImageStatus.running.value
    session.add(task)
    session.commit()
    session.refresh(job)
    return job


def run_job(session: Session, *, job_id: int) -> None:
    job = session.get(ImageGenerationJob, job_id)
    if job is None:
        return
    task = session.get(ProductTask, job.product_task_id)
    if task is None:
        return

    job.status = "running"
    job.started_at = _now()
    job.progress = 5
    session.add(job)
    session.commit()

    try:
        provider = get_image_provider(job.provider)
        storage = LocalStorageProvider(base_dir="assets")
        capabilities = (job.provider_config_snapshot or {}).get("capabilities_json") or {}

        if job.provider != "stub" and not capabilities.get("api_key_configured", False):
            record_task_exception(
                task,
                code="image_provider_stub",
                level="warning",
                status="needs_config",
                message="当前默认图片 provider 缺少可用配置，四宫格无法按真实 AI 生图链路执行。",
            )
        else:
            clear_task_exception(task, code="image_provider_stub")

        if job.provider != "stub" and not capabilities.get("supports_reference_image", False):
            record_task_exception(
                task,
                code="reference_image_ignored",
                level="warning",
                status="provider_limit",
                message="当前图片 provider 不支持参考图输入，页面截图和原图不会真实参与四宫格生成。",
            )
        else:
            clear_task_exception(task, code="reference_image_ignored")
        session.add(task)
        session.commit()

        # record estimated cost snapshot (actual may be filled later when provider supports it)
        unit_cost = None
        currency = "USD"
        try:
            pricing = (job.provider_config_snapshot or {}).get("pricing_json") or {}
            unit_cost = pricing.get("estimated_cost_per_image")
            currency = pricing.get("currency") or currency
        except Exception:
            pass
        if unit_cost is not None:
            try:
                record_image_cost(
                    session,
                    product_task_id=task.id,
                    job_id=job.id,
                    provider=job.provider,
                    model_name=job.model_name,
                    job_type=job.job_type,
                    estimated_cost=float(unit_cost),
                    actual_cost=None,
                    currency=str(currency),
                )
            except Exception:
                pass

        raw = session.get(RawProduct, task.raw_product_id)
        reference_images = _resolve_reference_images(raw=raw, slot=job.slot)
        config = (job.provider_config_snapshot or {}).get("config_json") or {}
        secret = (job.provider_config_snapshot or {}).get("secret_config_json") or {}
        provider_options = {
            "base_url": config.get("base_url"),
            "quality": config.get("quality") or "auto",
            "background": config.get("background") or "auto",
            "output_format": config.get("output_format") or "png",
            "api_key": _decrypt_job_api_key(secret),
        }
        generated = provider.generate_image(
            prompt=job.final_prompt,
            reference_images=reference_images or None,
            size=job.size,
            model=job.model_name,
            extra_options={
                "job_type": job.job_type,
                "slot": job.slot,
                "reference_image_count": len(reference_images),
            },
            provider_options=provider_options,
        )
        job.progress = 60
        session.add(job)
        session.commit()

        parent_asset_id: int | None = None
        output_asset_ids: list[int] = []

        if job.job_type == "carousel_4grid":
            parent_asset_id = _create_asset_for_bytes(
                session,
                task_id=task.id,
                slot="carousel_4grid",
                asset_type="ai_generated_parent",
                source_type="ai_generation",
                provider=job.provider,
                model_name=job.model_name,
                storage=storage,
                content_type=generated.content_type,
                data=generated.data,
                width=generated.width,
                height=generated.height,
                generation_job_id=job.id,
                parent_asset_id=None,
                crop_index=None,
                crop_box=None,
                prompt_template_id=job.prompt_template_id,
                prompt_snapshot=job.prompt_snapshot,
            )
            job.parent_asset_id = parent_asset_id
            session.add(job)
            session.commit()

            job.progress = 75
            session.add(job)
            session.commit()

            child_ids = _crop_4grid_into_assets(
                session,
                task_id=task.id,
                parent_asset_id=parent_asset_id,
                job_id=job.id,
                storage=storage,
            )
            output_asset_ids.extend(child_ids)
        else:
            # single_slot
            slot = job.slot
            asset_id = _create_asset_for_bytes(
                session,
                task_id=task.id,
                slot=slot,
                asset_type="ai_generated",
                source_type="ai_generation",
                provider=job.provider,
                model_name=job.model_name,
                storage=storage,
                content_type=generated.content_type,
                data=generated.data,
                width=generated.width,
                height=generated.height,
                generation_job_id=job.id,
                parent_asset_id=None,
                crop_index=None,
                crop_box=None,
                prompt_template_id=job.prompt_template_id,
                prompt_snapshot=job.prompt_snapshot,
            )
            output_asset_ids.append(asset_id)

        job.output_asset_ids_json = output_asset_ids
        job.status = "success"
        job.progress = 100
        job.finished_at = _now()
        job.error_message = None
        session.add(job)

        # naive status update: if we generated anything -> partial/success
        task.image_status = ImageStatus.success.value
        task.main_status = TaskMainStatus.review_ready.value
        clear_task_exception(task, code="image_generation_failed")
        session.add(task)
        session.commit()
    except Exception as exc:
        job.status = "failed"
        job.progress = min(job.progress, 95)
        job.error_message = str(exc)
        job.finished_at = _now()
        session.add(job)
        task.image_status = ImageStatus.failed.value
        task.main_status = TaskMainStatus.failed.value
        record_task_exception(
            task,
            code="image_generation_failed",
            level="failed",
            status="image_failed",
            message=f"Image generation failed: {exc}",
        )
        session.add(task)
        session.commit()


def _next_version(session: Session, *, task_id: int, slot: str) -> int:
    current = session.scalar(
        select(func.max(ProductAsset.version)).where(
            ProductAsset.product_task_id == task_id, ProductAsset.slot == slot
        )
    )
    return int(current or 0) + 1


def _resolve_reference_images(*, raw: RawProduct | None, slot: str) -> list[bytes]:
    if raw is None:
        return []

    slot_to_urls: dict[str, list[str | None]] = {
        "carousel_4grid": [
            raw.screenshot_url,
            raw.main_image,
            *(raw.carousel_images or [])[:3],
        ],
        "main": [raw.screenshot_url, raw.main_image, *(raw.carousel_images or [])[:2]],
        "carousel_1": [raw.screenshot_url, raw.main_image, *(raw.carousel_images or [])[:2]],
        "carousel_2": [*(raw.detail_images or [])[:3], raw.main_image, raw.screenshot_url],
        "carousel_3": [raw.screenshot_url, raw.main_image, *(raw.detail_images or [])[:1]],
        "carousel_4": [raw.main_image, *(raw.detail_images or [])[:2], raw.screenshot_url],
        "preview_1": [raw.main_image, raw.screenshot_url, *(raw.carousel_images or [])[:1]],
        "preview_2": [*(raw.detail_images or [])[:2], raw.main_image],
        "preview_3": [raw.screenshot_url, *(raw.carousel_images or [])[:2]],
        "size_chart": [*(raw.size_chart_images or [])[:3], raw.screenshot_url],
    }
    urls = slot_to_urls.get(slot, [raw.screenshot_url, raw.main_image, *(raw.carousel_images or [])[:2]])
    out: list[bytes] = []
    seen: set[str] = set()
    for url in urls:
        item = (url or "").strip()
        if not item or item in seen:
            continue
        seen.add(item)
        data = _read_reference_url(item)
        if data:
            out.append(data)
        if len(out) >= 4:
            break
    return out


def _read_reference_url(url: str) -> bytes | None:
    try:
        settings = get_settings()
        storage_prefix = f"{settings.public_base_url.rstrip('/')}/storage/"
        if url.startswith(storage_prefix):
            rel = url.removeprefix(storage_prefix)
            path = Path(settings.storage_root) / rel
            if path.exists():
                return path.read_bytes()

        parsed = urlparse(url)
        if parsed.scheme in {"http", "https"}:
            with urlopen(url, timeout=5) as response:  # noqa: S310 - trusted local/user image URLs
                return response.read()

        path = Path(url)
        if path.exists():
            return path.read_bytes()
    except Exception:
        return None
    return None


def _create_asset_for_bytes(
    session: Session,
    *,
    task_id: int,
    slot: str,
    asset_type: str,
    source_type: str,
    provider: str,
    model_name: str,
    storage: LocalStorageProvider,
    content_type: str,
    data: bytes,
    width: int,
    height: int,
    generation_job_id: int | None,
    parent_asset_id: int | None,
    crop_index: int | None,
    crop_box: dict[str, int] | None,
    prompt_template_id: int | None,
    prompt_snapshot: dict[str, Any] | None,
) -> int:
    version = _next_version(session, task_id=task_id, slot=slot)
    ext = ".png" if content_type == "image/png" else ".bin"
    stored = storage.put_bytes(
        key_prefix=f"task-{task_id}/{slot}/v{version}",
        filename=f"{slot}-v{version}{ext}",
        data=data,
    )
    asset = ProductAsset(
        product_task_id=task_id,
        sku_id=None,
        slot=slot,
        asset_type=asset_type,
        source_type=source_type,
        version=version,
        parent_asset_id=parent_asset_id,
        generation_job_id=generation_job_id,
        storage_key=stored.storage_key,
        public_url=stored.public_url,
        mime_type=content_type,
        width=width,
        height=height,
        prompt_template_id=prompt_template_id,
        prompt_snapshot=prompt_snapshot or {},
        image_strategy_snapshot={},
        provider=provider,
        model_name=model_name,
        selected_for_export=False,
        status="ready",
        crop_group_id=None,
        crop_index=crop_index,
        crop_box_json=crop_box or {},
    )
    session.add(asset)
    session.commit()
    session.refresh(asset)
    return asset.id


def _crop_4grid_into_assets(
    session: Session,
    *,
    task_id: int,
    parent_asset_id: int,
    job_id: int,
    storage: LocalStorageProvider,
) -> list[int]:
    parent = session.get(ProductAsset, parent_asset_id)
    if parent is None or not parent.storage_key:
        raise RuntimeError("Missing parent asset for 4-grid crop")

    settings = get_settings()
    from pathlib import Path

    parent_path = Path(settings.storage_root) / parent.storage_key
    img = Image.open(parent_path)
    img = img.convert("RGB")

    w, h = img.size
    half_w = math.floor(w / 2)
    half_h = math.floor(h / 2)

    # Mapping: TL, TR, BL, BR
    crops = [
        ("carousel_1", 1, (0, 0, half_w, half_h)),
        ("carousel_2", 2, (half_w, 0, w, half_h)),
        ("carousel_3", 3, (0, half_h, half_w, h)),
        ("carousel_4", 4, (half_w, half_h, w, h)),
    ]
    group_id = f"job-{job_id}-parent-{parent_asset_id}"

    out_ids: list[int] = []
    for slot, crop_index, box in crops:
        cropped = img.crop(box)
        data = _pil_to_png(cropped)
        crop_box = {"left": int(box[0]), "top": int(box[1]), "right": int(box[2]), "bottom": int(box[3])}
        asset_id = _create_asset_for_bytes(
            session,
            task_id=task_id,
            slot=slot,
            asset_type="ai_generated",
            source_type="crop_from_4grid",
            provider=parent.provider or "unknown",
            model_name=parent.model_name or "unknown",
            storage=storage,
            content_type="image/png",
            data=data,
            width=cropped.size[0],
            height=cropped.size[1],
            generation_job_id=job_id,
            parent_asset_id=parent_asset_id,
            crop_index=crop_index,
            crop_box=crop_box,
            prompt_template_id=parent.prompt_template_id,
            prompt_snapshot=parent.prompt_snapshot,
        )
        asset = session.get(ProductAsset, asset_id)
        if asset is not None:
            asset.crop_group_id = group_id
            session.add(asset)
            session.commit()
        out_ids.append(asset_id)
    return out_ids


def _pil_to_png(image: Image.Image) -> bytes:
    import io

    buf = io.BytesIO()
    image.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def _has_ai_output(payload: Any) -> bool:
    return isinstance(payload, dict) and isinstance(payload.get("output"), dict) and bool(payload.get("output"))


def _ensure_prompt_upstream_outputs(session: Session, *, task_id: int) -> None:
    ai = session.scalar(select(ProductAIResult).where(ProductAIResult.task_id == task_id))
    task = session.get(ProductTask, task_id)
    from app.services.ai_pipeline import _normalize_generation_mode, GenerationMode
    norm_mode = _normalize_generation_mode(task.generation_mode) if task else ""
    missing_steps: list[str] = []
    if not _has_ai_output((ai.title_package if isinstance(ai, ProductAIResult) else None) or {}):
        missing_steps.append("title_package")
    # 商品理解关闭时，四宫格使用原始采集字段构建轻量上下文。
    if norm_mode == GenerationMode.title_and_4grid.value and bool(getattr(task, "include_product_info", True)):
        if not _has_ai_output((ai.product_info if isinstance(ai, ProductAIResult) else None) or {}):
            missing_steps.append("product_info_from_screenshot")
    if not missing_steps:
        return
    from app.services.ai_pipeline import run_ai_pipeline_for_task
    run_ai_pipeline_for_task(session, task_id=task_id, prompt_types=missing_steps)


def build_image_prompt_variables(session: Session, *, task: ProductTask, slot: str | None = None) -> dict[str, Any]:
    raw = session.get(RawProduct, task.raw_product_id)
    ai = session.scalar(select(ProductAIResult).where(ProductAIResult.task_id == task.id))

    category_path = None
    product_info = None
    title_cn = None
    title_package = None
    title_en_package = None
    selling_points: list[str] = []
    category_out: dict[str, Any] = {}

    if isinstance(ai, ProductAIResult):
        category_out = (ai.category_match or {}).get("output") if isinstance(ai.category_match, dict) else {}
        category_path = task.selected_category_id or (category_out or {}).get("best_path") or (category_out or {}).get("selected_category")
        product_info = ((ai.product_info or {}).get("output") or None)
        title_package = ((ai.title_package or {}).get("output") or None)
        title_cn = title_package.get("title_cn") if isinstance(title_package, dict) else None
        if isinstance(title_package, dict) and title_package.get("title_en"):
            title_en_package = {
                "title_en": title_package.get("title_en"),
            }
        else:
            title_en_package = ((ai.title_en or {}).get("output") or None)
        if isinstance(title_package, dict):
            raw_points = title_package.get("selling_points") or title_package.get("highlights") or []
            if isinstance(raw_points, list):
                selling_points = [str(item).strip() for item in raw_points if str(item).strip()]

    product_info_obj = product_info if isinstance(product_info, dict) else {}
    four_grid_context = build_four_grid_context(
        raw=raw,
        task=task,
        title_package=title_package if isinstance(title_package, dict) else {},
        product_info=product_info_obj,
    )
    if slot == "carousel_4grid":
        reference_images = dict(four_grid_context.get("reference_images") or {})
        reference_images["detail_images"] = []
        four_grid_context = {
            **four_grid_context,
            "reference_images": reference_images,
        }
    product_info_context = build_product_info_context(four_grid_context)
    four_grid_prompt_context = build_compact_four_grid_context(four_grid_context)

    return {
        "raw_title": (raw.title if raw else task.title),
        "title": (raw.title if raw else task.title),
        "optimized_title_cn": title_cn or task.title,
        "selected_category_path": category_path or "",
        "category_path": category_path or "",
        "resolved_category_path": category_path or "",
        "category_match": category_out if isinstance(category_out, dict) else {},
        "product_info": product_info_context,
        "product_info_context": product_info_context,
        "four_grid_context": four_grid_prompt_context,
        "four_grid_full_context": four_grid_context,
        "four_grid_prompt_context": four_grid_prompt_context,
        "title_package": title_package or {},
        "title_en_with_cn_translation": title_en_package or {},
        "selling_points": selling_points,
        "material": "",
        "target_user": "",
        "scenes": product_info_context.get("scene_words") or [],
        "reference_image_notes": raw.screenshot_url if raw else "",
        "reference_images": four_grid_context.get("reference_images") or {},
        "slot": slot or "",
        "slot_purpose": SLOT_PURPOSE.get(slot or "", ""),
    }


def resolve_image_prompt(
    session: Session,
    *,
    task: ProductTask,
    prompt_type: str,
    category_id: str | None,
) -> tuple[int | None, dict[str, Any], str]:
    _ensure_prompt_upstream_outputs(session, task_id=task.id)

    effective_prompt_type = PROMPT_TYPE_ALIASES.get(prompt_type, prompt_type)
    template = resolve_prompt(session, prompt_type=effective_prompt_type, task_id=task.id, category_id=category_id)
    if template is None:
        raise RuntimeError(f"No enabled prompt template found for prompt_type={effective_prompt_type}")
    inferred_slot: str | None = None
    if prompt_type.startswith("image_prompt_"):
        inferred_slot = prompt_type.removeprefix("image_prompt_")
    variables = build_image_prompt_variables(session, task=task, slot=inferred_slot)
    rendered = render_template_text(template_text=template.template_text, variables=variables)
    snapshot = {
        "prompt_type": effective_prompt_type,
        "requested_prompt_type": prompt_type,
        "template_id": template.id,
        "scope": template.scope,
        "category_id": template.category_id,
        "task_id": template.task_id,
        "version": template.version,
        "variables": variables,
    }
    return template.id, snapshot, rendered


def auto_generate_and_crop_4grid_for_task(session: Session, *, task: ProductTask) -> int:
    runtime = resolve_image_runtime(session)
    if not runtime.get("enabled"):
        raise RuntimeError("Image provider not configured/enabled")

    template_id, prompt_snapshot, final_prompt = resolve_image_prompt(
        session,
        task=task,
        prompt_type="image_prompt_carousel_4grid",
        category_id=task.selected_category_id,
    )
    job = create_job(
        session,
        task=task,
        job_type="carousel_4grid",
        slot="carousel_4grid",
        target_slots=["carousel_1", "carousel_2", "carousel_3", "carousel_4"],
        provider_name=str(runtime.get("provider_name") or "stub"),
        model_name=str(runtime.get("model") or "stub-v1"),
        size=str(runtime.get("size") or "1024x1024"),
        provider_config_snapshot=build_image_provider_snapshot(runtime),
        prompt_template_id=template_id,
        prompt_snapshot=prompt_snapshot,
        final_prompt=final_prompt,
    )
    run_job(session, job_id=job.id)
    return job.id
