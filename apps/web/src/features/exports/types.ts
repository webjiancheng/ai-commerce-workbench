export type TabKey = "fixed" | "ai" | "history";

export type ExportBatch = {
  id: number;
  batch_no: string;
  export_mode: string;
  default_rule_name: string | null;
  total_count: number;
  sku_row_count: number;
  success_count: number;
  failed_count: number;
  exported_file_path: string | null;
  status: string;
  created_at: string;
};

export type DefaultRule = { id: number; name: string; enabled: boolean };
export type ExportAdapter = { adapter_key: string; display_name: string; enabled: boolean; is_default: boolean };
export type TemplateMeta = {
  common_fields: string[];
  detail_headers: string[];
  required_hints: string[];
  default_values: Record<string, string>;
};
export type AiImportBatch = { id: number; name: string; status: string; export_file_path: string | null };
export type AiImportDraft = {
  batch_id: number;
  common_fields_json: Record<string, string>;
  headers_json: string[];
  rows_json: Array<Record<string, string>>;
  validation_result_json: { errors?: unknown[]; warnings?: unknown[] };
};
