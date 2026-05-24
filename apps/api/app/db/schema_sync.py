from __future__ import annotations

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


def _add_column(engine: Engine, *, table: str, column_sql: str) -> None:
    with engine.begin() as conn:
        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column_sql}"))


def _drop_column(engine: Engine, *, table: str, column: str) -> None:
    with engine.begin() as conn:
        conn.execute(text(f"ALTER TABLE {table} DROP COLUMN IF EXISTS {column}"))


def _create_index(engine: Engine, *, index_name: str, index_sql: str) -> None:
    with engine.begin() as conn:
        conn.execute(text(f"CREATE INDEX IF NOT EXISTS {index_name} ON {index_sql}"))


def ensure_product_tasks_schema(engine: Engine) -> None:
    inspector = inspect(engine)
    if "product_tasks" not in inspector.get_table_names():
        return

    existing_columns = {col["name"] for col in inspector.get_columns("product_tasks")}

    if "source_url" not in existing_columns:
        _add_column(engine, table="product_tasks", column_sql="source_url TEXT")
    if "screenshot_url" not in existing_columns:
        _add_column(engine, table="product_tasks", column_sql="screenshot_url TEXT")
    if "selected_category_id" not in existing_columns:
        _add_column(engine, table="product_tasks", column_sql="selected_category_id VARCHAR(64)")
    if "exception_status" not in existing_columns:
        _add_column(engine, table="product_tasks", column_sql="exception_status VARCHAR(32)")
    if "exception_level" not in existing_columns:
        _add_column(engine, table="product_tasks", column_sql="exception_level VARCHAR(32)")
    if "exception_reasons_json" not in existing_columns:
        _add_column(engine, table="product_tasks", column_sql="exception_reasons_json JSONB NOT NULL DEFAULT '[]'::jsonb")
    if "last_error_message" not in existing_columns:
        _add_column(engine, table="product_tasks", column_sql="last_error_message TEXT")
    if "retry_count" not in existing_columns:
        _add_column(engine, table="product_tasks", column_sql="retry_count INTEGER NOT NULL DEFAULT 0")
    if "exception_updated_at" not in existing_columns:
        _add_column(engine, table="product_tasks", column_sql="exception_updated_at TIMESTAMPTZ")
    if "split_index" not in existing_columns:
        _add_column(engine, table="product_tasks", column_sql="split_index INTEGER NOT NULL DEFAULT 1")
    if "split_total" not in existing_columns:
        _add_column(engine, table="product_tasks", column_sql="split_total INTEGER NOT NULL DEFAULT 1")
    if "generation_mode" not in existing_columns:
        _add_column(engine, table="product_tasks", column_sql="generation_mode VARCHAR(32) NOT NULL DEFAULT 'title_and_4grid'")
    if "include_product_info" not in existing_columns:
        _add_column(engine, table="product_tasks", column_sql="include_product_info BOOLEAN NOT NULL DEFAULT true")
    if "image_prompt_status" not in existing_columns:
        _add_column(engine, table="product_tasks", column_sql="image_prompt_status VARCHAR(32) NOT NULL DEFAULT 'pending'")
    if "category_candidates_json" not in existing_columns:
        _add_column(engine, table="product_tasks", column_sql="category_candidates_json JSONB NOT NULL DEFAULT '[]'::jsonb")

    existing_indexes_info = {idx["name"]: idx for idx in inspector.get_indexes("product_tasks")}
    existing_indexes = set(existing_indexes_info.keys())
    if existing_indexes_info.get("ix_product_tasks_raw_product_id", {}).get("unique"):
        with engine.begin() as conn:
            conn.execute(text("DROP INDEX IF EXISTS ix_product_tasks_raw_product_id"))
        _create_index(
            engine,
            index_name="ix_product_tasks_raw_product_id",
            index_sql="product_tasks (raw_product_id)",
        )
        existing_indexes.add("ix_product_tasks_raw_product_id")
    if "uq_product_tasks_raw_split" not in existing_indexes:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_product_tasks_raw_split "
                    "ON product_tasks (raw_product_id, split_index)"
                )
            )
    if "ix_product_tasks_category_status" not in existing_indexes:
        _create_index(
            engine,
            index_name="ix_product_tasks_category_status",
            index_sql="product_tasks (category_status)",
        )
    if "ix_product_tasks_export_status" not in existing_indexes:
        _create_index(
            engine,
            index_name="ix_product_tasks_export_status",
            index_sql="product_tasks (export_status)",
        )


def ensure_product_ai_results_schema(engine: Engine) -> None:
    inspector = inspect(engine)
    if "product_ai_results" not in inspector.get_table_names():
        return

    existing_columns = {col["name"] for col in inspector.get_columns("product_ai_results")}
    if "prompt_snapshot" not in existing_columns:
        _add_column(engine, table="product_ai_results", column_sql="prompt_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb")
    if "product_info" not in existing_columns:
        _add_column(engine, table="product_ai_results", column_sql="product_info JSONB NOT NULL DEFAULT '{}'::jsonb")
    if "title_package" not in existing_columns:
        _add_column(engine, table="product_ai_results", column_sql="title_package JSONB NOT NULL DEFAULT '{}'::jsonb")
    if "image_prompt_package" not in existing_columns:
        _add_column(engine, table="product_ai_results", column_sql="image_prompt_package JSONB NOT NULL DEFAULT '{}'::jsonb")
    for obsolete_column in ("product_dna", "title_cn", "product_description"):
        if obsolete_column in existing_columns:
            _drop_column(engine, table="product_ai_results", column=obsolete_column)


def ensure_provider_configs_schema(engine: Engine) -> None:
    inspector = inspect(engine)
    if "provider_configs" in inspector.get_table_names():
        return

    ddl = """
    CREATE TABLE provider_configs (
      id SERIAL PRIMARY KEY,
      provider_type VARCHAR(32) NOT NULL,
      provider_name VARCHAR(64) NOT NULL,
      display_name VARCHAR(128) NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT true,
      is_default BOOLEAN NOT NULL DEFAULT false,
      config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      secret_config_json JSONB NULL,
      capabilities_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      pricing_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX uq_provider_configs_type_name ON provider_configs (provider_type, provider_name);
    CREATE INDEX ix_provider_configs_provider_type ON provider_configs (provider_type);
    CREATE INDEX ix_provider_configs_enabled ON provider_configs (enabled);
    """
    with engine.begin() as conn:
        conn.execute(text(ddl))


def ensure_image_generation_jobs_schema(engine: Engine) -> None:
    inspector = inspect(engine)
    if "image_generation_jobs" in inspector.get_table_names():
        return

    ddl = """
    CREATE TABLE image_generation_jobs (
      id SERIAL PRIMARY KEY,
      product_task_id INTEGER NOT NULL REFERENCES product_tasks(id) ON DELETE CASCADE,
      job_type VARCHAR(32) NOT NULL,
      slot VARCHAR(32) NOT NULL,
      target_slots_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      reference_asset_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      input_asset_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      prompt_template_id INTEGER NULL REFERENCES prompt_templates(id) ON DELETE SET NULL,
      prompt_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      final_prompt TEXT NOT NULL DEFAULT '',
      provider VARCHAR(64) NOT NULL,
      model_name VARCHAR(128) NOT NULL,
      size VARCHAR(32) NOT NULL,
      provider_config_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(32) NOT NULL DEFAULT 'queued',
      progress INTEGER NOT NULL DEFAULT 0,
      error_message TEXT NULL,
      parent_asset_id INTEGER NULL,
      output_asset_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      started_at TIMESTAMPTZ NULL,
      finished_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX ix_image_generation_jobs_task ON image_generation_jobs (product_task_id);
    CREATE INDEX ix_image_generation_jobs_status ON image_generation_jobs (status);
    CREATE INDEX ix_image_generation_jobs_created_at ON image_generation_jobs (created_at);
    """
    with engine.begin() as conn:
        conn.execute(text(ddl))


def ensure_product_assets_schema(engine: Engine) -> None:
    inspector = inspect(engine)
    if "product_assets" in inspector.get_table_names():
        return

    ddl = """
    CREATE TABLE product_assets (
      id SERIAL PRIMARY KEY,
      product_task_id INTEGER NOT NULL REFERENCES product_tasks(id) ON DELETE CASCADE,
      sku_id VARCHAR(64) NULL,
      slot VARCHAR(32) NOT NULL,
      asset_type VARCHAR(32) NOT NULL,
      source_type VARCHAR(32) NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      parent_asset_id INTEGER NULL,
      generation_job_id INTEGER NULL,
      storage_key TEXT NULL,
      public_url TEXT NULL,
      mime_type VARCHAR(64) NULL,
      width INTEGER NULL,
      height INTEGER NULL,
      prompt_template_id INTEGER NULL REFERENCES prompt_templates(id) ON DELETE SET NULL,
      prompt_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      image_strategy_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      provider VARCHAR(64) NULL,
      model_name VARCHAR(128) NULL,
      selected_for_export BOOLEAN NOT NULL DEFAULT false,
      status VARCHAR(32) NOT NULL DEFAULT 'ready',
      crop_group_id VARCHAR(64) NULL,
      crop_index INTEGER NULL,
      crop_box_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX ix_product_assets_task_slot ON product_assets (product_task_id, slot);
    CREATE INDEX ix_product_assets_task_created_at ON product_assets (product_task_id, created_at);
    CREATE INDEX ix_product_assets_generation_job_id ON product_assets (generation_job_id);
    """
    with engine.begin() as conn:
        conn.execute(text(ddl))


def ensure_default_rules_schema(engine: Engine) -> None:
    inspector = inspect(engine)
    if "default_rules" in inspector.get_table_names():
        existing_columns = {col["name"] for col in inspector.get_columns("default_rules")}
        if "platform" not in existing_columns:
            _add_column(engine, table="default_rules", column_sql="platform VARCHAR(32)")
        if "site" not in existing_columns:
            _add_column(engine, table="default_rules", column_sql="site VARCHAR(32)")
        if "fulfillment_mode" not in existing_columns:
            _add_column(engine, table="default_rules", column_sql="fulfillment_mode VARCHAR(32)")
        if "category_path" not in existing_columns:
            _add_column(engine, table="default_rules", column_sql="category_path TEXT")
        if "conditions_json" not in existing_columns:
            _add_column(engine, table="default_rules", column_sql="conditions_json JSONB NOT NULL DEFAULT '{}'::jsonb")
        if "values_json" not in existing_columns:
            _add_column(engine, table="default_rules", column_sql="values_json JSONB NOT NULL DEFAULT '{}'::jsonb")
        return

    ddl = """
    CREATE TABLE default_rules (
      id SERIAL PRIMARY KEY,
      name VARCHAR(128) NOT NULL,
      rule_type VARCHAR(32) NOT NULL,
      scope VARCHAR(32) NOT NULL,
      platform VARCHAR(32) NULL,
      site VARCHAR(32) NULL,
      fulfillment_mode VARCHAR(32) NULL,
      category_path TEXT NULL,
      match_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      conditions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      output_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      values_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      priority INTEGER NOT NULL DEFAULT 0,
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX ix_default_rules_rule_type ON default_rules (rule_type);
    CREATE INDEX ix_default_rules_scope ON default_rules (scope);
    CREATE INDEX ix_default_rules_enabled ON default_rules (enabled);
    CREATE INDEX ix_default_rules_priority ON default_rules (priority);
    """
    with engine.begin() as conn:
        conn.execute(text(ddl))


def ensure_export_field_drafts_schema(engine: Engine) -> None:
    inspector = inspect(engine)
    if "export_field_drafts" in inspector.get_table_names():
        return

    ddl = """
    CREATE TABLE export_field_drafts (
      id SERIAL PRIMARY KEY,
      product_task_id INTEGER NOT NULL REFERENCES product_tasks(id) ON DELETE CASCADE,
      fields_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      field_sources_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      warnings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      status VARCHAR(32) NOT NULL DEFAULT 'draft',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX ix_export_field_drafts_task_id ON export_field_drafts (product_task_id);
    CREATE INDEX ix_export_field_drafts_status ON export_field_drafts (status);
    CREATE INDEX ix_export_field_drafts_updated_at ON export_field_drafts (updated_at);
    """
    with engine.begin() as conn:
        conn.execute(text(ddl))


def ensure_export_templates_schema(engine: Engine) -> None:
    inspector = inspect(engine)
    if "export_templates" in inspector.get_table_names():
        return

    ddl = """
    CREATE TABLE export_templates (
      id SERIAL PRIMARY KEY,
      name VARCHAR(128) NOT NULL,
      version VARCHAR(64) NOT NULL,
      platform VARCHAR(64) NOT NULL,
      template_type VARCHAR(64) NOT NULL DEFAULT 'temu_miaoshou',
      file_path TEXT NOT NULL,
      header_row_index INTEGER NOT NULL DEFAULT 1,
      fields_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      enabled BOOLEAN NOT NULL DEFAULT true,
      is_default BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX uq_export_templates_platform_version ON export_templates (platform, version);
    CREATE INDEX ix_export_templates_platform ON export_templates (platform);
    CREATE INDEX ix_export_templates_enabled ON export_templates (enabled);
    CREATE INDEX ix_export_templates_default ON export_templates (is_default);
    """
    with engine.begin() as conn:
        conn.execute(text(ddl))


def ensure_export_field_mappings_schema(engine: Engine) -> None:
    inspector = inspect(engine)
    if "export_field_mappings" in inspector.get_table_names():
        return

    ddl = """
    CREATE TABLE export_field_mappings (
      id SERIAL PRIMARY KEY,
      template_id INTEGER NOT NULL REFERENCES export_templates(id) ON DELETE CASCADE,
      field_key VARCHAR(128) NOT NULL,
      field_name VARCHAR(256) NOT NULL,
      column_index INTEGER NOT NULL,
      required BOOLEAN NOT NULL DEFAULT false,
      source_type VARCHAR(32) NULL,
      source_path TEXT NULL,
      default_value TEXT NULL,
      transform_rule_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      validation_rule_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX uq_export_field_mappings_template_field ON export_field_mappings (template_id, field_key);
    CREATE INDEX ix_export_field_mappings_template_id ON export_field_mappings (template_id);
    CREATE INDEX ix_export_field_mappings_field_key ON export_field_mappings (field_key);
    CREATE INDEX ix_export_field_mappings_enabled ON export_field_mappings (enabled);
    """
    with engine.begin() as conn:
        conn.execute(text(ddl))


def ensure_export_batches_schema(engine: Engine) -> None:
    inspector = inspect(engine)
    if "export_batches" in inspector.get_table_names():
        existing_columns = {col["name"] for col in inspector.get_columns("export_batches")}
        if "export_mode" not in existing_columns:
            _add_column(engine, table="export_batches", column_sql="export_mode VARCHAR(32) NOT NULL DEFAULT 'default_rule'")
        if "default_rule_id" not in existing_columns:
            _add_column(engine, table="export_batches", column_sql="default_rule_id INTEGER NULL REFERENCES default_rules(id) ON DELETE SET NULL")
        if "default_rule_name" not in existing_columns:
            _add_column(engine, table="export_batches", column_sql="default_rule_name VARCHAR(128)")
        if "original_filename" not in existing_columns:
            _add_column(engine, table="export_batches", column_sql="original_filename VARCHAR(255)")
        if "sku_row_count" not in existing_columns:
            _add_column(engine, table="export_batches", column_sql="sku_row_count INTEGER NOT NULL DEFAULT 0")
        return

    ddl = """
    CREATE TABLE export_batches (
      id SERIAL PRIMARY KEY,
      batch_no VARCHAR(64) NOT NULL,
      template_id INTEGER NULL REFERENCES export_templates(id) ON DELETE SET NULL,
      template_version VARCHAR(64) NOT NULL,
      export_mode VARCHAR(32) NOT NULL DEFAULT 'default_rule',
      default_rule_id INTEGER NULL REFERENCES default_rules(id) ON DELETE SET NULL,
      default_rule_name VARCHAR(128) NULL,
      original_filename VARCHAR(255) NULL,
      total_count INTEGER NOT NULL DEFAULT 0,
      sku_row_count INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      exported_file_path TEXT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX uq_export_batches_batch_no ON export_batches (batch_no);
    CREATE INDEX ix_export_batches_status ON export_batches (status);
    CREATE INDEX ix_export_batches_created_at ON export_batches (created_at);
    """
    with engine.begin() as conn:
        conn.execute(text(ddl))


def ensure_ai_import_batches_schema(engine: Engine) -> None:
    inspector = inspect(engine)
    if "ai_import_batches" in inspector.get_table_names():
        return

    ddl = """
    CREATE TABLE ai_import_batches (
      id SERIAL PRIMARY KEY,
      name VARCHAR(128) NOT NULL DEFAULT 'AI导入批次',
      template_file_path TEXT NULL,
      original_filename VARCHAR(255) NULL,
      raw_json_text TEXT NOT NULL DEFAULT '',
      sheet_name VARCHAR(128) NULL,
      parsed_common_fields_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      parsed_headers_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      parsed_rows_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      parsed_warnings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      validation_result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(32) NOT NULL DEFAULT 'uploaded',
      error_message TEXT NULL,
      export_file_path TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX ix_ai_import_batches_status ON ai_import_batches (status);
    CREATE INDEX ix_ai_import_batches_created_at ON ai_import_batches (created_at);
    """
    with engine.begin() as conn:
        conn.execute(text(ddl))


def ensure_ai_import_drafts_schema(engine: Engine) -> None:
    inspector = inspect(engine)
    if "ai_import_drafts" in inspector.get_table_names():
        return

    ddl = """
    CREATE TABLE ai_import_drafts (
      id SERIAL PRIMARY KEY,
      batch_id INTEGER NOT NULL REFERENCES ai_import_batches(id) ON DELETE CASCADE,
      common_fields_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      headers_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      rows_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      field_settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      validation_result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX ix_ai_import_drafts_batch_id ON ai_import_drafts (batch_id);
    """
    with engine.begin() as conn:
        conn.execute(text(ddl))


def ensure_export_records_schema(engine: Engine) -> None:
    inspector = inspect(engine)
    if "export_records" in inspector.get_table_names():
        return

    ddl = """
    CREATE TABLE export_records (
      id SERIAL PRIMARY KEY,
      product_task_id INTEGER NOT NULL REFERENCES product_tasks(id) ON DELETE CASCADE,
      template_id INTEGER NULL REFERENCES export_templates(id) ON DELETE SET NULL,
      template_version VARCHAR(64) NOT NULL,
      export_fields_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      field_sources_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      validation_result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      batch_no VARCHAR(64) NOT NULL,
      exported_file_id VARCHAR(64) NULL,
      exported_file_path TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX ix_export_records_task_id ON export_records (product_task_id);
    CREATE INDEX ix_export_records_batch_no ON export_records (batch_no);
    CREATE INDEX ix_export_records_status ON export_records (status);
    CREATE INDEX ix_export_records_created_at ON export_records (created_at);
    """
    with engine.begin() as conn:
        conn.execute(text(ddl))


def ensure_usage_limits_schema(engine: Engine) -> None:
    inspector = inspect(engine)
    if "usage_limits" in inspector.get_table_names():
        return

    ddl = """
    CREATE TABLE usage_limits (
      id SERIAL PRIMARY KEY,
      scope_type VARCHAR(32) NOT NULL,
      scope_id VARCHAR(64) NOT NULL,
      limit_type VARCHAR(64) NOT NULL,
      max_count INTEGER NOT NULL DEFAULT 0,
      used_count INTEGER NOT NULL DEFAULT 0,
      date VARCHAR(16) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX uq_usage_limits_unique ON usage_limits (scope_type, scope_id, limit_type, date);
    CREATE INDEX ix_usage_limits_scope ON usage_limits (scope_type, scope_id);
    CREATE INDEX ix_usage_limits_limit_type ON usage_limits (limit_type);
    CREATE INDEX ix_usage_limits_date ON usage_limits (date);
    """
    with engine.begin() as conn:
        conn.execute(text(ddl))


def ensure_cost_records_schema(engine: Engine) -> None:
    inspector = inspect(engine)
    if "cost_records" in inspector.get_table_names():
        return

    ddl = """
    CREATE TABLE cost_records (
      id SERIAL PRIMARY KEY,
      product_task_id INTEGER NOT NULL REFERENCES product_tasks(id) ON DELETE CASCADE,
      job_id INTEGER NULL,
      provider VARCHAR(64) NOT NULL,
      model_name VARCHAR(128) NOT NULL,
      job_type VARCHAR(32) NOT NULL,
      estimated_cost NUMERIC(12,4) NULL,
      actual_cost NUMERIC(12,4) NULL,
      currency VARCHAR(16) NOT NULL DEFAULT 'USD',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX ix_cost_records_task_id ON cost_records (product_task_id);
    CREATE INDEX ix_cost_records_job_id ON cost_records (job_id);
    CREATE INDEX ix_cost_records_created_at ON cost_records (created_at);
    """
    with engine.begin() as conn:
        conn.execute(text(ddl))


def ensure_batch_edit_queue_schema(engine: Engine) -> None:
    inspector = inspect(engine)
    if "batch_edit_queue" in inspector.get_table_names():
        return

    ddl = """
    CREATE TABLE batch_edit_queue (
      id SERIAL PRIMARY KEY,
      product_task_id INTEGER NOT NULL REFERENCES product_tasks(id) ON DELETE CASCADE,
      asset_id INTEGER NOT NULL REFERENCES product_assets(id) ON DELETE CASCADE,
      slot VARCHAR(32) NOT NULL,
      operation_type VARCHAR(64) NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'queued',
      payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX ix_batch_edit_queue_task_id ON batch_edit_queue (product_task_id);
    CREATE INDEX ix_batch_edit_queue_status ON batch_edit_queue (status);
    CREATE INDEX ix_batch_edit_queue_created_at ON batch_edit_queue (created_at);
    """
    with engine.begin() as conn:
        conn.execute(text(ddl))


def ensure_cost_configs_schema(engine: Engine) -> None:
    inspector = inspect(engine)
    if "cost_configs" in inspector.get_table_names():
        return

    ddl = """
    CREATE TABLE cost_configs (
      id SERIAL PRIMARY KEY,
      name VARCHAR(64) NOT NULL DEFAULT 'default',
      enabled BOOLEAN NOT NULL DEFAULT true,
      config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      notes TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    """
    with engine.begin() as conn:
        conn.execute(text(ddl))


def ensure_listing_templates_schema(engine: Engine) -> None:
    """Handle listing_templates indexes that may have been created by Base.metadata.create_all."""
    inspector = inspect(engine)
    if "listing_templates" not in inspector.get_table_names():
        return

    existing_indexes = {idx["name"] for idx in inspector.get_indexes("listing_templates")}
    # Drop all listing_templates indexes to avoid DuplicateIndex errors on restart
    for idx_name in existing_indexes:
        if idx_name.startswith("ix_listing_templates_"):
            try:
                with engine.begin() as conn:
                    conn.execute(text(f"DROP INDEX IF EXISTS {idx_name}"))
            except Exception:
                pass
