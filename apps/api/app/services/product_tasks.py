from datetime import datetime
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.task_status import (
    CategoryStatus,
    ExportStatus,
    GenerationMode,
    ImagePromptStatus,
    ImageStatus,
    TaskMainStatus,
    TitleStatus,
)
from app.models.export_field_draft import ExportFieldDraft
from app.models.image_generation_job import ImageGenerationJob
from app.models.product_ai_result import ProductAIResult
from app.models.product_task import ProductTask
from app.models.raw_product import RawProduct
from app.schemas.product_task import (
    CategoryTop3Item,
    ProductAiSummary,
    ProductTaskTimelineEvent,
    ProductTaskTimelineResponse,
    ProductTaskTimelineSummary,
    ProductTaskUpdate,
)


DEFAULT_MAIN_STATUS = TaskMainStatus.collected.value
DEFAULT_CATEGORY_STATUS = CategoryStatus.pending.value
DEFAULT_TITLE_STATUS = TitleStatus.pending.value
DEFAULT_IMAGE_STATUS = ImageStatus.pending.value
DEFAULT_EXPORT_STATUS = ExportStatus.pending.value


def create_task_from_raw_product(
    session: Session,
    raw_product: RawProduct,
    *,
    split_index: int = 1,
    split_total: int = 1,
    generation_mode: str = GenerationMode.title_and_image_prompts.value,
) -> ProductTask:
    task = ProductTask(
        raw_product_id=raw_product.id,
        title=raw_product.title,
        source_url=raw_product.url,
        product_platform=raw_product.platform,
        source_id=raw_product.source_id,
        platform_sku=raw_product.platform_sku,
        screenshot_url=raw_product.screenshot_url,
        split_index=split_index,
        split_total=split_total,
        generation_mode=generation_mode,
        main_status=DEFAULT_MAIN_STATUS,
        category_status=DEFAULT_CATEGORY_STATUS,
        title_status=DEFAULT_TITLE_STATUS,
        image_prompt_status=ImagePromptStatus.pending.value,
        image_status=DEFAULT_IMAGE_STATUS,
        export_status=DEFAULT_EXPORT_STATUS,
    )
    session.add(task)
    session.commit()
    session.refresh(task)
    return task


def get_task_by_raw_product_id(session: Session, raw_product_id: int) -> ProductTask | None:
    return session.scalar(
        select(ProductTask)
        .where(ProductTask.raw_product_id == raw_product_id)
        .order_by(ProductTask.split_index.asc(), ProductTask.id.asc())
    )


def list_tasks_by_raw_product_id(session: Session, raw_product_id: int) -> list[ProductTask]:
    return session.scalars(
        select(ProductTask)
        .where(ProductTask.raw_product_id == raw_product_id)
        .order_by(ProductTask.split_index.asc(), ProductTask.id.asc())
    ).all()


def list_product_tasks(
    session: Session,
    *,
    limit: int,
    offset: int,
    main_status: str | None = None,
    category_status: str | None = None,
    image_status: str | None = None,
    export_status: str | None = None,
    exception_only: bool | None = None,
    low_confidence: bool | None = None,
    keyword: str | None = None,
) -> tuple[list[ProductTask], int]:
    query = select(ProductTask)
    count_query = select(func.count()).select_from(ProductTask)

    if main_status:
        query = query.where(ProductTask.main_status == main_status)
        count_query = count_query.where(ProductTask.main_status == main_status)
    if category_status:
        query = query.where(ProductTask.category_status == category_status)
        count_query = count_query.where(ProductTask.category_status == category_status)
    if export_status:
        query = query.where(ProductTask.export_status == export_status)
        count_query = count_query.where(ProductTask.export_status == export_status)
    if image_status:
        query = query.where(ProductTask.image_status == image_status)
        count_query = count_query.where(ProductTask.image_status == image_status)
    if exception_only:
        query = query.where(ProductTask.exception_level.is_not(None))
        count_query = count_query.where(ProductTask.exception_level.is_not(None))
    if low_confidence:
        query = query.where(ProductTask.category_status == CategoryStatus.low_confidence.value)
        count_query = count_query.where(ProductTask.category_status == CategoryStatus.low_confidence.value)
    if keyword:
        pattern = f"%{keyword}%"
        keyword_filter = or_(
            ProductTask.title.ilike(pattern),
            ProductTask.platform_sku.ilike(pattern),
        )
        query = query.where(keyword_filter)
        count_query = count_query.where(keyword_filter)

    total = session.scalar(count_query) or 0
    items = session.scalars(
        query.order_by(ProductTask.created_at.desc(), ProductTask.id.desc()).limit(limit).offset(offset)
    ).all()
    return items, total


def get_product_task(session: Session, task_id: int) -> ProductTask | None:
    return session.get(ProductTask, task_id)


def delete_product_task(session: Session, task: ProductTask) -> None:
    session.delete(task)
    session.commit()


def get_ai_result_for_task(session: Session, task_id: int) -> ProductAIResult | None:
    return session.scalar(select(ProductAIResult).where(ProductAIResult.task_id == task_id))


def build_ai_summary(ai_row: ProductAIResult | None) -> ProductAiSummary | None:
    if ai_row is None:
        return None

    product_info_out = (ai_row.product_info or {}).get("output") if isinstance(ai_row.product_info, dict) else None
    category_out = (ai_row.category_match or {}).get("output") if isinstance(ai_row.category_match, dict) else None
    title_en_out = (ai_row.title_en or {}).get("output") if isinstance(ai_row.title_en, dict) else None
    title_package_out = (ai_row.title_package or {}).get("output") if isinstance(ai_row.title_package, dict) else None
    image_prompt_package_out = (
        (ai_row.image_prompt_package or {}).get("output")
        if isinstance(ai_row.image_prompt_package, dict)
        else None
    )

    top3_items: list[CategoryTop3Item] = []
    if isinstance(category_out, dict):
        for item in ((category_out.get("top3") or category_out.get("candidates") or []))[:3]:
            if not isinstance(item, dict):
                continue
            top3_items.append(
                CategoryTop3Item(
                    path=str(item.get("path") or ""),
                    confidence=item.get("confidence"),
                )
            )

    return ProductAiSummary(
        category_best_path=(
            category_out.get("best_path")
            if isinstance(category_out, dict) and category_out.get("best_path") is not None
            else category_out.get("selected_category")
            if isinstance(category_out, dict)
            else None
        ),
        category_confidence=category_out.get("confidence") if isinstance(category_out, dict) else None,
        category_top3=top3_items,
        category_candidates=(category_out.get("candidates") or []) if isinstance(category_out, dict) else [],
        product_info=product_info_out if isinstance(product_info_out, dict) else None,
        title_cn=title_package_out.get("title_cn") if isinstance(title_package_out, dict) else None,
        title_en=(
            title_package_out.get("title_en")
            if isinstance(title_package_out, dict) and title_package_out.get("title_en") is not None
            else title_en_out.get("title")
            if isinstance(title_en_out, dict) and title_en_out.get("title") is not None
            else title_en_out.get("title_en")
            if isinstance(title_en_out, dict)
            else None
        ),
        title_package=title_package_out if isinstance(title_package_out, dict) else None,
        image_prompt_package=image_prompt_package_out if isinstance(image_prompt_package_out, dict) else None,
    )


def update_product_task(session: Session, task: ProductTask, payload: ProductTaskUpdate) -> ProductTask:
    updates = payload.model_dump(exclude_unset=True)
    for field_name, value in updates.items():
        setattr(task, field_name, value)

    session.add(task)
    session.commit()
    session.refresh(task)
    return task


_PROMPT_LABELS: dict[str, str] = {
    "product_info": "商品理解",
    "category_match": "类目处理",
    "title_en": "英文标题",
    "title_package": "标题包",
    "image_prompt_package": "图片提示词包",
}


def _parse_dt(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def _event(
    *,
    ts: datetime | None,
    stage: str,
    status: str,
    title: str,
    message: str,
    source: str,
    meta: dict[str, Any] | None = None,
) -> ProductTaskTimelineEvent:
    return ProductTaskTimelineEvent(
        ts=ts,
        stage=stage,
        status=status,
        title=title,
        message=message,
        source=source,
        meta=meta or {},
    )


def _current_step(task: ProductTask) -> str:
    if task.main_status == TaskMainStatus.failed.value:
        return "任务失败"
    if task.image_prompt_status == ImagePromptStatus.running.value:
        return "图片提示词生成"
    if task.image_status == ImageStatus.running.value or task.main_status == TaskMainStatus.image_running.value:
        return "图片生成"
    if task.title_status == TitleStatus.running.value or task.category_status == CategoryStatus.running.value:
        return "AI 处理中"
    if task.main_status == TaskMainStatus.prompts_ready.value:
        return "提示词已准备"
    if task.main_status == TaskMainStatus.review_ready.value:
        return "人工复核"
    if task.export_status == ExportStatus.ready.value:
        return "导出准备"
    if task.main_status == TaskMainStatus.collected.value:
        return "等待处理"
    return task.main_status


def _build_ai_events(ai_row: ProductAIResult | None) -> list[ProductTaskTimelineEvent]:
    if ai_row is None:
        return []

    events: list[ProductTaskTimelineEvent] = [
        _event(
            ts=ai_row.created_at,
            stage="ai",
            status="started",
            title="AI 流程启动",
            message="开始执行商品理解、类目、标题等提示词链路。",
            source="product_ai_results",
        )
    ]
    prompt_type_map: dict[str, str] = {
        "product_info": "product_info_from_screenshot",
        "category_match": "category_match",
        "title_package": "title_package",
        "image_prompt_package": "image_prompt_package",
    }
    prompt_snapshot = ai_row.prompt_snapshot if isinstance(ai_row.prompt_snapshot, dict) else {}
    runtime_meta = prompt_snapshot.get("_runtime") if isinstance(prompt_snapshot.get("_runtime"), dict) else {}

    for field_name, label in _PROMPT_LABELS.items():
        payload = getattr(ai_row, field_name, None)
        if not isinstance(payload, dict) or not payload:
            continue
        output = payload.get("output")
        error = payload.get("error")
        model = payload.get("model")
        prompt = payload.get("prompt")
        input_obj = payload.get("input")
        duration_ms = payload.get("duration_ms")
        usage = payload.get("usage") if isinstance(payload.get("usage"), dict) else {}
        cost = payload.get("cost") if isinstance(payload.get("cost"), dict) else {}
        provider_meta = payload.get("provider") if isinstance(payload.get("provider"), dict) else {}
        prompt_type = prompt_type_map.get(field_name)
        prompt_meta = prompt_snapshot.get(prompt_type) if prompt_type and isinstance(prompt_snapshot.get(prompt_type), dict) else {}
        resolved_prompt_type = str(prompt_meta.get("prompt_type") or prompt_type or "")
        status = "failed" if error else "success"
        if error:
            message = str(error)
        elif field_name == "category_match" and isinstance(output, dict):
            best_path = output.get("selected_category") or output.get("best_path") or "-"
            message = f"代码检索类目候选，默认命中：{best_path}。"
        elif field_name == "title_package" and isinstance(output, dict):
            message = f"生成标题包：{output.get('title_cn') or '-'} / {output.get('title_en') or '-'}"
        elif field_name == "image_prompt_package" and isinstance(output, dict):
            message = "已生成四宫格、轮播图和尺寸图提示词包。"
        elif field_name == "title_en" and isinstance(output, dict):
            title_value = output.get("title") or output.get("title_en") or "-"
            message = f"生成标题：{title_value}"
        else:
            message = f"{label} 已返回结果。"
        events.append(
            _event(
                ts=_parse_dt(payload.get("created_at")) or ai_row.updated_at,
                stage=f"ai.{field_name}",
                status=status,
                title=label,
                message=message,
                source="product_ai_results",
                meta={
                    "model": model,
                    "duration_ms": duration_ms,
                    "has_prompt": bool(prompt),
                    "prompt_type": resolved_prompt_type,
                    "runtime": runtime_meta,
                    "provider": provider_meta,
                    "usage": usage,
                    "cost": cost,
                    "prompt_template": {
                        "template_id": prompt_meta.get("template_id"),
                        "scope": prompt_meta.get("scope"),
                        "version": prompt_meta.get("version"),
                    },
                    "prompt": prompt,
                    "input": input_obj,
                    "output": output,
                    "error": error,
                },
            )
        )
    return events


def _build_image_events(jobs: list[ImageGenerationJob]) -> list[ProductTaskTimelineEvent]:
    events: list[ProductTaskTimelineEvent] = []
    for job in jobs:
        target_slots = [slot for slot in (job.target_slots_json or []) if isinstance(slot, str)]
        meta = {
            "job_id": job.id,
            "job_type": job.job_type,
            "slot": job.slot,
            "target_slots": target_slots,
            "provider": job.provider,
            "model_name": job.model_name,
            "size": job.size,
        }
        events.append(
            _event(
                ts=job.created_at,
                stage="image.queued",
                status="queued",
                title=f"图片任务已创建 #{job.id}",
                message=f"已创建 {job.job_type} 图片任务，目标槽位：{', '.join(target_slots or [job.slot])}。",
                source="image_generation_jobs",
                meta=meta,
            )
        )
        if job.started_at:
            events.append(
                _event(
                    ts=job.started_at,
                    stage="image.running",
                    status="running",
                    title=f"图片任务开始执行 #{job.id}",
                    message=f"调用 {job.provider}/{job.model_name} 开始生成，当前槽位：{job.slot}。",
                    source="image_generation_jobs",
                    meta=meta | {"progress": job.progress},
                )
            )
        if job.finished_at:
            events.append(
                _event(
                    ts=job.finished_at,
                    stage="image.result",
                    status=job.status,
                    title=f"图片任务完成 #{job.id}" if job.status == "success" else f"图片任务失败 #{job.id}",
                    message=(
                        f"生成完成，输出 {len(job.output_asset_ids_json or [])} 张图。"
                        if job.status == "success"
                        else (job.error_message or "图片生成失败。")
                    ),
                    source="image_generation_jobs",
                    meta=meta | {"output_asset_ids": job.output_asset_ids_json or []},
                )
            )
    return events


def _build_exception_events(task: ProductTask) -> list[ProductTaskTimelineEvent]:
    events: list[ProductTaskTimelineEvent] = []
    for item in task.exception_reasons_json or []:
        if not isinstance(item, dict):
            continue
        events.append(
            _event(
                ts=_parse_dt(item.get("updated_at")) or task.exception_updated_at,
                stage="exception",
                status=str(item.get("level") or "warning"),
                title=str(item.get("code") or "task_exception"),
                message=str(item.get("message") or ""),
                source="product_tasks.exception_reasons_json",
                meta={
                    "code": item.get("code"),
                    "status": item.get("status"),
                    "level": item.get("level"),
                },
            )
        )
    return events


def get_product_task_timeline(session: Session, task: ProductTask) -> ProductTaskTimelineResponse:
    ai_row = get_ai_result_for_task(session, task.id)
    draft = session.scalar(select(ExportFieldDraft).where(ExportFieldDraft.product_task_id == task.id))
    jobs = session.scalars(
        select(ImageGenerationJob)
        .where(ImageGenerationJob.product_task_id == task.id)
        .order_by(ImageGenerationJob.created_at.asc(), ImageGenerationJob.id.asc())
    ).all()

    events: list[ProductTaskTimelineEvent] = [
        _event(
            ts=task.created_at,
            stage="task.created",
            status="success",
            title="生成任务已创建",
            message=f"从原始采集商品创建任务，初始状态：{task.main_status}。",
            source="product_tasks",
            meta={
                "task_id": task.id,
                "raw_product_id": task.raw_product_id,
                "split_index": task.split_index,
                "split_total": task.split_total,
            },
        )
    ]
    events.extend(_build_ai_events(ai_row))

    if draft is not None:
        events.append(
            _event(
                ts=draft.created_at,
                stage="export.draft_created",
                status=draft.status,
                title="导出字段草稿已生成",
                message=f"已汇总原始数据、AI 结果和默认规则，当前草稿状态：{draft.status}。",
                source="export_field_drafts",
                meta={
                    "warning_count": len(draft.warnings_json or []),
                    "field_count": len(draft.fields_json or {}),
                },
            )
        )
        if draft.updated_at and draft.updated_at != draft.created_at:
            events.append(
                _event(
                    ts=draft.updated_at,
                    stage="export.draft_updated",
                    status=draft.status,
                    title="导出字段草稿已更新",
                    message="导出字段草稿发生更新，可能包含人工覆盖或规则重算。",
                    source="export_field_drafts",
                )
            )

    events.extend(_build_image_events(jobs))
    events.extend(_build_exception_events(task))
    events.append(
        _event(
            ts=task.updated_at,
            stage="task.current_state",
            status=task.main_status,
            title="任务当前状态",
            message=(
                f"当前主状态：{task.main_status}；类目：{task.category_status}；标题：{task.title_status}；"
                f"图片提示词：{task.image_prompt_status}；图片：{task.image_status}；导出：{task.export_status}。"
            ),
            source="product_tasks",
            meta={
                "generation_mode": task.generation_mode,
                "main_status": task.main_status,
                "category_status": task.category_status,
                "title_status": task.title_status,
                "image_prompt_status": task.image_prompt_status,
                "image_status": task.image_status,
                "export_status": task.export_status,
            },
        )
    )

    events.sort(key=lambda item: (item.ts is None, item.ts or task.created_at, item.stage))
    summary = ProductTaskTimelineSummary(
        main_status=TaskMainStatus(task.main_status),
        category_status=CategoryStatus(task.category_status),
        title_status=TitleStatus(task.title_status),
        image_prompt_status=ImagePromptStatus(task.image_prompt_status),
        image_status=ImageStatus(task.image_status),
        export_status=ExportStatus(task.export_status),
        exception_status=task.exception_status,
        exception_level=task.exception_level,
        last_error_message=task.last_error_message,
        current_step=_current_step(task),
    )
    return ProductTaskTimelineResponse(
        task_id=task.id,
        raw_product_id=task.raw_product_id,
        summary=summary,
        events=events,
    )
