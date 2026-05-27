import type {
  AssetsBySlotResponse,
  ExportImageSettings,
  ProductAsset,
  ProductTaskListItem,
  RawProductDetail,
  RowMeta,
  TableSlotImage,
} from "@/features/product-tasks/types";

type NormalizedGenerationMode = "task_only" | "title_only" | "title_and_4grid";

const BACKWARD_COMPAT_MAP: Record<string, NormalizedGenerationMode> = {
  no_ai: "task_only",
  title_and_image_prompts: "title_and_4grid",
  full_later: "title_and_4grid",
};

export function normalizeGenerationMode(raw: string): NormalizedGenerationMode {
  return BACKWARD_COMPAT_MAP[raw] as NormalizedGenerationMode || (raw as NormalizedGenerationMode);
}

export function getGenerationModeLabel(mode: string): string {
  switch (mode) {
    case "task_only":
      return "仅创建任务，不使用 AI";
    case "title_only":
      return "AI 标题 + 类目";
    case "title_and_4grid":
      return "AI 标题 + 类目 + 四宫格";
    default:
      return mode;
  }
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export function formatJson(value: unknown): string {
  if (value == null) return "{}";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function taskThumbnail(task: ProductTaskListItem, meta?: RowMeta | null): string | null {
  const assets = meta?.assets || {};
  const selectedCarousel = (assets.carousel_1 || []).find((asset) => asset.selected_for_export);
  const latestCarousel = (assets.carousel_1 || [])[0];
  return (
    meta?.raw?.main_image ||
    meta?.raw?.carousel_images?.[0] ||
    meta?.raw?.sku_images?.[0] ||
    meta?.raw?.detail_images?.[0] ||
    meta?.raw?.screenshot_url ||
    selectedCarousel?.public_url ||
    latestCarousel?.public_url ||
    task.screenshot_url ||
    null
  );
}

export function latestAsset(assets: ProductAsset[] | undefined): ProductAsset | null {
  const usableAssets = (assets || []).filter((asset) => asset.status !== "removed" && asset.public_url);
  return usableAssets.find((asset) => asset.selected_for_export) || usableAssets[0] || null;
}

export function selectedSlotAsset(assetsBySlot: AssetsBySlotResponse | undefined, slot: string): ProductAsset | null {
  return latestAsset(assetsBySlot?.[slot]);
}

export function slotHasRemovalMarker(assetsBySlot: AssetsBySlotResponse | undefined, slot: string): boolean {
  return Boolean(
    (assetsBySlot?.[slot] || []).some(
      (asset) => asset.selected_for_export && (asset.status === "removed" || asset.source_type === "manual_removed"),
    ),
  );
}

export function rawCarouselSequence(raw: RawProductDetail | null | undefined): string[] {
  return Array.from(new Set([...(raw?.main_image ? [raw.main_image] : []), ...(raw?.carousel_images || [])]));
}

export function rawImageForCarouselSlot(raw: RawProductDetail | null | undefined, slot: string): string | null {
  if (!slot.startsWith("carousel_")) return null;
  const index = Number(slot.split("_")[1]) - 1;
  if (!Number.isInteger(index) || index < 0) return null;
  return rawCarouselSequence(raw)[index] || null;
}

export function normalizeExportImageSettings(settings: ExportImageSettings | null | undefined): Required<ExportImageSettings> {
  const position = Number(settings?.size_chart_position);
  return {
    insert_size_chart_in_carousel: Boolean(settings?.insert_size_chart_in_carousel),
    size_chart_position: Number.isFinite(position) && position >= 1 && position <= 9 ? Math.floor(position) : 5,
  };
}

export function insertItemAtPosition<T>(items: T[], item: T | null, enabled: boolean, position: number): T[] {
  if (!enabled || !item) return [...items];
  const index = Math.max(0, Math.min(items.length, position - 1));
  return [...items.slice(0, index), item, ...items.slice(index)];
}

export function tableSlotImage(
  assetsBySlot: AssetsBySlotResponse | undefined,
  raw: RawProductDetail | null | undefined,
  slot: string,
): TableSlotImage {
  const asset = selectedSlotAsset(assetsBySlot, slot);
  const suppressRawFallback = Boolean(asset?.public_url) || slotHasRemovalMarker(assetsBySlot, slot);
  const rawUrl = suppressRawFallback ? null : rawImageForCarouselSlot(raw, slot);
  const publicUrl = asset?.public_url || rawUrl || null;
  return { slot, asset, rawUrl, publicUrl };
}
