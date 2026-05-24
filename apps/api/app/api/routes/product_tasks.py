from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Header, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.core.task_status import CategoryStatus, ExportStatus, GenerationMode, TaskMainStatus
from app.db.session import SessionLocal
from app.db.session import get_db_session
from app.models.product_asset import ProductAsset
from app.schemas.export_field_draft import ExportFieldDraftOut
from app.schemas.product_asset import ProductAssetOut
from app.schemas.product_task import (
    ProductTaskCreateResponse,
    ProductTaskDetail,
    ProductTaskListResponse,
    ProductTaskTimelineResponse,
    ProductTaskUpdate,
)
from app.schemas.raw_product import RawProductDetail
from pydantic import BaseModel, Field

from app.services.ai_pipeline import run_ai_pipeline_for_task
from app.services.category_dictionary import search_category_paths
from app.services.export_fields import get_export_field_draft, patch_export_fields_manual
from app.services.image_runtime import resolve_image_runtime
from app.services.openai_client import is_openai_configured, runtime_override
from app.services.product_tasks import (
    build_ai_summary,
    create_task_from_raw_product,
    delete_product_task,
    get_product_task,
    get_ai_result_for_task,
    get_product_task_timeline,
    list_tasks_by_raw_product_id,
    list_product_tasks,
    update_product_task,
)
from app.services.raw_products import get_raw_product
from app.services.task_bootstrap import run_task_bootstrap_pipeline
from app.services.task_exceptions import record_task_exception


router = APIRouter(tags=["product-tasks"])


def _mark_background_failure(session: Session, *, task_id: int, exc: Exception, status_code: str) -> None:
    task = get_product_task(session, task_id)
    if task is None:
        return
    task.main_status = TaskMainStatus.failed.value
    task.category_status = CategoryStatus.failed.value
    record_task_exception(
        task,
        code=status_code,
        level="failed",
        status=status_code,
        message=f"{status_code}: {exc}",
    )
    session.add(task)
    session.commit()


class RunAiRequest(BaseModel):
    prompt_types: list[str] | None = Field(default=None, description="Run only selected prompt types")


class CreateTaskFromRawIn(BaseModel):
    split_count: int = Field(default=1, ge=1, le=50)
    generation_mode: GenerationMode = GenerationMode.title_and_4grid
    include_product_info: bool = True


class SelectCategoryRequest(BaseModel):
    category_path: str = Field(min_length=1)


class FieldChoiceRequest(BaseModel):
    field_key: str = Field(min_length=1)
    selected_source: str = Field(min_length=1, description="raw | ai | manual")
    manual_value: str | None = None


class CategorySearchItem(BaseModel):
    path: str
    leaf: str


class CategorySearchResponse(BaseModel):
    items: list[CategorySearchItem]
    total: int
    query: str


@router.post(
    "/api/raw-products/{raw_product_id}/create-task",
    response_model=ProductTaskCreateResponse,
)
def create_task_from_raw_product_endpoint(
    raw_product_id: int,
    background: BackgroundTasks,
    payload: CreateTaskFromRawIn | None = Body(default=None),
    x_ai_api_key: str | None = Header(default=None),
    x_ai_base_url: str | None = Header(default=None),
    x_ai_model: str | None = Header(default=None),
    x_ai_image_api_key: str | None = Header(default=None),
    x_ai_image_base_url: str | None = Header(default=None),
    x_ai_image_model: str | None = Header(default=None),
    session: Session = Depends(get_db_session),
) -> ProductTaskCreateResponse:
    raw_product = get_raw_product(session, raw_product_id)
    if raw_product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Raw product not found")

    split_count = max(1, payload.split_count if payload else 1)
    generation_mode = (payload.generation_mode if payload else GenerationMode.title_and_4grid).value
    include_product_info = payload.include_product_info if payload else True
    override = {
        "api_key": (x_ai_api_key or "").strip(),
        "base_url": (x_ai_base_url or "").strip(),
        "model": (x_ai_model or "").strip(),
        "image_api_key": (x_ai_image_api_key or "").strip(),
        "image_base_url": (x_ai_image_base_url or "").strip(),
        "image_model": (x_ai_image_model or "").strip(),
    }
    if generation_mode not in {GenerationMode.task_only.value, GenerationMode.no_ai.value} and not is_openai_configured(session, override=override):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="AI 文本模型 API Key 未配置，当前生成模式不能继续。请先到 AI 设置页完成配置。",
        )

    if generation_mode in {"title_and_4grid", "title_and_image_prompts", "full_later"}:
        image_runtime = resolve_image_runtime(session, override=override)
        if (
            not image_runtime.get("enabled")
            or str(image_runtime.get("provider_name") or "") == "stub"
            or not image_runtime.get("api_key")
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="图片生成 Provider 未配置或未启用，当前模式（AI 标题+类目+自动四宫格）无法继续。请先到 AI 设置页配置图片生成模型。",
            )

    existing_tasks = list_tasks_by_raw_product_id(session, raw_product_id)
    # 已有任务时继续追加创建，不阻止
    created_task_ids: list[int] = []
    # 基于已有任务数量，从下一个 split_index 开始创建
    start_index = len(existing_tasks) + 1
    end_index = start_index + split_count - 1
    task = None
    for split_index in range(start_index, end_index + 1):
        task = create_task_from_raw_product(
            session,
            raw_product,
            split_index=split_index,
            split_total=split_count,
            generation_mode=generation_mode,
            include_product_info=include_product_info,
        )
        created_task_ids.append(task.id)

    if task is None:
        task = create_task_from_raw_product(
            session,
            raw_product,
            split_index=1,
            split_total=split_count,
            generation_mode=generation_mode,
            include_product_info=include_product_info,
        )
        created_task_ids.append(task.id)

    def _bg_bootstrap(task_ids: list[int], runtime: dict[str, str]) -> None:
        with runtime_override(runtime):
            with SessionLocal() as bg_session:
                for tid in task_ids:
                    try:
                        run_task_bootstrap_pipeline(bg_session, task_id=tid)
                    except Exception as exc:
                        _mark_background_failure(
                            bg_session,
                            task_id=tid,
                            exc=exc,
                            status_code="bootstrap_failed",
                        )

    if created_task_ids:
        background.add_task(_bg_bootstrap, created_task_ids, override)

    return ProductTaskCreateResponse(
        ok=True,
        id=task.id,
        raw_product_id=task.raw_product_id,
        main_status=TaskMainStatus(task.main_status),
        generation_mode=GenerationMode(task.generation_mode),
        include_product_info=task.include_product_info,
        split_index=task.split_index,
        split_total=task.split_total,
    )


@router.get("/api/product-tasks", response_model=ProductTaskListResponse)
def list_product_tasks_endpoint(
    status: TaskMainStatus | None = Query(default=None),
    category_status: CategoryStatus | None = Query(default=None),
    image_status: str | None = Query(default=None),
    export_status: ExportStatus | None = Query(default=None),
    exception: bool | None = Query(default=None),
    low_confidence: bool | None = Query(default=None),
    keyword: str | None = Query(default=None, min_length=1, max_length=100),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_db_session),
) -> ProductTaskListResponse:
    items, total = list_product_tasks(
        session,
        limit=limit,
        offset=offset,
        main_status=status.value if status else None,
        category_status=category_status.value if category_status else None,
        image_status=image_status,
        export_status=export_status.value if export_status else None,
        exception_only=exception,
        low_confidence=low_confidence,
        keyword=keyword,
    )
    return ProductTaskListResponse(items=items, total=total, limit=limit, offset=offset)


@router.get("/api/product-tasks/{task_id}", response_model=ProductTaskDetail)
def get_product_task_endpoint(task_id: int, session: Session = Depends(get_db_session)) -> ProductTaskDetail:
    task = get_product_task(session, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product task not found")
    ai_row = get_ai_result_for_task(session, task_id)
    payload = ProductTaskDetail.model_validate(task)
    payload.ai = build_ai_summary(ai_row)
    return payload


@router.get("/api/product-tasks/{task_id}/timeline", response_model=ProductTaskTimelineResponse)
def get_product_task_timeline_endpoint(
    task_id: int, session: Session = Depends(get_db_session)
) -> ProductTaskTimelineResponse:
    task = get_product_task(session, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product task not found")
    return get_product_task_timeline(session, task)


@router.get("/api/product-tasks/{task_id}/workbench-detail")
def get_product_task_workbench_detail_endpoint(
    task_id: int,
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    task = get_product_task(session, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product task not found")

    raw = get_raw_product(session, task.raw_product_id)
    ai_row = get_ai_result_for_task(session, task_id)
    draft = get_export_field_draft(session, task_id=task_id)
    assets = session.scalars(
        select(ProductAsset)
        .where(ProductAsset.product_task_id == task_id)
        .order_by(ProductAsset.slot.asc(), ProductAsset.created_at.desc(), ProductAsset.id.desc())
    ).all()
    assets_by_slot: dict[str, list[ProductAssetOut]] = {}
    for asset in assets:
        assets_by_slot.setdefault(asset.slot, []).append(ProductAssetOut.model_validate(asset))

    task_payload = ProductTaskDetail.model_validate(task)
    task_payload.ai = build_ai_summary(ai_row)
    return {
        "ok": True,
        "task": task_payload,
        "raw": RawProductDetail.model_validate(raw) if raw else None,
        "assets": assets_by_slot,
        "export_draft": ExportFieldDraftOut.model_validate(draft) if draft else None,
    }


@router.patch("/api/product-tasks/{task_id}", response_model=ProductTaskDetail)
def patch_product_task_endpoint(
    task_id: int,
    payload: ProductTaskUpdate,
    session: Session = Depends(get_db_session),
) -> ProductTaskDetail:
    task = get_product_task(session, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product task not found")

    updated = update_product_task(session, task, payload)
    ai_row = get_ai_result_for_task(session, task_id)
    response = ProductTaskDetail.model_validate(updated)
    response.ai = build_ai_summary(ai_row)
    return response


@router.post("/api/product-tasks/{task_id}/run-product-info")
def run_product_info_endpoint(
    task_id: int,
    background: BackgroundTasks,
    x_ai_api_key: str | None = Header(default=None),
    x_ai_base_url: str | None = Header(default=None),
    x_ai_model: str | None = Header(default=None),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    task = get_product_task(session, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product task not found")

    override = {
        "api_key": (x_ai_api_key or "").strip(),
        "base_url": (x_ai_base_url or "").strip(),
        "model": (x_ai_model or "").strip(),
    }

    def _job(task_id_to_run: int, runtime: dict[str, str]) -> None:
        try:
            with runtime_override(runtime):
                with SessionLocal() as bg_session:
                    run_ai_pipeline_for_task(
                        bg_session,
                        task_id=task_id_to_run,
                        prompt_types=["product_info_from_screenshot"],
                    )
        except Exception as exc:
            with SessionLocal() as bg_session:
                _mark_background_failure(
                    bg_session,
                    task_id=task_id_to_run,
                    exc=exc,
                    status_code="run_product_info_failed",
                )

    background.add_task(_job, task_id, override)
    return {"ok": True, "task_id": task_id, "queued": True, "prompt_types": ["product_info_from_screenshot"]}


@router.delete("/api/product-tasks/{task_id}")
def delete_product_task_endpoint(
    task_id: int,
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    task = get_product_task(session, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product task not found")

    delete_product_task(session, task)
    return {"ok": True, "id": task_id}


@router.post("/api/product-tasks/{task_id}/run-ai")
def run_ai_endpoint(
    task_id: int,
    background: BackgroundTasks,
    payload: RunAiRequest | None = Body(default=None),
    x_ai_api_key: str | None = Header(default=None),
    x_ai_base_url: str | None = Header(default=None),
    x_ai_model: str | None = Header(default=None),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    task = get_product_task(session, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product task not found")

    prompt_types = payload.prompt_types if payload else None

    override = {
        "api_key": (x_ai_api_key or "").strip(),
        "base_url": (x_ai_base_url or "").strip(),
        "model": (x_ai_model or "").strip(),
    }

    def _job(task_id_to_run: int, prompt_types_to_run: list[str] | None, runtime: dict[str, str]) -> None:
        try:
            with runtime_override(runtime):
                with SessionLocal() as bg_session:
                    run_ai_pipeline_for_task(bg_session, task_id=task_id_to_run, prompt_types=prompt_types_to_run)
        except Exception as exc:
            with SessionLocal() as bg_session:
                _mark_background_failure(
                    bg_session,
                    task_id=task_id_to_run,
                    exc=exc,
                    status_code="run_ai_failed",
                )

    background.add_task(_job, task_id, prompt_types, override)
    return {"ok": True, "task_id": task_id, "queued": True, "prompt_types": prompt_types}


@router.post("/api/product-tasks/{task_id}/generate-titles")
def generate_titles_endpoint(
    task_id: int,
    background: BackgroundTasks,
    x_ai_api_key: str | None = Header(default=None),
    x_ai_base_url: str | None = Header(default=None),
    x_ai_model: str | None = Header(default=None),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    task = get_product_task(session, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product task not found")

    override = {
        "api_key": (x_ai_api_key or "").strip(),
        "base_url": (x_ai_base_url or "").strip(),
        "model": (x_ai_model or "").strip(),
    }

    def _job(task_id_to_run: int, runtime: dict[str, str]) -> None:
        try:
            with runtime_override(runtime):
                with SessionLocal() as bg_session:
                    run_ai_pipeline_for_task(
                        bg_session,
                        task_id=task_id_to_run,
                        prompt_types=["title_package"],
                    )
        except Exception as exc:
            with SessionLocal() as bg_session:
                _mark_background_failure(
                    bg_session,
                    task_id=task_id_to_run,
                    exc=exc,
                    status_code="generate_titles_failed",
                )

    background.add_task(_job, task_id, override)
    return {"ok": True, "task_id": task_id, "queued": True, "prompt_types": ["title_package"]}


@router.post("/api/product-tasks/{task_id}/generate-title-en-only")
def generate_title_en_only_endpoint(
    task_id: int,
    background: BackgroundTasks,
    x_ai_api_key: str | None = Header(default=None),
    x_ai_base_url: str | None = Header(default=None),
    x_ai_model: str | None = Header(default=None),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    task = get_product_task(session, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product task not found")

    override = {
        "api_key": (x_ai_api_key or "").strip(),
        "base_url": (x_ai_base_url or "").strip(),
        "model": (x_ai_model or "").strip(),
    }

    def _job(task_id_to_run: int, runtime: dict[str, str]) -> None:
        try:
            with runtime_override(runtime):
                with SessionLocal() as bg_session:
                    run_ai_pipeline_for_task(
                        bg_session,
                        task_id=task_id_to_run,
                        prompt_types=["title_en_only"],
                    )
        except Exception as exc:
            with SessionLocal() as bg_session:
                _mark_background_failure(
                    bg_session,
                    task_id=task_id_to_run,
                    exc=exc,
                    status_code="generate_title_en_only_failed",
                )

    background.add_task(_job, task_id, override)
    return {"ok": True, "task_id": task_id, "queued": True, "prompt_types": ["title_en_only"]}


@router.get("/api/categories/search", response_model=CategorySearchResponse)
def search_categories_endpoint(
    q: str = Query(default="", max_length=200),
    limit: int = Query(default=200, ge=1, le=5000),
) -> CategorySearchResponse:
    paths = search_category_paths(query=q, limit=limit)
    return CategorySearchResponse(
        items=[
            CategorySearchItem(
                path=path,
                leaf=path.split(">")[-1].strip() if ">" in path else path,
            )
            for path in paths
        ],
        total=len(paths),
        query=q,
    )


@router.post("/api/product-tasks/{task_id}/select-category", response_model=ProductTaskDetail)
def select_category_endpoint(
    task_id: int,
    payload: SelectCategoryRequest,
    session: Session = Depends(get_db_session),
) -> ProductTaskDetail:
    task = get_product_task(session, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product task not found")

    task.selected_category_id = payload.category_path.strip()
    session.add(task)
    session.commit()
    session.refresh(task)

    ai_row = get_ai_result_for_task(session, task_id)
    response = ProductTaskDetail.model_validate(task)
    response.ai = build_ai_summary(ai_row)
    return response


@router.patch("/api/product-tasks/{task_id}/field-choice", response_model=ProductTaskDetail)
def patch_product_task_field_choice_endpoint(
    task_id: int,
    payload: FieldChoiceRequest,
    session: Session = Depends(get_db_session),
) -> ProductTaskDetail:
    task = get_product_task(session, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product task not found")
    raw = get_raw_product(session, task.raw_product_id)
    ai_row = get_ai_result_for_task(session, task_id)
    if raw is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Raw product not found")

    ai_summary = build_ai_summary(ai_row)
    field_key = payload.field_key.strip()
    source = payload.selected_source.strip().lower()
    manual_value = (payload.manual_value or "").strip()

    if source not in {"raw", "ai", "manual"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="selected_source must be raw | ai | manual")

    updates: dict[str, object] = {}
    if field_key in {"task_title", "product_title_cn"}:
        if source == "raw":
            chosen = raw.title
        elif source == "ai":
            chosen = ai_summary.title_cn if ai_summary else None
        else:
            chosen = manual_value
        if not chosen:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Chosen title is empty")
        task.title = str(chosen)
        updates["product_title_cn"] = str(chosen)
    elif field_key in {"product_title_en"}:
        if source == "raw":
            chosen = raw.title
        elif source == "ai":
            chosen = ai_summary.title_en if ai_summary else None
        else:
            chosen = manual_value
        if not chosen:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Chosen title is empty")
        updates["product_title_en"] = str(chosen)
    elif field_key in {"category_path", "selected_category_id"}:
        if source == "raw":
            chosen = raw.category_path or ""
        elif source == "ai":
            chosen = ai_summary.category_best_path if ai_summary else None
        else:
            chosen = manual_value
        if not chosen:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Chosen category is empty")
        task.selected_category_id = str(chosen)
        updates["category_path"] = str(chosen)
        updates["selected_category_id"] = str(chosen)
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unsupported field_key: {field_key}")

    session.add(task)
    session.commit()
    session.refresh(task)
    if updates:
        patch_export_fields_manual(session, task=task, updates=updates)

    ai_row = get_ai_result_for_task(session, task_id)
    response = ProductTaskDetail.model_validate(task)
    response.ai = build_ai_summary(ai_row)
    return response
