import type { ProductTaskDetail, RawProductDetail } from "@/features/product-tasks/types";

export type DynamicPair = {
  id: string;
  key: string;
  value: string;
};

export type SkuDraftRow = {
  id: string;
  skuCode: string;
  spec1: string;
  spec2: string;
  quantity: string;
  unit: string;
  price: string;
  stock: string;
  weight: string;
  length: string;
  width: string;
  height: string;
};

export type SensitiveDraftRow = {
  id: string;
  type: string;
  value: string;
  remark: string;
};

export function makeDraftId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

type RawSkuPropItem = {
  group_name: string;
  option_name: string;
  image_url: string | null;
  hint_text?: string | null;
  group_index: number;
  option_index: number;
  selected?: boolean;
};

export function buildSkuRowsFromRawSkuProps(
  task: ProductTaskDetail,
  raw: RawProductDetail | null,
  normalizeRawSkuProps: (items: RawSkuPropItem[] | null | undefined) => RawSkuPropItem[],
): SkuDraftRow[] {
  const items = normalizeRawSkuProps(raw?.sku_props)
    .filter((item) => item.group_name || item.option_name || item.image_url)
    .sort((left, right) => (left.group_index - right.group_index) || (left.option_index - right.option_index));
  if (!items.length) return [];

  const firstGroupName = items[0]?.group_name || "";
  const rows = items
    .filter((item) => item.group_name === firstGroupName)
    .map((item, index) => {
      const specValue = item.option_name || item.hint_text || `选项${index + 1}`;
      const baseCode = String(raw?.platform_sku || task.platform_sku || raw?.source_id || task.source_id || "").trim();
      return {
        id: makeDraftId("sku"),
        skuCode: [baseCode, specValue].filter(Boolean).join("-"),
        spec1: specValue,
        spec2: "",
        quantity: "1",
        unit: "件",
        price: "",
        stock: "",
        weight: "",
        length: "",
        width: "",
        height: "",
      };
    });
  return rows;
}

export function readJsonArrayField<T>(fields: Record<string, unknown>, key: string): T[] {
  const raw = fields[key];
  if (Array.isArray(raw)) return raw as T[];
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function nonEmptyPairs(rows: DynamicPair[]): DynamicPair[] {
  return rows
    .map((row) => ({ ...row, key: row.key.trim(), value: row.value.trim() }))
    .filter((row) => row.key || row.value);
}

export function nonEmptySkuRows(rows: SkuDraftRow[]): SkuDraftRow[] {
  return rows
    .map((row) => ({
      ...row,
      skuCode: row.skuCode.trim(),
      spec1: row.spec1.trim(),
      spec2: row.spec2.trim(),
      quantity: row.quantity.trim(),
      unit: row.unit.trim(),
      price: row.price.trim(),
      stock: row.stock.trim(),
      weight: row.weight.trim(),
      length: row.length.trim(),
      width: row.width.trim(),
      height: row.height.trim(),
    }))
    .filter((row) => row.skuCode || row.spec1 || row.spec2 || row.quantity || row.price || row.stock || row.weight || row.length || row.width || row.height);
}

export function nonEmptySensitiveRows(rows: SensitiveDraftRow[]): SensitiveDraftRow[] {
  return rows
    .map((row) => ({ ...row, type: row.type.trim(), value: row.value.trim(), remark: row.remark.trim() }))
    .filter((row) => row.type || row.value || row.remark);
}
