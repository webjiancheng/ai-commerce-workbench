from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Header, Query, status
from sqlalchemy.orm import Session

from app.core.task_status import CategoryStatus, GenerationMode, TaskMainStatus
from app.db.session import get_db_session
from app.db.session import SessionLocal
from app.models.product_task import ProductTask
from app.schemas.product_task import ProductTaskCreateResponse
from app.schemas.raw_product import (
    RawProductBatchCreateTasksIn,
    RawProductBatchDeleteIn,
    RawProductCreate,
    RawProductDetail,
    RawProductUpdate,
    RawProductListItem,
    RawProductListResponse,
    ScreenshotUploadIn,
)
from app.services.file_storage import save_data_url_image
from app.services.product_tasks import create_task_from_raw_product, list_tasks_by_raw_product_id
from app.services.raw_products import create_raw_product, delete_raw_product, get_raw_product, list_raw_products
from app.services.raw_products import update_raw_product
from app.services.openai_client import is_openai_configured
from app.services.openai_client import runtime_override
from app.services.task_bootstrap import run_task_bootstrap_pipeline
from app.services.task_exceptions import record_task_exception


router = APIRouter(tags=["raw-products"])


@router.post("/sync/screenshot")
def sync_screenshot(payload: ScreenshotUploadIn) -> dict[str, object]:
    try:
        url = save_data_url_image(product_id=payload.product_id, data_url=payload.data_url)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return {"ok": True, "url": url}


@router.post("/api/raw-products")
def create_raw_product_endpoint(
    payload: RawProductCreate, session: Session = Depends(get_db_session)
) -> dict[str, object]:
    product = create_raw_product(session, payload)
    return {"ok": True, "id": product.id, "generated": {}}


@router.get("/api/raw-products", response_model=RawProductListResponse)
def list_raw_products_endpoint(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_db_session),
) -> RawProductListResponse:
    items, total = list_raw_products(session, limit=limit, offset=offset)
    rows: list[RawProductListItem] = []
    for item in items:
        tasks = list_tasks_by_raw_product_id(session, item.id)
        task = tasks[0] if tasks else None
        image_count = len(item.carousel_images or []) or len(item.detail_images or [])
        if item.main_image:
            image_count += 1
        rows.append(
            RawProductListItem(
                id=item.id,
                platform=item.platform,
                title=item.title,
                price=item.price,
                platform_sku=item.platform_sku,
                source_id=item.source_id,
                collector=item.collector,
                screenshot_url=item.screenshot_url,
                main_image=item.main_image,
                carousel_images=item.carousel_images or [],
                sku_images=item.sku_images or [],
                detail_images=item.detail_images or [],
                size_chart_images=item.size_chart_images or [],
                image_count=image_count,
                sku_count=len(item.sku_images or []),
                task_id=task.id if task else None,
                task_created=task is not None,
                created_at=item.created_at,
            )
        )
    return RawProductListResponse(items=rows, total=total, limit=limit, offset=offset)


@router.get("/api/raw-products/{product_id}", response_model=RawProductDetail)
def get_raw_product_endpoint(
    product_id: int, session: Session = Depends(get_db_session)
) -> RawProductDetail:
    product = get_raw_product(session, product_id)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Raw product not found")
    return RawProductDetail.model_validate(product)


@router.delete("/api/raw-products/{product_id}")
def delete_raw_product_endpoint(
    product_id: int, session: Session = Depends(get_db_session)
) -> dict[str, object]:
    product = get_raw_product(session, product_id)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Raw product not found")

    delete_raw_product(session, product)
    return {"ok": True, "id": product_id}


@router.patch("/api/raw-products/{product_id}", response_model=RawProductDetail)
def update_raw_product_endpoint(
    product_id: int,
    payload: RawProductUpdate,
    session: Session = Depends(get_db_session),
) -> RawProductDetail:
    product = get_raw_product(session, product_id)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Raw product not found")
    updated = update_raw_product(session, product, payload)
    return RawProductDetail.model_validate(updated)


@router.post("/api/raw-products/batch/create-tasks")
def batch_create_tasks_from_raw_products_endpoint(
    background: BackgroundTasks,
    payload: RawProductBatchCreateTasksIn = Body(...),
    x_ai_api_key: str | None = Header(default=None),
    x_ai_base_url: str | None = Header(default=None),
    x_ai_model: str | None = Header(default=None),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    if not payload.raw_product_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="raw_product_ids required")
    override = {
        "api_key": (x_ai_api_key or "").strip(),
        "base_url": (x_ai_base_url or "").strip(),
        "model": (x_ai_model or "").strip(),
    }
    if payload.generation_mode != GenerationMode.no_ai and not is_openai_configured(session, override=override):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="AI 文本模型 API Key 未配置，当前生成模式不能继续。请先到 AI 设置页完成配置。",
        )

    batch_no = f"B{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    results: list[ProductTaskCreateResponse] = []
    created_task_ids: list[int] = []

    for raw_product_id in payload.raw_product_ids:
        raw_product = get_raw_product(session, raw_product_id)
        if raw_product is None:
            continue

        existing_tasks = list_tasks_by_raw_product_id(session, raw_product_id)
        target_count = max(1, payload.split_count)
        if len(existing_tasks) >= target_count:
            first_task = existing_tasks[0]
            results.append(
                ProductTaskCreateResponse(
                    ok=True,
                    id=first_task.id,
                    raw_product_id=first_task.raw_product_id,
                    main_status=first_task.main_status,
                    generation_mode=first_task.generation_mode,
                    existed=True,
                    split_index=first_task.split_index,
                    split_total=target_count,
                )
            )
            continue

        for split_index in range(len(existing_tasks) + 1, target_count + 1):
            task = create_task_from_raw_product(
                session,
                raw_product,
                split_index=split_index,
                split_total=target_count,
                generation_mode=payload.generation_mode.value,
            )
            created_task_ids.append(task.id)
            results.append(
                ProductTaskCreateResponse(
                    ok=True,
                    id=task.id,
                    raw_product_id=task.raw_product_id,
                    main_status=task.main_status,
                    generation_mode=task.generation_mode,
                    existed=False,
                    split_index=task.split_index,
                    split_total=task.split_total,
                )
            )

    def _bg_bootstrap(task_ids: list[int], runtime: dict[str, str]) -> None:
        with runtime_override(runtime):
            with SessionLocal() as bg_session:
                for tid in task_ids:
                    try:
                        run_task_bootstrap_pipeline(bg_session, task_id=tid)
                    except Exception as exc:
                        task = bg_session.get(ProductTask, tid)
                        if task is None:
                            continue
                        task.main_status = TaskMainStatus.failed.value
                        task.category_status = CategoryStatus.failed.value
                        record_task_exception(
                            task,
                            code="bootstrap_failed",
                            level="failed",
                            status="bootstrap_failed",
                            message=f"bootstrap failed: {exc}",
                        )
                        bg_session.add(task)
                        bg_session.commit()

    if created_task_ids:
        background.add_task(_bg_bootstrap, created_task_ids, override)

    created_count = sum(1 for item in results if not item.existed)
    existed_count = sum(1 for item in results if item.existed)
    return {
        "ok": True,
        "batch_no": batch_no,
        "created_count": created_count,
        "existed_count": existed_count,
        "items": [item.model_dump(mode="json") for item in results],
    }


@router.post("/api/raw-products/batch/delete")
def batch_delete_raw_products_endpoint(
    payload: RawProductBatchDeleteIn = Body(...),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    if not payload.raw_product_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="raw_product_ids required")

    deleted_ids: list[int] = []

    for raw_product_id in payload.raw_product_ids:
        product = get_raw_product(session, raw_product_id)
        if product is None:
            continue
        delete_raw_product(session, product)
        deleted_ids.append(raw_product_id)

    return {
        "ok": True,
        "deleted_count": len(deleted_ids),
        "deleted_ids": deleted_ids,
    }
