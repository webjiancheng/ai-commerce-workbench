export type DefaultRule = {
  id: number;
  name: string;
  rule_type: string;
  scope: string;
  platform: string | null;
  site: string | null;
  fulfillment_mode: string | null;
  category_path: string | null;
  conditions_json: Record<string, unknown>;
  output_json: Record<string, unknown>;
  values_json: Record<string, unknown>;
  priority: number;
  enabled: boolean;
  updated_at: string;
};

export type CategorySearchItem = { path: string; leaf: string };

export type QuickTemplate = {
  id: string;
  name: string;
  platform: string;
  adapter_key?: string;
  template_kind?: "product_template" | "sku_template" | "shipping_template" | "price_dimension_template" | "image_video_template" | "sensitive_template" | "packaging_template";
  category_path: string;
  category_keywords: string;
  values: Record<string, string>;
};

export type FieldEntry = { key: string; value: string; layer: "uniform" | "category" | "manual"; status: "filled" | "empty" };

export type FieldDef = {
  key: string;
  label: string;
  type?: "text" | "select" | "number" | "textarea";
  options?: string[];
  hint?: string;
  layer: "uniform" | "category" | "manual";
  group: string;
};
