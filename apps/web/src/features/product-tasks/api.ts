import { apiBaseUrl } from "@/lib/api";
import type {
  ProductTaskListResponse,
  ProductTaskTimelineResponse,
  ProductTaskDetail,
  RawProductDetail,
  AssetsBySlotResponse,
  ExportFieldDraft,
} from "@/features/product-tasks/types";
import type { AiPurpose } from "@/lib/local-settings";

export type WorkbenchDetailResponse = {
  task: ProductTaskDetail;
  raw: RawProductDetail | null;
  assets: AssetsBySlotResponse;
  export_draft: ExportFieldDraft | null;
};

type RunAiOptions = {
  prompt_types?: string[];
};

function buildAiHeaders(includeImage: boolean, purposes: AiPurpose[]): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-ai-text-runtime": "local",
    "x-ai-image-runtime": includeImage ? "local" : "off",
    "x-ai-purposes": JSON.stringify(purposes),
  };
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: string };
    if (body?.detail) return body.detail;
  } catch {
    // ignore parse errors
  }
  return `HTTP ${response.status}`;
}

export async function listProductTasks(queryString: string): Promise<ProductTaskListResponse> {
  const response = await fetch(`${apiBaseUrl}/api/product-tasks${queryString}`, { cache: "no-store" });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as ProductTaskListResponse;
}

export async function getTaskTimeline(taskId: number): Promise<ProductTaskTimelineResponse> {
  const response = await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}/timeline`, { cache: "no-store" });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as ProductTaskTimelineResponse;
}

export async function getWorkbenchDetail(taskId: number): Promise<WorkbenchDetailResponse> {
  const response = await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}/workbench-detail`, { cache: "no-store" });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as WorkbenchDetailResponse;
}

export async function runTaskAi(taskId: number, options: RunAiOptions = {}): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}/run-ai`, {
    method: "POST",
    headers: buildAiHeaders(true, ["title_package", "product_info", "title"]),
    body: JSON.stringify(options),
  });
  if (!response.ok) throw new Error(await readError(response));
}

export async function generateTaskTitles(taskId: number): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}/generate-titles`, {
    method: "POST",
    headers: buildAiHeaders(false, ["title_package_lite", "title"]),
  });
  if (!response.ok) throw new Error(await readError(response));
}

export async function generateTaskFourGrid(taskId: number): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}/generate-images`, {
    method: "POST",
    headers: buildAiHeaders(true, ["dimension_extract", "title_package"]),
    body: JSON.stringify({
      job_type: "carousel_4grid",
      slots: ["carousel_1", "carousel_2", "carousel_3", "carousel_4"],
    }),
  });
  if (!response.ok) throw new Error(await readError(response));
}

export async function patchTaskFieldChoice(
  taskId: number,
  payload: { field_key: string; selected_source: string; manual_value?: string },
): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}/field-choice`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await readError(response));
}

export async function patchProductTask(taskId: number, payload: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await readError(response));
}

