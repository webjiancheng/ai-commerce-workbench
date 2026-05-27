import { apiBaseUrl } from "@/lib/api";
import type { AiPurpose } from "@/lib/local-settings";
import type { AssetsBySlotResponse } from "@/features/product-tasks/types";

async function readErrorDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: string | { message?: string } };
    if (typeof body?.detail === "string" && body.detail.trim()) return body.detail;
    if (body?.detail && typeof body.detail === "object" && typeof body.detail.message === "string") return body.detail.message;
  } catch {
    // ignore parse errors
  }
  return `HTTP ${res.status}`;
}

export async function listTaskAssets(taskId: number): Promise<AssetsBySlotResponse> {
  const res = await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}/assets`, { cache: "no-store" });
  if (!res.ok) throw new Error(await readErrorDetail(res));
  return ((await res.json()) as AssetsBySlotResponse) || {};
}

export async function getJobStatus(jobId: number): Promise<{ status: string; progress: number; error_message?: string | null }> {
  const res = await fetch(`${apiBaseUrl}/api/jobs/${jobId}`, { cache: "no-store" });
  if (!res.ok) throw new Error(await readErrorDetail(res));
  return (await res.json()) as { status: string; progress: number; error_message?: string | null };
}

function buildAiHeaders(includeImage: boolean, purposes: AiPurpose[]): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-ai-text-runtime": "local",
    "x-ai-image-runtime": includeImage ? "local" : "off",
    "x-ai-purposes": JSON.stringify(purposes),
  };
}

export async function generateCarousel4GridApi(taskId: number): Promise<{ job_ids: number[] }> {
  const res = await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}/generate-images`, {
    method: "POST",
    headers: buildAiHeaders(true, ["dimension_extract", "title_package"]),
    body: JSON.stringify({ job_type: "carousel_4grid" }),
  });
  if (!res.ok) throw new Error(await readErrorDetail(res));
  return (await res.json()) as { job_ids: number[] };
}

export async function generateSingleImageApi(taskId: number, slot: string): Promise<{ job_id: number }> {
  const res = await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}/generate-image`, {
    method: "POST",
    headers: buildAiHeaders(
      true,
      slot === "size_chart"
        ? ["dimension_extract", "title_package", "product_info"]
        : ["title_package", "product_info"],
    ),
    body: JSON.stringify({ slot }),
  });
  if (!res.ok) throw new Error(await readErrorDetail(res));
  return (await res.json()) as { job_id: number };
}

export async function generateSellingImagesApi(taskId: number): Promise<{ job_ids: number[] }> {
  const res = await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}/generate-selling-images`, {
    method: "POST",
    headers: buildAiHeaders(true, ["title_package", "product_info"]),
    body: JSON.stringify({ slots: ["carousel_1", "carousel_2", "carousel_3", "carousel_4"] }),
  });
  if (!res.ok) throw new Error(await readErrorDetail(res));
  return (await res.json()) as { job_ids: number[] };
}

export async function generateSkuImageApi(taskId: number): Promise<{ job_id?: number }> {
  const res = await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}/generate-sku-image`, {
    method: "POST",
    headers: buildAiHeaders(true, ["title_package", "product_info"]),
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(await readErrorDetail(res));
  return (await res.json()) as { job_id?: number };
}

export async function generateSizeImageApi(taskId: number): Promise<{ job_id?: number }> {
  const res = await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}/generate-size-image`, {
    method: "POST",
    headers: buildAiHeaders(true, ["dimension_extract", "title_package", "product_info"]),
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(await readErrorDetail(res));
  return (await res.json()) as { job_id?: number };
}

export async function setFinalAssetApi(assetId: number): Promise<void> {
  const res = await fetch(`${apiBaseUrl}/api/assets/${assetId}/set-final`, { method: "POST" });
  if (!res.ok) throw new Error(await readErrorDetail(res));
}

export async function patchTaskImageSettingsApi(
  taskId: number,
  payload: { export_image_settings_json: { insert_size_chart_in_carousel: boolean; size_chart_position: number } },
): Promise<void> {
  const res = await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await readErrorDetail(res));
}

export async function regenerateAssetApi(assetId: number): Promise<{ job_id: number }> {
  const res = await fetch(`${apiBaseUrl}/api/assets/${assetId}/regenerate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(await readErrorDetail(res));
  return (await res.json()) as { job_id: number };
}

export async function runDimensionExtractApi(taskId: number, assetId: number): Promise<{ result: Record<string, unknown> }> {
  const res = await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}/dimension-extract`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ asset_id: assetId }),
  });
  if (!res.ok) throw new Error(await readErrorDetail(res));
  return (await res.json()) as { result: Record<string, unknown> };
}

export async function assignImageToSlotApi(
  taskId: number,
  payload: { targetSlot: string; sourceAssetId?: number; sourceUrl?: string; imageDataUrl?: string; markAsFinal?: boolean },
): Promise<void> {
  const res = await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}/assign-image`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      target_slot: payload.targetSlot,
      source_asset_id: payload.sourceAssetId,
      source_url: payload.sourceUrl,
      image_data_url: payload.imageDataUrl,
      mark_as_final: payload.markAsFinal ?? true,
    }),
  });
  if (!res.ok) throw new Error(await readErrorDetail(res));
}

export async function reorderSlotsApi(taskId: number, sourceSlot: string, targetSlot: string): Promise<{ noop?: boolean }> {
  const res = await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}/reorder-slots`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source_slot: sourceSlot, target_slot: targetSlot }),
  });
  if (!res.ok) throw new Error(await readErrorDetail(res));
  return (await res.json()) as { noop?: boolean };
}

export async function removeSlotImageApi(taskId: number, slot: string): Promise<{ compacted?: { from_slot: string; to_slot: string }[] }> {
  const res = await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}/remove-slot-image`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ slot, compact_following: true }),
  });
  if (!res.ok) throw new Error(await readErrorDetail(res));
  return (await res.json()) as { compacted?: { from_slot: string; to_slot: string }[] };
}
