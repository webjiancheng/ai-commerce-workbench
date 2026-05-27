export type TaskMainStatus =
  | "draft"
  | "collected"
  | "normalized"
  | "ai_running"
  | "ai_ready"
  | "prompts_ready"
  | "image_running"
  | "review_ready"
  | "export_ready"
  | "exported"
  | "failed";

export type CategoryStatus = "pending" | "running" | "success" | "low_confidence" | "failed";
export type ImagePromptStatus = "pending" | "running" | "ready" | "failed";
export type ExportStatus = "pending" | "ready" | "running" | "exported" | "failed";

export type GenerationMode =
  | "task_only"
  | "title_only"
  | "title_and_4grid"
  | "no_ai"
  | "title_and_image_prompts"
  | "full_later";

export type ExportImageSettings = {
  insert_size_chart_in_carousel?: boolean;
  size_chart_position?: number;
};

export type ProductTaskListItem = {
  id: number;
  raw_product_id: number;
  title: string;
  source_url: string | null;
  screenshot_url: string | null;
  product_platform: string | null;
  source_id: string | null;
  platform_sku: string | null;
  generation_mode: GenerationMode;
  include_product_info: boolean;
  main_status: TaskMainStatus;
  category_status: CategoryStatus;
  title_status: string;
  image_prompt_status: ImagePromptStatus;
  image_status: string;
  export_status: ExportStatus;
  selected_category_id: string | null;
  category_candidates_json: unknown[];
  export_image_settings_json: ExportImageSettings;
  task_no?: string | null;
  exception_status: string | null;
  exception_level: string | null;
  exception_reasons_json: unknown[];
  last_error_message: string | null;
  retry_count: number;
  exception_updated_at: string | null;
  created_at: string;
};

export type ProductTaskDetail = ProductTaskListItem & {
  notes: string | null;
  updated_at: string;
  ai?: {
    category_best_path: string | null;
    category_confidence: number | null;
    category_top3: { path: string; confidence: number | null }[];
    category_candidates: { path: string; score?: number | null; matched_terms?: string[] }[];
    product_info: Record<string, unknown> | null;
    title_cn: string | null;
    title_en: string | null;
    title_package: Record<string, unknown> | null;
    image_prompt_package: Record<string, unknown> | null;
  } | null;
};

export type ProductTaskListResponse = {
  items: ProductTaskListItem[];
  total: number;
  limit: number;
  offset: number;
};

export type ProductTaskTimelineEvent = {
  ts: string | null;
  stage: string;
  status: string;
  title: string;
  message: string;
  source: string;
  meta: Record<string, unknown>;
};

export type ProductTaskTimelineSummary = {
  main_status: TaskMainStatus;
  category_status: CategoryStatus;
  title_status: string;
  image_prompt_status: ImagePromptStatus;
  image_status: string;
  export_status: ExportStatus;
  exception_status: string | null;
  exception_level: string | null;
  last_error_message: string | null;
  current_step: string;
};

export type ProductTaskTimelineResponse = {
  task_id: number;
  raw_product_id: number;
  summary: ProductTaskTimelineSummary;
  events: ProductTaskTimelineEvent[];
};

export type RawSkuPropItem = {
  group_name: string;
  option_name: string;
  image_url: string | null;
  hint_text?: string | null;
  group_index: number;
  option_index: number;
  selected?: boolean;
};

export type RawProductDetail = {
  id: number;
  platform: string | null;
  url: string;
  title: string;
  price: string | null;
  category_path: string | null;
  platform_sku: string | null;
  sku_text?: string | null;
  sku_props: RawSkuPropItem[];
  source_id: string | null;
  screenshot_url: string | null;
  main_image: string | null;
  carousel_images: string[];
  sku_images: string[];
  detail_images: string[];
  size_chart_images: string[];
  created_at: string;
};

export type ProductAsset = {
  id: number;
  product_task_id?: number;
  slot: string;
  public_url: string | null;
  selected_for_export: boolean;
  status: string;
  source_type: string;
  asset_type?: string;
  parent_asset_id?: number | null;
  generation_job_id?: number | null;
  provider?: string | null;
  model_name?: string | null;
  width?: number | null;
  height?: number | null;
  version: number;
  created_at?: string;
  updated_at?: string;
};

export type AssetsBySlotResponse = Record<string, ProductAsset[]>;

export type ExportFieldDraft = {
  id?: number;
  product_task_id?: number;
  template_id?: number | null;
  fields_json: Record<string, unknown>;
  field_sources_json?: Record<string, unknown>;
  status?: string;
  updated_at?: string;
};

export type RowMeta = {
  raw: RawProductDetail | null;
  assets: AssetsBySlotResponse;
  detail: ProductTaskDetail | null;
  exportDraft: ExportFieldDraft | null;
};

export type TableSlotImage = {
  slot: string;
  asset: ProductAsset | null;
  rawUrl: string | null;
  publicUrl: string | null;
};

export type PromptEditorConfig = {
  fieldLabel: string;
  promptTypes: string[];
  taskIds: number[];
};
