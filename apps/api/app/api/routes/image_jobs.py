from __future__ import annotations

import base64
import binascii
from io import BytesIO
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import urlopen

from fastapi import APIRouter, BackgroundTasks, Body, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session
from PIL import Image

from app.core.config import get_settings
from app.db.session import SessionLocal, get_db_session
from app.models.image_generation_job import ImageGenerationJob
from app.models.product_asset import ProductAsset
from app.models.product_task import ProductTask
from app.schemas.image_generation_job import ImageGenerationJobOut
from app.schemas.product_asset import ProductAssetOut
from app.services.image_generation import create_job, resolve_image_prompt, run_job
from app.services.image_runtime import build_image_provider_snapshot, resolve_image_runtime
from app.services.provider_configs import get_default_provider_config, get_provider_config
from app.services.dimension_extract import run_dimension_extract
from app.services.storage_provider import LocalStorageProvider
from app.services.usage_limits import check_and_consume_image_generation, get_limits_snapshot


router = APIRouter(tags=["images"])


def _guess_ext(content_type: str | None) -> str:
    return {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
    }.get((content_type or "").lower(), ".bin")


def _load_image_bytes_from_url(url: str) -> tuple[bytes, str | None]:
    settings = get_settings()
    storage_prefix = f"{settings.public_base_url.rstrip('/')}/storage/"
    if url.startswith(storage_prefix):
        rel = url.removeprefix(storage_prefix)
        path = Path(settings.storage_root) / rel
        if not path.exists():
            raise ValueError("Local storage file not found")
        content_type = "image/png" if path.suffix.lower() == ".png" else "image/jpeg" if path.suffix.lower() in {".jpg", ".jpeg"} else "image/webp" if path.suffix.lower() == ".webp" else None
        return path.read_bytes(), content_type

    parsed = urlparse(url)
    if parsed.scheme in {"http", "https"}:
        with urlopen(url, timeout=10) as response:  # noqa: S310
            return response.read(), response.headers.get_content_type()

    path = Path(url)
    if path.exists():
        content_type = "image/png" if path.suffix.lower() == ".png" else "image/jpeg" if path.suffix.lower() in {".jpg", ".jpeg"} else "image/webp" if path.suffix.lower() == ".webp" else None
        return path.read_bytes(), content_type
    raise ValueError("Image URL/path not found")


def _decode_data_url(data_url: str) -> tuple[bytes, str | None]:
    if "," not in data_url:
        raise ValueError("Invalid dataUrl payload")
    header, encoded = data_url.split(",", 1)
    if ";base64" not in header:
        raise ValueError("Only base64 image payloads are supported")
    content_type = header.split(";")[0].removeprefix("data:")
    try:
        payload = base64.b64decode(encoded)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Invalid base64 image payload") from exc
    return payload, content_type


def _image_size(data: bytes) -> tuple[int | None, int | None]:
    try:
        img = Image.open(BytesIO(data))
        return int(img.size[0]), int(img.size[1])
    except Exception:
        return None, None


def _resolve_image_prompt_or_400(
    session: Session,
    *,
    task: ProductTask,
    prompt_type: str,
    category_id: str | None,
) -> tuple[int | None, dict[str, object], str]:
    try:
        return resolve_image_prompt(session, task=task, prompt_type=prompt_type, category_id=category_id)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"提示词解析失败（{prompt_type}）：{exc}",
        ) from exc


def _provider_snapshot(provider_config) -> dict[str, object]:
    config = provider_config.config_json or {}
    return build_image_provider_snapshot(
        {
            "provider_id": provider_config.id,
            "provider_name": provider_config.provider_name,
            "provider_display_name": provider_config.display_name,
            "api_key": None,
            "base_url": config.get("base_url"),
            "model": config.get("default_model") or "stub-v1",
            "size": config.get("default_size") or "1024x1024",
            "quality": config.get("quality") or "auto",
            "background": config.get("background") or "auto",
            "output_format": config.get("output_format") or "png",
            "supports_reference_image": bool((provider_config.capabilities_json or {}).get("supports_reference_image")),
            "pricing_json": provider_config.pricing_json or {},
        }
    ) | {"secret_config_json": provider_config.secret_config_json}


class GenerateImagesRequest(BaseModel):
    job_type: str = Field(default="single_slot", description="single_slot | carousel_4grid")
    slots: list[str] | None = Field(default=None, description="For single_slot: list of slots")
    slot: str | None = Field(default=None, description="For single_slot: single slot")
    provider_config_id: int | None = None
    model_name: str | None = None
    size: str | None = None


@router.post("/api/product-tasks/{task_id}/generate-images")
def generate_images_endpoint(
    task_id: int,
    background: BackgroundTasks,
    payload: GenerateImagesRequest = Body(...),
    x_ai_image_api_key: str | None = Header(default=None),
    x_ai_image_base_url: str | None = Header(default=None),
    x_ai_image_model: str | None = Header(default=None),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    task = session.get(ProductTask, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product task not found")

    override = {
        "image_api_key": (x_ai_image_api_key or "").strip(),
        "image_base_url": (x_ai_image_base_url or "").strip(),
        "image_model": (x_ai_image_model or "").strip(),
    }
    if payload.provider_config_id:
        provider_config = get_provider_config(session, payload.provider_config_id)
        if provider_config is None or not provider_config.enabled:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Image provider not configured/enabled")
        config = provider_config.config_json or {}
        provider_name = provider_config.provider_name
        provider_snapshot = _provider_snapshot(provider_config)
        model_name = payload.model_name or str(config.get("default_model") or "stub-v1")
        size = payload.size or str(config.get("default_size") or "1024x1024")
    else:
        runtime = resolve_image_runtime(session, override=override)
        if not runtime.get("enabled"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Image provider not configured/enabled")
        provider_name = str(runtime.get("provider_name") or "stub")
        provider_snapshot = build_image_provider_snapshot(runtime)
        model_name = payload.model_name or str(runtime.get("model") or "stub-v1")
        size = payload.size or str(runtime.get("size") or "1024x1024")

    job_ids: list[int] = []
    if payload.job_type == "carousel_4grid":
        ok, msg, exceeded = check_and_consume_image_generation(
            session, task_id=task.id, slot="carousel_4grid", provider=provider_name, count=1
        )
        if not ok:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={"message": msg, "exceeded": exceeded},
            )
        template_id, prompt_snapshot, final_prompt = _resolve_image_prompt_or_400(
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
            provider_name=provider_name,
            model_name=model_name,
            size=size,
            provider_config_snapshot=provider_snapshot,
            prompt_template_id=template_id,
            prompt_snapshot=prompt_snapshot,
            final_prompt=final_prompt,
        )
        job_ids.append(job.id)
    elif payload.job_type == "single_slot":
        slots = payload.slots or ([payload.slot] if payload.slot else None)
        if not slots:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="slots is required for single_slot")
        for slot in slots:
            ok, msg, exceeded = check_and_consume_image_generation(
                session, task_id=task.id, slot=slot, provider=provider_name, count=1
            )
            if not ok:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail={"message": msg, "exceeded": exceeded},
                )
            template_id, prompt_snapshot, final_prompt = _resolve_image_prompt_or_400(
                session,
                task=task,
                prompt_type=f"image_prompt_{slot}",
                category_id=task.selected_category_id,
            )
            job = create_job(
                session,
                task=task,
                job_type="single_slot",
                slot=slot,
                target_slots=[slot],
                provider_name=provider_name,
                model_name=model_name,
                size=size,
                provider_config_snapshot=provider_snapshot,
                prompt_template_id=template_id,
                prompt_snapshot=prompt_snapshot,
                final_prompt=final_prompt,
            )
            job_ids.append(job.id)
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported job_type")

    def _bg_run(job_ids_to_run: list[int]) -> None:
        try:
            with SessionLocal() as bg:
                for jid in job_ids_to_run:
                    run_job(bg, job_id=jid)
        except Exception:
            return

    background.add_task(_bg_run, job_ids)
    limits = get_limits_snapshot(session, task_id=task.id, slot=(payload.slot or payload.job_type), provider=provider_name)
    return {"ok": True, "task_id": task_id, "job_ids": job_ids, "limits": limits}


@router.post("/api/product-tasks/{task_id}/generate-image")
def generate_image_endpoint(
    task_id: int,
    background: BackgroundTasks,
    payload: GenerateImagesRequest = Body(...),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    payload.job_type = "single_slot"
    if not payload.slot and payload.slots and len(payload.slots) == 1:
        payload.slot = payload.slots[0]
        payload.slots = None
    if not payload.slot:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="slot is required")
    result = generate_images_endpoint(task_id, background, payload, session)
    return {"ok": True, "task_id": task_id, "job_id": (result.get("job_ids") or [None])[0]}


class GenerateSellingImagesRequest(BaseModel):
    slots: list[str] = Field(default_factory=lambda: ["carousel_1", "carousel_2", "carousel_3", "carousel_4"])
    provider_config_id: int | None = None
    model_name: str | None = None
    size: str | None = None


@router.post("/api/product-tasks/{task_id}/generate-sku-image")
def generate_sku_image_endpoint(
    task_id: int,
    background: BackgroundTasks,
    payload: GenerateImagesRequest = Body(default=GenerateImagesRequest(slot="sku_image")),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    payload.job_type = "single_slot"
    payload.slot = "sku_image"
    payload.slots = None
    result = generate_images_endpoint(task_id, background, payload, session)
    return {"ok": True, "task_id": task_id, "job_id": (result.get("job_ids") or [None])[0], "slot": "sku_image"}


@router.post("/api/product-tasks/{task_id}/generate-size-image")
def generate_size_image_endpoint(
    task_id: int,
    background: BackgroundTasks,
    payload: GenerateImagesRequest = Body(default=GenerateImagesRequest(slot="size_chart")),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    payload.job_type = "single_slot"
    payload.slot = "size_chart"
    payload.slots = None
    result = generate_images_endpoint(task_id, background, payload, session)
    return {"ok": True, "task_id": task_id, "job_id": (result.get("job_ids") or [None])[0], "slot": "size_chart"}


@router.post("/api/product-tasks/{task_id}/generate-selling-images")
def generate_selling_images_endpoint(
    task_id: int,
    background: BackgroundTasks,
    payload: GenerateSellingImagesRequest = Body(default=GenerateSellingImagesRequest()),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    slots = payload.slots or ["carousel_1", "carousel_2", "carousel_3", "carousel_4"]
    normalized = [str(slot).strip() for slot in slots if str(slot).strip()]
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="slots required")
    for slot in normalized:
        if slot not in {"carousel_1", "carousel_2", "carousel_3", "carousel_4"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"unsupported slot: {slot}")

    request = GenerateImagesRequest(
        job_type="single_slot",
        slots=normalized,
        provider_config_id=payload.provider_config_id,
        model_name=payload.model_name,
        size=payload.size,
    )
    result = generate_images_endpoint(task_id, background, request, session)
    return {"ok": True, "task_id": task_id, "job_ids": result.get("job_ids") or [], "slots": normalized}


@router.get("/api/jobs/{job_id}", response_model=ImageGenerationJobOut)
def get_job_endpoint(job_id: int, session: Session = Depends(get_db_session)) -> ImageGenerationJobOut:
    job = session.get(ImageGenerationJob, job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    return ImageGenerationJobOut.model_validate(job)


@router.get("/api/product-tasks/{task_id}/assets")
def list_assets_endpoint(
    task_id: int,
    session: Session = Depends(get_db_session),
) -> dict[str, list[ProductAssetOut]]:
    rows = session.scalars(
        select(ProductAsset)
        .where(ProductAsset.product_task_id == task_id)
        .order_by(ProductAsset.slot.asc(), ProductAsset.created_at.desc(), ProductAsset.id.desc())
    ).all()
    grouped: dict[str, list[ProductAssetOut]] = {}
    for row in rows:
        grouped.setdefault(row.slot, []).append(ProductAssetOut.model_validate(row))
    return grouped


@router.post("/api/assets/{asset_id}/set-final")
def set_final_asset_endpoint(asset_id: int, session: Session = Depends(get_db_session)) -> dict[str, object]:
    asset = session.get(ProductAsset, asset_id)
    if asset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    # only one selected per (task, slot)
    session.execute(
        update(ProductAsset)
        .where(ProductAsset.product_task_id == asset.product_task_id, ProductAsset.slot == asset.slot)
        .values(selected_for_export=False)
    )
    asset.selected_for_export = True
    session.add(asset)
    session.commit()
    return {"ok": True, "id": asset.id, "task_id": asset.product_task_id, "slot": asset.slot}


class RegenerateRequest(BaseModel):
    regeneration_feedback: str | None = None
    provider_config_id: int | None = None
    model_name: str | None = None
    size: str | None = None


@router.post("/api/assets/{asset_id}/regenerate")
def regenerate_asset_endpoint(
    asset_id: int,
    background: BackgroundTasks,
    payload: RegenerateRequest = Body(default=RegenerateRequest()),
    x_ai_image_api_key: str | None = Header(default=None),
    x_ai_image_base_url: str | None = Header(default=None),
    x_ai_image_model: str | None = Header(default=None),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    asset = session.get(ProductAsset, asset_id)
    if asset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    task = session.get(ProductTask, asset.product_task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product task not found")

    override = {
        "image_api_key": (x_ai_image_api_key or "").strip(),
        "image_base_url": (x_ai_image_base_url or "").strip(),
        "image_model": (x_ai_image_model or "").strip(),
    }
    if payload.provider_config_id:
        provider_config = get_provider_config(session, payload.provider_config_id)
        if provider_config is None or not provider_config.enabled:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Image provider not configured/enabled")
        config = provider_config.config_json or {}
        provider_name = provider_config.provider_name
        provider_snapshot = _provider_snapshot(provider_config)
        model_name = payload.model_name or str(config.get("default_model") or "stub-v1")
        size = payload.size or str(config.get("default_size") or "1024x1024")
    else:
        runtime = resolve_image_runtime(session, override=override)
        if not runtime.get("enabled"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Image provider not configured/enabled")
        provider_name = str(runtime.get("provider_name") or "stub")
        provider_snapshot = build_image_provider_snapshot(runtime)
        model_name = payload.model_name or str(runtime.get("model") or "stub-v1")
        size = payload.size or str(runtime.get("size") or "1024x1024")

    # use slot-specific single slot prompt
    template_id, prompt_snapshot, final_prompt = _resolve_image_prompt_or_400(
        session,
        task=task,
        prompt_type=f"image_prompt_{asset.slot}",
        category_id=task.selected_category_id,
    )
    if payload.regeneration_feedback:
        prompt_snapshot = {**(prompt_snapshot or {}), "regeneration_feedback": payload.regeneration_feedback}
        final_prompt = f"{final_prompt}\n\nPrevious issue to improve: {payload.regeneration_feedback}"

    job = create_job(
        session,
        task=task,
        job_type="single_slot",
        slot=asset.slot,
        target_slots=[asset.slot],
        provider_name=provider_name,
        model_name=model_name,
        size=size,
        provider_config_snapshot=provider_snapshot,
        prompt_template_id=template_id,
        prompt_snapshot=prompt_snapshot,
        final_prompt=final_prompt,
        input_asset_ids=[asset.id],
    )

    def _bg_run(job_id_to_run: int) -> None:
        try:
            with SessionLocal() as bg:
                run_job(bg, job_id=job_id_to_run)
        except Exception:
            return

    background.add_task(_bg_run, job.id)
    return {"ok": True, "job_id": job.id, "slot": asset.slot, "task_id": asset.product_task_id}


class DimensionExtractRequest(BaseModel):
    asset_id: int | None = None
    image_data_url: str | None = None


class AssignImageRequest(BaseModel):
    target_slot: str = Field(min_length=1, max_length=32)
    source_asset_id: int | None = None
    source_url: str | None = None
    image_data_url: str | None = None
    mark_as_final: bool = True


class ReorderSlotRequest(BaseModel):
    source_slot: str = Field(min_length=1, max_length=32)
    target_slot: str = Field(min_length=1, max_length=32)


class RemoveSlotImageRequest(BaseModel):
    slot: str = Field(min_length=1, max_length=32)
    compact_following: bool = True


@router.post("/api/product-tasks/{task_id}/dimension-extract")
def dimension_extract_endpoint(
    task_id: int,
    payload: DimensionExtractRequest = Body(...),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    if payload.asset_id is None and not payload.image_data_url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="asset_id or image_data_url required")

    task = session.get(ProductTask, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product task not found")

    try:
        out = run_dimension_extract(
            session,
            task=task,
            asset_id=payload.asset_id,
            image_data_url=payload.image_data_url,
        )
        return {"ok": True, "task_id": task_id, **out}
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/api/product-tasks/{task_id}/assign-image")
def assign_image_to_slot_endpoint(
    task_id: int,
    payload: AssignImageRequest = Body(...),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    task = session.get(ProductTask, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product task not found")

    source_count = sum(
        1 for value in [payload.source_asset_id, payload.source_url, payload.image_data_url] if value
    )
    if source_count != 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Exactly one of source_asset_id, source_url, image_data_url is required",
        )

    source_type = "manual_assignment"
    prompt_snapshot: dict[str, object] = {"assigned_at": "manual"}
    data: bytes
    content_type: str | None
    provider: str | None = None
    model_name: str | None = None

    if payload.source_asset_id is not None:
        source_asset = session.get(ProductAsset, payload.source_asset_id)
        if source_asset is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source asset not found")
        if not source_asset.public_url:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Source asset has no public URL")
        try:
            data, content_type = _load_image_bytes_from_url(source_asset.public_url)
        except Exception as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        source_type = "manual_asset_pick"
        provider = source_asset.provider
        model_name = source_asset.model_name
        prompt_snapshot = {
            "assigned_from_asset_id": source_asset.id,
            "assigned_from_slot": source_asset.slot,
        }
    elif payload.source_url:
        try:
            data, content_type = _load_image_bytes_from_url(payload.source_url)
        except Exception as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        source_type = "manual_raw_pick"
        prompt_snapshot = {"assigned_from_url": payload.source_url}
    else:
        try:
            data, content_type = _decode_data_url(payload.image_data_url or "")
        except Exception as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        source_type = "manual_upload"
        prompt_snapshot = {"assigned_from_upload": True}

    width, height = _image_size(data)
    ext = _guess_ext(content_type)
    storage = LocalStorageProvider(base_dir="assets")
    current_max = session.scalar(
        select(ProductAsset.version)
        .where(ProductAsset.product_task_id == task.id, ProductAsset.slot == payload.target_slot)
        .order_by(ProductAsset.version.desc())
        .limit(1)
    )
    version = int(current_max or 0) + 1
    stored = storage.put_bytes(
        key_prefix=f"task-{task.id}/{payload.target_slot}/v{version}",
        filename=f"{payload.target_slot}-v{version}{ext}",
        data=data,
    )

    if payload.mark_as_final:
        session.execute(
            update(ProductAsset)
            .where(ProductAsset.product_task_id == task.id, ProductAsset.slot == payload.target_slot)
            .values(selected_for_export=False)
        )

    asset = ProductAsset(
        product_task_id=task.id,
        sku_id=None,
        slot=payload.target_slot,
        asset_type="manual_selected",
        source_type=source_type,
        version=version,
        parent_asset_id=None,
        generation_job_id=None,
        storage_key=stored.storage_key,
        public_url=stored.public_url,
        mime_type=content_type,
        width=width,
        height=height,
        prompt_template_id=None,
        prompt_snapshot=prompt_snapshot,
        image_strategy_snapshot={},
        provider=provider,
        model_name=model_name,
        selected_for_export=payload.mark_as_final,
        status="ready",
        crop_group_id=None,
        crop_index=None,
        crop_box_json={},
    )
    session.add(asset)
    session.commit()
    session.refresh(asset)
    return {"ok": True, "task_id": task.id, "asset": ProductAssetOut.model_validate(asset)}


def _preferred_slot_asset(session: Session, *, task_id: int, slot: str) -> ProductAsset | None:
    return session.scalars(
        select(ProductAsset)
        .where(
            ProductAsset.product_task_id == task_id,
            ProductAsset.slot == slot,
            ProductAsset.status != "removed",
            ProductAsset.public_url.is_not(None),
        )
        .order_by(ProductAsset.selected_for_export.desc(), ProductAsset.created_at.desc(), ProductAsset.id.desc())
        .limit(1)
    ).first()


def _mark_slot_removed(session: Session, *, task_id: int, slot: str) -> None:
    existing_asset_count = session.scalar(
        select(func.count(ProductAsset.id)).where(
            ProductAsset.product_task_id == task_id,
            ProductAsset.slot == slot,
            ProductAsset.status != "removed",
            ProductAsset.public_url.is_not(None),
        )
    )
    if int(existing_asset_count or 0) > 0:
        return

    session.execute(
        update(ProductAsset)
        .where(ProductAsset.product_task_id == task_id, ProductAsset.slot == slot)
        .values(selected_for_export=False)
    )
    current_max = session.scalar(
        select(ProductAsset.version)
        .where(ProductAsset.product_task_id == task_id, ProductAsset.slot == slot)
        .order_by(ProductAsset.version.desc())
        .limit(1)
    )
    marker = ProductAsset(
        product_task_id=task_id,
        sku_id=None,
        slot=slot,
        asset_type="manual_removed",
        source_type="manual_removed",
        version=int(current_max or 0) + 1,
        parent_asset_id=None,
        generation_job_id=None,
        storage_key=None,
        public_url=None,
        mime_type=None,
        width=None,
        height=None,
        prompt_template_id=None,
        prompt_snapshot={"removed_at": "manual"},
        image_strategy_snapshot={},
        provider=None,
        model_name=None,
        selected_for_export=True,
        status="removed",
        crop_group_id=None,
        crop_index=None,
        crop_box_json={},
    )
    session.add(marker)


@router.post("/api/product-tasks/{task_id}/remove-slot-image")
def remove_slot_image_endpoint(
    task_id: int,
    payload: RemoveSlotImageRequest = Body(...),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    task = session.get(ProductTask, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product task not found")

    target_assets = session.scalars(
        select(ProductAsset).where(ProductAsset.product_task_id == task_id, ProductAsset.slot == payload.slot)
    ).all()

    deleted_count = len(target_assets)
    for asset in target_assets:
        session.delete(asset)

    compacted: list[dict[str, str]] = []
    carousel_slots = [f"carousel_{index}" for index in range(1, 9)]
    if payload.compact_following and payload.slot in carousel_slots:
        source_index = carousel_slots.index(payload.slot)
        for index in range(source_index + 1, len(carousel_slots)):
            from_slot = carousel_slots[index]
            to_slot = carousel_slots[index - 1]
            moved_count = session.scalar(
                select(func.count(ProductAsset.id)).where(
                    ProductAsset.product_task_id == task_id,
                    ProductAsset.slot == from_slot,
                    ProductAsset.status != "removed",
                    ProductAsset.public_url.is_not(None),
                )
            )
            if int(moved_count or 0) <= 0:
                continue
            session.execute(
                update(ProductAsset)
                .where(
                    ProductAsset.product_task_id == task_id,
                    ProductAsset.slot == from_slot,
                    ProductAsset.status != "removed",
                    ProductAsset.public_url.is_not(None),
                )
                .values(slot=to_slot)
            )
            compacted.append({"from_slot": from_slot, "to_slot": to_slot, "moved_count": str(moved_count)})

    _mark_slot_removed(session, task_id=task_id, slot=payload.slot)
    session.commit()
    return {
        "ok": True,
        "task_id": task_id,
        "slot": payload.slot,
        "deleted_count": deleted_count,
        "compacted": compacted,
    }


@router.post("/api/product-tasks/{task_id}/reorder-slots")
def reorder_slots_endpoint(
    task_id: int,
    payload: ReorderSlotRequest = Body(...),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    task = session.get(ProductTask, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product task not found")
    if payload.source_slot == payload.target_slot:
        return {"ok": True, "task_id": task_id, "source_slot": payload.source_slot, "target_slot": payload.target_slot}

    source_asset = _preferred_slot_asset(session, task_id=task_id, slot=payload.source_slot)
    if source_asset is None:
        return {
            "ok": True,
            "task_id": task_id,
            "source_slot": payload.source_slot,
            "target_slot": payload.target_slot,
            "noop": True,
            "reason": "source_slot_has_no_asset",
        }

    target_asset = _preferred_slot_asset(session, task_id=task_id, slot=payload.target_slot)
    if target_asset is None:
        source_asset.slot = payload.target_slot
        session.add(source_asset)
        session.commit()
        return {
            "ok": True,
            "task_id": task_id,
            "source_slot": payload.source_slot,
            "target_slot": payload.target_slot,
            "moved_asset_id": source_asset.id,
        }

    temp_slot = f"_swap_{source_asset.id}"[:32]
    source_asset.slot = temp_slot
    session.add(source_asset)
    session.flush()

    target_asset.slot = payload.source_slot
    source_asset.slot = payload.target_slot
    session.add(target_asset)
    session.add(source_asset)
    session.commit()
    return {
        "ok": True,
        "task_id": task_id,
        "source_slot": payload.source_slot,
        "target_slot": payload.target_slot,
        "source_asset_id": source_asset.id,
        "target_asset_id": target_asset.id,
    }
