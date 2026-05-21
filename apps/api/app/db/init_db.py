from app.db.base import Base
from app.db.session import engine
from app.db.schema_sync import (
    ensure_default_rules_schema,
    ensure_image_generation_jobs_schema,
    ensure_product_ai_results_schema,
    ensure_product_assets_schema,
    ensure_product_tasks_schema,
    ensure_provider_configs_schema,
    ensure_export_field_drafts_schema,
    ensure_export_templates_schema,
    ensure_export_field_mappings_schema,
    ensure_export_batches_schema,
    ensure_export_records_schema,
    ensure_usage_limits_schema,
    ensure_cost_records_schema,
    ensure_batch_edit_queue_schema,
    ensure_cost_configs_schema,
)
from app.models.default_rule import DefaultRule
from app.models.export_field_draft import ExportFieldDraft
from app.models.image_generation_job import ImageGenerationJob
from app.models.product_ai_result import ProductAIResult
from app.models.product_asset import ProductAsset
from app.models.product_task import ProductTask
from app.models.prompt_template import PromptTemplate
from app.models.provider_config import ProviderConfig
from app.models.raw_product import RawProduct
from app.models.usage_limit import UsageLimit
from app.models.cost_record import CostRecord
from app.models.batch_edit_queue import BatchEditQueueItem
from app.models.cost_config import CostConfig
from app.services.prompt_seed import seed_default_prompt_templates
from app.services.provider_seed import seed_default_provider_configs
from app.services.export_seed import seed_default_export_template


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    ensure_product_tasks_schema(engine)
    ensure_product_ai_results_schema(engine)
    ensure_provider_configs_schema(engine)
    ensure_image_generation_jobs_schema(engine)
    ensure_product_assets_schema(engine)
    ensure_default_rules_schema(engine)
    ensure_export_field_drafts_schema(engine)
    ensure_export_templates_schema(engine)
    ensure_export_field_mappings_schema(engine)
    ensure_export_batches_schema(engine)
    ensure_export_records_schema(engine)
    ensure_usage_limits_schema(engine)
    ensure_cost_records_schema(engine)
    ensure_batch_edit_queue_schema(engine)
    ensure_cost_configs_schema(engine)
    # Seed defaults (global scope) from data file
    from app.db.session import SessionLocal

    with SessionLocal() as session:
        seed_default_prompt_templates(session)
        seed_default_provider_configs(session)
        seed_default_export_template(session)
