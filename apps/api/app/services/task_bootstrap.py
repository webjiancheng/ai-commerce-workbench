from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.task_status import GenerationMode, ImageStatus, TaskMainStatus
from app.models.product_task import ProductTask
from app.services.ai_pipeline import run_ai_pipeline_for_task
from app.services.image_generation import auto_generate_and_crop_4grid_for_task
from app.services.task_exceptions import clear_task_exception, record_task_exception


def run_task_bootstrap_pipeline(session: Session, *, task_id: int) -> None:
    task = session.get(ProductTask, task_id)
    if task is None:
        return

    if task.generation_mode in {GenerationMode.task_only.value, GenerationMode.no_ai.value}:
        task.main_status = TaskMainStatus.review_ready.value
        session.add(task)
        session.commit()
        return

    run_ai_pipeline_for_task(session, task_id=task_id)
    task = session.get(ProductTask, task_id)
    if task is None:
        return

    if task.main_status == TaskMainStatus.failed.value:
        return

    if task.generation_mode in {
        GenerationMode.title_and_4grid.value,
        GenerationMode.title_and_image_prompts.value,
        GenerationMode.full_later.value,
    }:
        try:
            auto_generate_and_crop_4grid_for_task(session, task=task)
        except RuntimeError as exc:
            error_message = str(exc)
            if (
                "not configured" in error_message
                or "not enabled" in error_message
                or "AI_CAIJI_SETTINGS_SECRET_KEY" in error_message
            ):
                # 图片生成 Provider 未配置时优雅降级，不阻塞任务流
                task.image_status = ImageStatus.failed.value
                record_task_exception(
                    task,
                    code=(
                        "image_provider_missing"
                        if "AI_CAIJI_SETTINGS_SECRET_KEY" not in error_message
                        else "image_secret_key_missing"
                    ),
                    level="warning",
                    status="needs_config",
                    message=(
                        "图片生成 Provider 未配置，已跳过自动生图，可手动补图。"
                        if "AI_CAIJI_SETTINGS_SECRET_KEY" not in error_message
                        else "缺少 AI_CAIJI_SETTINGS_SECRET_KEY，无法保存图片 Provider 密钥，已跳过自动生图。"
                    ),
                )
                task.main_status = TaskMainStatus.review_ready.value
                clear_task_exception(task, code="image_generation_failed")
                session.add(task)
                session.commit()
                return
            raise  # 其他异常继续冒泡
        clear_task_exception(task, code="image_provider_missing")
        clear_task_exception(task, code="image_secret_key_missing")
        session.add(task)
        session.commit()
        return

    task.main_status = TaskMainStatus.review_ready.value
    clear_task_exception(task, code="image_provider_missing")
    clear_task_exception(task, code="image_secret_key_missing")
    session.add(task)
    session.commit()
