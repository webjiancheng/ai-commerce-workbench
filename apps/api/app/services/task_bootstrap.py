from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.task_status import GenerationMode, TaskMainStatus
from app.models.product_task import ProductTask
from app.services.ai_pipeline import run_ai_pipeline_for_task
from app.services.task_exceptions import clear_task_exception


def run_task_bootstrap_pipeline(session: Session, *, task_id: int) -> None:
    task = session.get(ProductTask, task_id)
    if task is None:
        return

    if task.generation_mode == GenerationMode.no_ai.value:
        task.main_status = TaskMainStatus.review_ready.value
        session.add(task)
        session.commit()
        return

    run_ai_pipeline_for_task(session, task_id=task_id)
    task = session.get(ProductTask, task_id)
    if task is None:
        return

    if task.main_status != TaskMainStatus.failed.value:
        task.main_status = TaskMainStatus.review_ready.value
        clear_task_exception(task, code="image_provider_missing")
        session.add(task)
        session.commit()
