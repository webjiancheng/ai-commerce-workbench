from __future__ import annotations

from enum import StrEnum


class TaskMainStatus(StrEnum):
    draft = "draft"
    collected = "collected"
    normalized = "normalized"
    ai_running = "ai_running"
    ai_ready = "ai_ready"
    prompts_ready = "prompts_ready"
    image_running = "image_running"
    review_ready = "review_ready"
    export_ready = "export_ready"
    exported = "exported"
    failed = "failed"


class CategoryStatus(StrEnum):
    pending = "pending"
    running = "running"
    success = "success"
    low_confidence = "low_confidence"
    failed = "failed"


class TitleStatus(StrEnum):
    pending = "pending"
    running = "running"
    success = "success"
    failed = "failed"


class ImageStatus(StrEnum):
    pending = "pending"
    partial = "partial"
    running = "running"
    success = "success"
    failed = "failed"


class ImagePromptStatus(StrEnum):
    pending = "pending"
    running = "running"
    ready = "ready"
    failed = "failed"


class ExportStatus(StrEnum):
    pending = "pending"
    ready = "ready"
    running = "running"
    exported = "exported"
    failed = "failed"


TASK_MAIN_STATUS_VALUES = tuple(status.value for status in TaskMainStatus)
CATEGORY_STATUS_VALUES = tuple(status.value for status in CategoryStatus)
TITLE_STATUS_VALUES = tuple(status.value for status in TitleStatus)
IMAGE_STATUS_VALUES = tuple(status.value for status in ImageStatus)
EXPORT_STATUS_VALUES = tuple(status.value for status in ExportStatus)
IMAGE_PROMPT_STATUS_VALUES = tuple(status.value for status in ImagePromptStatus)


class GenerationMode(StrEnum):
    no_ai = "no_ai"
    title_only = "title_only"
    title_and_image_prompts = "title_and_image_prompts"
    full_later = "full_later"


GENERATION_MODE_VALUES = tuple(status.value for status in GenerationMode)
