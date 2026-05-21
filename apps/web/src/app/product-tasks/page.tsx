"use client";

import { apiBaseUrl } from "@/lib/api";
import { HoverZoomImage } from "@/components/hover-zoom-image";
import { resolveLocalTextRuntime } from "@/lib/local-settings";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type TaskMainStatus =
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

type CategoryStatus = "pending" | "running" | "success" | "low_confidence" | "failed";
type ImagePromptStatus = "pending" | "running" | "ready" | "failed";
type ExportStatus = "pending" | "ready" | "running" | "exported" | "failed";
type GenerationMode = "no_ai" | "title_only" | "title_and_image_prompts" | "full_later";

type ProductTaskListItem = {
  id: number;
  raw_product_id: number;
  title: string;
  source_url: string | null;
  screenshot_url: string | null;
  product_platform: string | null;
  source_id: string | null;
  platform_sku: string | null;
  generation_mode: GenerationMode;
  main_status: TaskMainStatus;
  category_status: CategoryStatus;
  title_status: string;
  image_prompt_status: ImagePromptStatus;
  image_status: string;
  export_status: ExportStatus;
  selected_category_id: string | null;
  category_candidates_json: unknown[];
  exception_status: string | null;
  exception_level: string | null;
  exception_reasons_json: unknown[];
  last_error_message: string | null;
  retry_count: number;
  exception_updated_at: string | null;
  created_at: string;
};

type ProductTaskDetail = ProductTaskListItem & {
  notes: string | null;
  updated_at: string;
  ai?: {
    category_best_path: string | null;
    category_confidence: number | null;
    category_top3: { path: string; confidence: number | null }[];
    category_candidates: { path: string; score?: number | null; matched_terms?: string[] }[];
    product_info: Record<string, unknown> | null;
    product_dna: Record<string, unknown> | null;
    title_cn: string | null;
    title_en: string | null;
    product_description: string | null;
    title_package: Record<string, unknown> | null;
    image_prompt_package: Record<string, unknown> | null;
  } | null;
};

type ProductTaskListResponse = {
  items: ProductTaskListItem[];
  total: number;
  limit: number;
  offset: number;
};

type ProductTaskTimelineEvent = {
  ts: string | null;
  stage: string;
  status: string;
  title: string;
  message: string;
  source: string;
  meta: Record<string, unknown>;
};

type ProductTaskTimelineSummary = {
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

type ProductTaskTimelineResponse = {
  task_id: number;
  raw_product_id: number;
  summary: ProductTaskTimelineSummary;
  events: ProductTaskTimelineEvent[];
};

type RawProductDetail = {
  id: number;
  platform: string | null;
  url: string;
  title: string;
  price: string | null;
  platform_sku: string | null;
  source_id: string | null;
  screenshot_url: string | null;
  main_image: string | null;
  carousel_images: string[];
  sku_images: string[];
  detail_images: string[];
  size_chart_images: string[];
  created_at: string;
};

function buildAiRequestHeaders(includeJsonContentType = false): Record<string, string> {
  const runtime = resolveLocalTextRuntime();
  const headers: Record<string, string> = includeJsonContentType ? { "content-type": "application/json" } : {};
  if (!runtime) return headers;
  if (runtime.apiKey) headers["X-AI-API-Key"] = runtime.apiKey;
  if (runtime.baseUrl) headers["X-AI-Base-URL"] = runtime.baseUrl;
  if (runtime.model) headers["X-AI-Model"] = runtime.model;
  return headers;
}

type ProductAsset = {
  id: number;
  product_task_id: number;
  slot: string;
  asset_type: string;
  source_type: string;
  version: number;
  parent_asset_id: number | null;
  generation_job_id: number | null;
  public_url: string | null;
  width: number | null;
  height: number | null;
  provider: string | null;
  model_name: string | null;
  selected_for_export: boolean;
  status: string;
  created_at: string;
};

type AssetsBySlotResponse = Record<string, ProductAsset[]>;
type RowMeta = {
  raw: RawProductDetail | null;
  assets: AssetsBySlotResponse;
  detail: ProductTaskDetail | null;
};

type ExportFieldDraft = {
  id: number;
  product_task_id: number;
  fields_json: Record<string, unknown>;
  field_sources_json: Record<string, unknown>;
  warnings_json: unknown[];
  status: string;
  updated_at: string;
};

type ExportFieldCandidates = Record<
  string,
  {
    raw?: unknown;
    ai?: unknown;
    current?: unknown;
    manual?: unknown;
  }
>;

type WorkbenchDetailResponse = {
  ok: boolean;
  task: ProductTaskDetail;
  raw: RawProductDetail | null;
  assets: AssetsBySlotResponse;
  export_draft: ExportFieldDraft | null;
};

type ViewMode = "cards" | "table";
type DrawerSize = "50" | "70" | "100";
type DrawerTab = "images" | "info" | "defaults" | "raw";

type PromptEditorConfig = {
  fieldLabel: string;
  promptTypes: string[];
  taskIds: number[];
};

const DRAWER_SIZE_KEY = "ai-caiji.workbench.drawerSize";

function buildQuery(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (!value) return;
    query.set(key, value);
  });
  const result = query.toString();
  return result ? `?${result}` : "";
}

function statusBadgeColor(status: string): string {
  if (status === "failed") return "bg-rose-100 text-rose-700 border-rose-200";
  if (status === "exported") return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (status.endsWith("running") || status === "running")
    return "bg-amber-100 text-amber-800 border-amber-200";
  if (status === "success" || status === "ready")
    return "bg-emerald-100 text-emerald-700 border-emerald-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

function statusText(status: string): string {
  const map: Record<string, string> = {
    draft: "草稿",
    collected: "已采集",
    normalized: "已清洗",
    ai_running: "AI 处理中",
    ai_ready: "AI 已完成",
    prompts_ready: "提示词已准备",
    image_running: "图片处理中",
    review_ready: "待复核",
    export_ready: "可导出",
    exported: "已导出",
    failed: "失败",
    pending: "待处理",
    queued: "已排队",
    started: "已启动",
    running: "处理中",
    success: "成功",
    warning: "警告",
    low_confidence: "置信度低",
    ready: "已就绪",
  };
  return map[status] || status;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function formatJson(value: unknown): string {
  if (value == null) return "{}";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function copyTraceEvent(event: ProductTaskTimelineEvent): Promise<void> {
  const payload = {
    stage: event.stage,
    status: event.status,
    title: event.title,
    ts: event.ts,
    source: event.source,
    message: event.message,
    meta: event.meta,
  };
  const text = JSON.stringify(payload, null, 2);
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  window.prompt("复制日志", text);
}

async function copyText(value: string): Promise<void> {
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  window.prompt("复制内容", value);
}

function taskThumbnail(task: ProductTaskListItem, meta?: RowMeta | null): string | null {
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

function latestAsset(assets: ProductAsset[] | undefined): ProductAsset | null {
  return assets?.find((asset) => asset.selected_for_export) || assets?.[0] || null;
}

function selectedSlotAsset(assetsBySlot: AssetsBySlotResponse | undefined, slot: string): ProductAsset | null {
  return latestAsset(assetsBySlot?.[slot]);
}

function ThumbnailPlaceholder({ label = "暂无图" }: { label?: string }) {
  return (
    <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-[10px] text-slate-400">
      {label}
    </div>
  );
}

export default function ProductTasksPage() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialViewMode: ViewMode = pathname === "/logs" || searchParams.get("view") === "logs" ? "cards" : "table";
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode);
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<TaskMainStatus | "">("");
  const [categoryStatus, setCategoryStatus] = useState<CategoryStatus | "">("");
  const [exportStatus, setExportStatus] = useState<ExportStatus | "">("");
  const [exceptionOnly, setExceptionOnly] = useState<boolean>(pathname === "/logs" || searchParams.get("exception") === "1");
  const [lowConfidenceOnly, setLowConfidenceOnly] = useState<boolean>(searchParams.get("low_confidence") === "1");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [data, setData] = useState<ProductTaskListResponse>({
    items: [],
    total: 0,
    limit: 20,
    offset: 0,
  });
  const [rowMeta, setRowMeta] = useState<Record<number, RowMeta>>({});
  const [timelineMap, setTimelineMap] = useState<Record<number, ProductTaskTimelineResponse>>({});
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkLoading, setBulkLoading] = useState<string | null>(null);
  const [rowLoading, setRowLoading] = useState<Record<number, string>>({});
  const [quickTitleDrafts, setQuickTitleDrafts] = useState<Record<number, string>>({});
  const [quickCategoryDrafts, setQuickCategoryDrafts] = useState<Record<number, string>>({});
  const [bulkTitleMode, setBulkTitleMode] = useState<"current" | "raw" | "ai">("ai");
  const [bulkTitlePrefix, setBulkTitlePrefix] = useState("");
  const [bulkTitleSuffix, setBulkTitleSuffix] = useState("");
  const [bulkCategoryValue, setBulkCategoryValue] = useState("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerSize, setDrawerSize] = useState<DrawerSize>("70");
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("images");
  const [activeTaskId, setActiveTaskId] = useState<number | null>(null);
  const [taskDetail, setTaskDetail] = useState<ProductTaskDetail | null>(null);
  const [rawDetail, setRawDetail] = useState<RawProductDetail | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [promptEditor, setPromptEditor] = useState<PromptEditorConfig | null>(null);
  const isLogsRoute = pathname === "/logs";

  useEffect(() => {
    const stored = window.localStorage.getItem(DRAWER_SIZE_KEY);
    if (stored === "50" || stored === "70" || stored === "100") setDrawerSize(stored);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(DRAWER_SIZE_KEY, drawerSize);
  }, [drawerSize]);

  useEffect(() => {
    const nextView: ViewMode = pathname === "/logs" || searchParams.get("view") === "logs" ? "cards" : "table";
    setViewMode(nextView);
    if (pathname === "/logs" || searchParams.get("view") === "logs") {
      if (searchParams.get("exception") === null && searchParams.get("low_confidence") === null) {
        setExceptionOnly(true);
      }
    }
  }, [pathname, searchParams]);

  const queryString = useMemo(() => {
    return buildQuery({
      limit: String(data.limit),
      offset: String(data.offset),
      keyword: keyword.trim() ? keyword.trim() : undefined,
      status: status || undefined,
      category_status: categoryStatus || undefined,
      export_status: exportStatus || undefined,
      exception: exceptionOnly ? "true" : undefined,
      low_confidence: lowConfidenceOnly ? "true" : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, status, categoryStatus, exportStatus, exceptionOnly, lowConfidenceOnly, data.limit, data.offset]);

  async function loadList(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${apiBaseUrl}/api/product-tasks${queryString}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = (await response.json()) as ProductTaskListResponse;
      setData((prev) => ({ ...prev, ...result }));
      setSelectedIds((prev) => prev.filter((id) => result.items.some((item) => item.id === id)));
      void loadRowMeta(result.items);
      void loadTimelines(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load product tasks");
    } finally {
      setLoading(false);
    }
  }

  async function loadTimelines(items: ProductTaskListItem[]): Promise<void> {
    if (!items.length) {
      setTimelineMap({});
      return;
    }
    try {
      const results = await Promise.all(
        items.map(async (item) => {
          const response = await fetch(`${apiBaseUrl}/api/product-tasks/${item.id}/timeline`, {
            cache: "no-store",
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return (await response.json()) as ProductTaskTimelineResponse;
        }),
      );
      setTimelineMap(
        results.reduce<Record<number, ProductTaskTimelineResponse>>((acc, timeline) => {
          acc[timeline.task_id] = timeline;
          return acc;
        }, {}),
      );
    } catch (err) {
      console.error("Failed to load task timelines", err);
    }
  }

  useEffect(() => {
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryString]);

  const currentPage = Math.floor(data.offset / data.limit) + 1;
  const totalPages = Math.max(1, Math.ceil((data.total || 0) / data.limit));

  function changePage(nextPage: number): void {
    const safePage = Math.min(Math.max(1, nextPage), totalPages);
    setData((prev) => ({ ...prev, offset: (safePage - 1) * prev.limit }));
  }

  function changePageSize(nextLimit: number): void {
    setData((prev) => ({ ...prev, limit: nextLimit, offset: 0 }));
  }

  function openPromptEditor(fieldLabel: string, promptTypes: string[]): void {
    const taskIds = selectedIds.length
      ? selectedIds
      : activeTaskId
        ? [activeTaskId]
        : data.items[0]
          ? [data.items[0].id]
          : [];
    if (!taskIds.length) {
      setNotice("当前没有可编辑提示词的任务");
      return;
    }
    setPromptEditor({ fieldLabel, promptTypes, taskIds });
  }

  async function loadWorkbenchDetail(taskId: number): Promise<void> {
    const detailRes = await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}/workbench-detail`, {
      cache: "no-store",
    });
    if (!detailRes.ok) throw new Error(`加载详情失败: HTTP ${detailRes.status}`);
    const detail = (await detailRes.json()) as WorkbenchDetailResponse;
    setTaskDetail(detail.task);
    setRawDetail(detail.raw);
  }

  async function openDrawer(taskId: number): Promise<void> {
    setDrawerOpen(true);
    setActiveTaskId(taskId);
    setDrawerLoading(true);
    setDrawerError(null);
    setTaskDetail(null);
    setRawDetail(null);

    try {
      await loadWorkbenchDetail(taskId);
    } catch (err) {
      setDrawerError(err instanceof Error ? err.message : "Failed to load task detail");
    } finally {
      setDrawerLoading(false);
    }
  }

  function closeDrawer(): void {
    setDrawerOpen(false);
    setActiveTaskId(null);
  }

  async function loadRowMeta(items: ProductTaskListItem[]): Promise<void> {
    const pairs = await Promise.all(
      items.map(async (item) => {
        try {
          const [rawRes, assetsRes, detailRes] = await Promise.all([
            fetch(`${apiBaseUrl}/api/raw-products/${item.raw_product_id}`, { cache: "no-store" }),
            fetch(`${apiBaseUrl}/api/product-tasks/${item.id}/assets`, { cache: "no-store" }),
            fetch(`${apiBaseUrl}/api/product-tasks/${item.id}`, { cache: "no-store" }),
          ]);

          const raw = rawRes.ok ? ((await rawRes.json()) as RawProductDetail) : null;
          const assets = assetsRes.ok ? (((await assetsRes.json()) as AssetsBySlotResponse) || {}) : {};
          const detail = detailRes.ok ? ((await detailRes.json()) as ProductTaskDetail) : null;
          return [item.id, { raw, assets, detail }] as const;
        } catch {
          return [item.id, { raw: null, assets: {}, detail: null }] as const;
        }
      }),
    );

    const nextMeta = Object.fromEntries(pairs) as Record<number, RowMeta>;
    setRowMeta(nextMeta);
    setQuickTitleDrafts((prev) => {
      const next = { ...prev };
      for (const item of items) {
        const meta = nextMeta[item.id];
        if (!next[item.id]) {
          next[item.id] = meta?.detail?.title || item.title || "";
        }
      }
      return next;
    });
    setQuickCategoryDrafts((prev) => {
      const next = { ...prev };
      for (const item of items) {
        const meta = nextMeta[item.id];
        if (!next[item.id]) {
          next[item.id] =
            meta?.detail?.selected_category_id || meta?.detail?.ai?.category_best_path || item.selected_category_id || "";
        }
      }
      return next;
    });
  }

  const allSelected = data.items.length > 0 && selectedIds.length === data.items.length;

  function toggleSelectAll(): void {
    if (allSelected) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds(data.items.map((item) => item.id));
  }

  function toggleSelect(id: number): void {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }

  async function runBulkAction(
    actionName: string,
    runner: (taskId: number) => Promise<void>,
    successText: string,
  ): Promise<void> {
    if (!selectedIds.length) {
      setNotice("请先选择商品");
      return;
    }

    setBulkLoading(actionName);
    setError(null);
    setNotice(null);
    try {
      for (const taskId of selectedIds) {
        await runner(taskId);
      }
      setNotice(successText.replace("{count}", String(selectedIds.length)));
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${actionName}失败`);
    } finally {
      setBulkLoading(null);
    }
  }

  async function generateFourGrid(taskId: number): Promise<void> {
    const response = await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}/generate-images`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        job_type: "carousel_4grid",
        slots: ["carousel_1", "carousel_2", "carousel_3", "carousel_4"],
      }),
    });
    const result = (await response.json()) as { detail?: string };
    if (!response.ok) throw new Error(result.detail || `HTTP ${response.status}`);
  }

  async function runAi(taskId: number): Promise<void> {
    const response = await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}/run-ai`, {
      method: "POST",
      headers: buildAiRequestHeaders(true),
      body: JSON.stringify({}),
    });
    const result = (await response.json()) as { detail?: string };
    if (!response.ok) throw new Error(result.detail || `HTTP ${response.status}`);
  }

  async function generateTitles(taskId: number): Promise<void> {
    const response = await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}/generate-titles`, {
      method: "POST",
      headers: buildAiRequestHeaders(),
    });
    const result = (await response.json()) as { detail?: string };
    if (!response.ok) throw new Error(result.detail || `HTTP ${response.status}`);
  }

  async function saveQuickTitle(taskId: number): Promise<void> {
    const manualValue = (quickTitleDrafts[taskId] || "").trim();
    if (!manualValue) {
      setNotice("标题不能为空");
      return;
    }
    const response = await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}/field-choice`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        field_key: "task_title",
        selected_source: "manual",
        manual_value: manualValue,
      }),
    });
    const result = (await response.json()) as { detail?: string };
    if (!response.ok) throw new Error(result.detail || `HTTP ${response.status}`);
  }

  async function saveQuickCategory(taskId: number): Promise<void> {
    const categoryPath = (quickCategoryDrafts[taskId] || "").trim();
    if (!categoryPath) {
      setNotice("类目不能为空");
      return;
    }
    const response = await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}/select-category`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ category_path: categoryPath }),
    });
    const result = (await response.json()) as { detail?: string };
    if (!response.ok) throw new Error(result.detail || `HTTP ${response.status}`);
  }

  async function applyBulkTitleEdits(): Promise<void> {
    if (!selectedIds.length) {
      setNotice("请先选择商品");
      return;
    }
    setBulkLoading("批量改标题");
    setError(null);
    setNotice(null);
    try {
      for (const taskId of selectedIds) {
        const meta = rowMeta[taskId];
        const listItem = data.items.find((item) => item.id === taskId);
        const baseTitle =
          bulkTitleMode === "raw"
            ? meta?.raw?.title || listItem?.title || ""
            : bulkTitleMode === "ai"
              ? meta?.detail?.ai?.title_cn || meta?.detail?.title || listItem?.title || ""
              : quickTitleDrafts[taskId] || meta?.detail?.title || listItem?.title || "";
        const nextTitle = `${bulkTitlePrefix}${baseTitle}${bulkTitleSuffix}`.trim();
        if (!nextTitle) continue;
        await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}/field-choice`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            field_key: "task_title",
            selected_source: "manual",
            manual_value: nextTitle,
          }),
        }).then(async (response) => {
          const result = (await response.json()) as { detail?: string };
          if (!response.ok) throw new Error(result.detail || `HTTP ${response.status}`);
        });
      }
      setNotice(`已批量更新 ${selectedIds.length} 个商品标题。`);
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "批量改标题失败");
    } finally {
      setBulkLoading(null);
    }
  }

  async function applyBulkCategory(): Promise<void> {
    if (!selectedIds.length) {
      setNotice("请先选择商品");
      return;
    }
    if (!bulkCategoryValue.trim()) {
      setNotice("请先填写类目");
      return;
    }
    setBulkLoading("批量套类目");
    setError(null);
    setNotice(null);
    try {
      for (const taskId of selectedIds) {
        await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}/select-category`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ category_path: bulkCategoryValue.trim() }),
        }).then(async (response) => {
          const result = (await response.json()) as { detail?: string };
          if (!response.ok) throw new Error(result.detail || `HTTP ${response.status}`);
        });
      }
      setNotice(`已为 ${selectedIds.length} 个商品套用类目。`);
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "批量套类目失败");
    } finally {
      setBulkLoading(null);
    }
  }

  async function applyBulkGenerateFourGrid(): Promise<void> {
    if (!selectedIds.length) {
      setNotice("请先选择商品");
      return;
    }
    const ok = window.confirm(`将为已选择的 ${selectedIds.length} 个商品重生四宫格，是否继续？`);
    if (!ok) return;

    setBulkLoading("批量重生四宫格");
    setError(null);
    setNotice(null);
    try {
      for (const taskId of selectedIds) {
        await generateFourGrid(taskId);
      }
      setNotice(`已提交 ${selectedIds.length} 个商品的四宫格生成任务。`);
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "批量重生四宫格失败");
    } finally {
      setBulkLoading(null);
    }
  }

  async function runRowAction(taskId: number, action: string, runner: () => Promise<void>): Promise<void> {
    if (rowLoading[taskId]) return;
    setError(null);
    setNotice(null);
    setRowLoading((prev) => ({ ...prev, [taskId]: action }));
    try {
      await runner();
      if (action === "run-ai") setNotice(`任务 #${taskId} 已提交 AI 处理。`);
      if (action === "gen-title") setNotice(`任务 #${taskId} 已提交标题生成。`);
      if (action === "gen-4grid") setNotice(`任务 #${taskId} 已提交四宫格生成。`);
      if (action === "save-title") setNotice(`任务 #${taskId} 标题已更新。`);
      if (action === "save-category") setNotice(`任务 #${taskId} 类目已更新。`);
      if (action === "set-final") setNotice(`任务 #${taskId} 主图已确认。`);
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setRowLoading((prev) => {
        const next = { ...prev };
        delete next[taskId];
        return next;
      });
    }
  }

  async function applyDefaults(taskId: number): Promise<void> {
    const response = await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}/apply-default-rules`, {
      method: "POST",
    });
    const result = (await response.json()) as { detail?: string };
    if (!response.ok) throw new Error(result.detail || `HTTP ${response.status}`);
  }

  async function deleteTask(taskId: number): Promise<void> {
    const response = await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}`, {
      method: "DELETE",
    });
    const result = (await response.json()) as { detail?: string };
    if (!response.ok) throw new Error(result.detail || `HTTP ${response.status}`);
  }

  async function handleBulkValidate(): Promise<void> {
    if (!selectedIds.length) {
      setNotice("请先选择商品");
      return;
    }
    setBulkLoading("批量校验");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`${apiBaseUrl}/api/exports/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ product_task_ids: selectedIds }),
      });
      const result = (await response.json()) as {
        rows?: { validation_result?: { errors?: unknown[]; warnings?: unknown[] } }[];
        detail?: string;
      };
      if (!response.ok) throw new Error(result.detail || `HTTP ${response.status}`);
      const errorsCount =
        result.rows?.reduce(
          (sum, row) => sum + (Array.isArray(row.validation_result?.errors) ? row.validation_result.errors.length : 0),
          0,
        ) || 0;
      const warningsCount =
        result.rows?.reduce(
          (sum, row) =>
            sum + (Array.isArray(row.validation_result?.warnings) ? row.validation_result.warnings.length : 0),
          0,
        ) || 0;
      setNotice(`已校验 ${selectedIds.length} 个商品，错误 ${errorsCount} 条，警告 ${warningsCount} 条。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "批量校验失败");
    } finally {
      setBulkLoading(null);
    }
  }

  async function handleBulkExport(): Promise<void> {
    if (!selectedIds.length) {
      setNotice("请先选择商品");
      return;
    }
    setBulkLoading("批量导出");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`${apiBaseUrl}/api/exports/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ product_task_ids: selectedIds }),
      });
      const result = (await response.json()) as { batch_no?: string; detail?: string };
      if (!response.ok) throw new Error(result.detail || `HTTP ${response.status}`);
      setNotice(`已提交 ${selectedIds.length} 个商品导出，批次号：${result.batch_no || "-"}`);
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "批量导出失败");
    } finally {
      setBulkLoading(null);
    }
  }

  async function handleBulkDelete(): Promise<void> {
    if (!selectedIds.length) {
      setNotice("请先选择商品");
      return;
    }
    if (!window.confirm(`确定删除已选择的 ${selectedIds.length} 个商品任务吗？相关 AI、图片、导出草稿和记录也会一并删除。`)) {
      return;
    }
    await runBulkAction("批量删除", deleteTask, "已删除 {count} 个商品任务。");
  }

  async function handleDeleteOne(taskId: number): Promise<void> {
    if (!window.confirm("确定删除这个商品任务吗？相关 AI、图片、导出草稿和记录也会一并删除。")) {
      return;
    }
    setBulkLoading("删除商品任务");
    setError(null);
    setNotice(null);
    try {
      await deleteTask(taskId);
      setNotice("商品任务已删除。");
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除商品任务失败");
    } finally {
      setBulkLoading(null);
    }
  }

  const drawerWidthClass =
    drawerSize === "50" ? "w-1/2" : drawerSize === "70" ? "w-[70%]" : "w-full";

  return (
    <div className="min-h-screen px-4 py-6 md:px-6">
      <section className="mx-auto max-w-[98vw]">
        <header className="rounded-[28px] border border-[var(--card-border)] bg-[var(--card)] p-6 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-sm text-slate-500">{isLogsRoute ? "任务排查工具" : "正式处理工作台"}</div>
              <h1 className="mt-1 text-3xl font-semibold">{isLogsRoute ? "任务日志排查台" : "上架加工工作台"}</h1>
              <div className="mt-2 text-sm text-slate-600">
                共 {data.total} 条 {loading ? "（加载中…）" : ""}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {isLogsRoute ? (
                <Link
                  href="/product-tasks"
                  className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  打开上架加工工作台
                </Link>
              ) : (
                <Link
                  href="/logs"
                  className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  打开任务日志 / 排查视图
                </Link>
              )}
              {!isLogsRoute ? (
                <button
                  type="button"
                  onClick={() => setViewMode((value) => (value === "table" ? "cards" : "table"))}
                  className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800"
                >
                  {viewMode === "table" ? "切到日志卡片视图" : "切到表格视图"}
                </button>
              ) : null}
            </div>
          </div>

          <div className="mt-6 grid gap-3 lg:grid-cols-[1.3fr_0.7fr_0.7fr_0.7fr_auto]">
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索：标题 / 平台 SKU"
              className="h-11 rounded-[16px] border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
            />
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as TaskMainStatus | "")}
              className="h-11 rounded-[16px] border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
            >
              <option value="">主状态：全部</option>
              <option value="draft">草稿</option>
              <option value="collected">已采集</option>
              <option value="normalized">已清洗</option>
              <option value="ai_running">AI 处理中</option>
              <option value="ai_ready">AI 已完成</option>
              <option value="prompts_ready">提示词已准备</option>
              <option value="image_running">图片处理中</option>
              <option value="review_ready">待复核</option>
              <option value="export_ready">可导出</option>
              <option value="exported">已导出</option>
              <option value="failed">失败</option>
            </select>
            <select
              value={categoryStatus}
              onChange={(event) => setCategoryStatus(event.target.value as CategoryStatus | "")}
              className="h-11 rounded-[16px] border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
            >
              <option value="">类目状态：全部</option>
              <option value="pending">待处理</option>
              <option value="running">处理中</option>
              <option value="success">成功</option>
              <option value="low_confidence">置信度低</option>
              <option value="failed">失败</option>
            </select>
            <select
              value={exportStatus}
              onChange={(event) => setExportStatus(event.target.value as ExportStatus | "")}
              className="h-11 rounded-[16px] border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
            >
              <option value="">导出状态：全部</option>
              <option value="pending">待处理</option>
              <option value="ready">已就绪</option>
              <option value="running">处理中</option>
              <option value="exported">已导出</option>
              <option value="failed">失败</option>
            </select>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setExceptionOnly((value) => !value)}
                className={[
                  "h-11 rounded-full px-4 text-sm",
                  exceptionOnly
                    ? "border border-rose-300 bg-rose-50 text-rose-700"
                    : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                ].join(" ")}
              >
                {exceptionOnly ? "仅异常：开" : "仅异常：关"}
              </button>
              <button
                type="button"
                onClick={() => setLowConfidenceOnly((value) => !value)}
                className={[
                  "h-11 rounded-full px-4 text-sm",
                  lowConfidenceOnly
                    ? "border border-amber-300 bg-amber-50 text-amber-800"
                    : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                ].join(" ")}
              >
                {lowConfidenceOnly ? "低置信度：开" : "低置信度：关"}
              </button>
              <button
                type="button"
                onClick={() =>
                  void runBulkAction("批量跑 AI", runAi, "已提交 {count} 个商品的 AI 处理任务。")
                }
                disabled={!selectedIds.length || bulkLoading !== null}
                className={[
                  "h-11 rounded-full px-4 text-sm",
                  !selectedIds.length || bulkLoading !== null
                    ? "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400"
                    : "border border-slate-900 bg-slate-900 text-white hover:bg-slate-800",
                ].join(" ")}
              >
                批量跑 AI
              </button>
              <button
                type="button"
                onClick={() =>
                  void runBulkAction("批量生成标题", generateTitles, "已提交 {count} 个商品的标题生成任务。")
                }
                disabled={!selectedIds.length || bulkLoading !== null}
                className={[
                  "h-11 rounded-full px-4 text-sm",
                  !selectedIds.length || bulkLoading !== null
                    ? "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400"
                    : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                ].join(" ")}
              >
                批量生成标题
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!selectedIds.length) {
                    setNotice("请先选择商品");
                    return;
                  }
                  const ok = window.confirm(
                    `将为已选择的 ${selectedIds.length} 个商品生成四宫格轮播图，是否继续？`,
                  );
                  if (!ok) return;
                  void runBulkAction("批量生成四宫格", generateFourGrid, "已提交 {count} 个商品的四宫格生成任务。");
                }}
                disabled={!selectedIds.length || bulkLoading !== null}
                className={[
                  "h-11 rounded-full px-4 text-sm",
                  !selectedIds.length || bulkLoading !== null
                    ? "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400"
                    : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                ].join(" ")}
              >
                批量生成四宫格
              </button>
              <button
                type="button"
                onClick={() =>
                  void runBulkAction("批量应用默认值", applyDefaults, "已为 {count} 个商品应用默认值。")
                }
                disabled={!selectedIds.length || bulkLoading !== null}
                className={[
                  "h-11 rounded-full px-4 text-sm",
                  !selectedIds.length || bulkLoading !== null
                    ? "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400"
                    : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                ].join(" ")}
              >
                批量应用默认值
              </button>
              <button
                type="button"
                onClick={() => void handleBulkValidate()}
                disabled={!selectedIds.length || bulkLoading !== null}
                className={[
                  "h-11 rounded-full px-4 text-sm",
                  !selectedIds.length || bulkLoading !== null
                    ? "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400"
                    : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                ].join(" ")}
              >
                批量校验
              </button>
              <button
                type="button"
                onClick={() => void handleBulkExport()}
                disabled={!selectedIds.length || bulkLoading !== null}
                className={[
                  "h-11 rounded-full px-4 text-sm",
                  !selectedIds.length || bulkLoading !== null
                    ? "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400"
                    : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                ].join(" ")}
              >
                批量导出
              </button>
              <button
                type="button"
                onClick={() => void handleBulkDelete()}
                disabled={!selectedIds.length || bulkLoading !== null}
                className={[
                  "h-11 rounded-full px-4 text-sm",
                  !selectedIds.length || bulkLoading !== null
                    ? "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400"
                    : "border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100",
                ].join(" ")}
              >
                批量删除
              </button>
            </div>
          </div>

          {error ? <div className="mt-4 text-sm text-rose-600">加载失败：{error}</div> : null}
          {notice ? <div className="mt-4 text-sm text-emerald-700">{notice}</div> : null}
          <div className="mt-4 rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            已选择 {selectedIds.length} 个商品任务
            {bulkLoading ? <span className="ml-2 text-slate-500">当前操作：{bulkLoading}</span> : null}
          </div>

          {selectedIds.length ? (
            <div className="mt-4 rounded-[22px] border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">批量处理工具栏</div>
                  <div className="mt-1 text-xs text-slate-500">围绕最终导出结果批量处理标题、类目、默认值和图片。</div>
                </div>
                <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
                  当前选中 {selectedIds.length} 条
                </div>
              </div>

              <div className="mt-4 grid gap-3 xl:grid-cols-[220px_1fr_1fr_auto]">
                <select
                  value={bulkTitleMode}
                  onChange={(event) => setBulkTitleMode(event.target.value as "current" | "raw" | "ai")}
                  className="h-11 rounded-[16px] border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
                >
                  <option value="ai">基于 AI 标题</option>
                  <option value="raw">基于原始标题</option>
                  <option value="current">基于当前标题</option>
                </select>
                <input
                  value={bulkTitlePrefix}
                  onChange={(event) => setBulkTitlePrefix(event.target.value)}
                  placeholder="批量标题前缀"
                  className="h-11 rounded-[16px] border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
                />
                <input
                  value={bulkTitleSuffix}
                  onChange={(event) => setBulkTitleSuffix(event.target.value)}
                  placeholder="批量标题后缀"
                  className="h-11 rounded-[16px] border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
                />
                <button
                  type="button"
                  onClick={() => void applyBulkTitleEdits()}
                  disabled={bulkLoading !== null}
                  className="h-11 rounded-full border border-slate-900 bg-slate-900 px-4 text-sm text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  批量保存标题
                </button>
              </div>

              <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_auto_auto_auto_auto_auto]">
                <input
                  value={bulkCategoryValue}
                  onChange={(event) => setBulkCategoryValue(event.target.value)}
                  placeholder="输入完整类目路径，应用到当前选中商品"
                  className="h-11 rounded-[16px] border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
                />
                <button
                  type="button"
                  onClick={() => void applyBulkCategory()}
                  disabled={bulkLoading !== null}
                  className="h-11 rounded-full border border-slate-900 bg-slate-900 px-4 text-sm text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  批量类目
                </button>
                <button
                  type="button"
                  onClick={() => void runBulkAction("批量应用默认值", applyDefaults, "已为 {count} 个商品应用默认值。")}
                  disabled={bulkLoading !== null}
                  className="h-11 rounded-full border border-slate-300 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  上架默认值
                </button>
                <button
                  type="button"
                  onClick={() => void applyBulkGenerateFourGrid()}
                  disabled={bulkLoading !== null}
                  className="h-11 rounded-full border border-slate-300 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  批量四宫格
                </button>
                <button
                  type="button"
                  onClick={() => void handleBulkExport()}
                  disabled={bulkLoading !== null}
                  className="h-11 rounded-full border border-slate-300 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  批量导出
                </button>
                <button
                  type="button"
                  onClick={() => void handleBulkDelete()}
                  disabled={bulkLoading !== null}
                  className="h-11 rounded-full border border-rose-200 bg-rose-50 px-4 text-sm text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  批量删除
                </button>
              </div>
            </div>
          ) : null}
        </header>

        <section className="mt-6">
          {viewMode === "cards" ? (
            <ReviewBoard
              items={data.items}
              rowMeta={rowMeta}
              timelineMap={timelineMap}
              onOpenDrawer={(taskId) => void openDrawer(taskId)}
            />
          ) : (
            <WorkbenchTable
              items={data.items}
              rowMeta={rowMeta}
              selectedIds={selectedIds}
              allSelected={allSelected}
              onToggleSelect={toggleSelect}
              onToggleSelectAll={toggleSelectAll}
              quickTitleDrafts={quickTitleDrafts}
              quickCategoryDrafts={quickCategoryDrafts}
              rowLoading={rowLoading}
              onQuickTitleChange={(taskId, value) =>
                setQuickTitleDrafts((prev) => ({ ...prev, [taskId]: value }))
              }
              onQuickCategoryChange={(taskId, value) =>
                setQuickCategoryDrafts((prev) => ({ ...prev, [taskId]: value }))
              }
              onPickCandidate={(taskId, path) =>
                setQuickCategoryDrafts((prev) => ({ ...prev, [taskId]: path }))
              }
              onGenerateTitles={(taskId) => void runRowAction(taskId, "gen-title", () => generateTitles(taskId))}
              onSaveTitle={(taskId) => void runRowAction(taskId, "save-title", () => saveQuickTitle(taskId))}
              onSaveCategory={(taskId) => void runRowAction(taskId, "save-category", () => saveQuickCategory(taskId))}
              onGenerateFourGrid={(taskId) => void runRowAction(taskId, "gen-4grid", () => generateFourGrid(taskId))}
              onOpenDrawer={(taskId) => void openDrawer(taskId)}
              onDelete={(taskId) => void handleDeleteOne(taskId)}
              onOpenPromptEditor={openPromptEditor}
            />
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
            <div>
              共 {data.total} 条，当前第 {currentPage} / {totalPages} 页
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={String(data.limit)}
                onChange={(event) => changePageSize(Number(event.target.value))}
                className="h-10 rounded-full border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
              >
                <option value="20">20 / 页</option>
                <option value="50">50 / 页</option>
                <option value="100">100 / 页</option>
              </select>
              <button
                type="button"
                onClick={() => changePage(currentPage - 1)}
                disabled={currentPage <= 1}
                className="h-10 rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
              >
                上一页
              </button>
              <button
                type="button"
                onClick={() => changePage(currentPage + 1)}
                disabled={currentPage >= totalPages}
                className="h-10 rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
              >
                下一页
              </button>
            </div>
          </div>
        </section>
      </section>

      {drawerOpen ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            className="absolute inset-0 bg-black/30"
            aria-label="关闭详情抽屉"
            onClick={closeDrawer}
          />
          <aside
            className={[
              "absolute right-0 top-0 h-full border-l border-slate-200 bg-white shadow-[0_30px_120px_rgba(15,23,42,0.22)]",
              drawerWidthClass,
            ].join(" ")}
          >
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
                <div className="min-w-0">
                  <div className="text-xs text-slate-500">
                    任务详情 {activeTaskId ? `#${activeTaskId}` : ""}
                  </div>
                  <div className="mt-1 truncate text-sm font-semibold text-slate-900">
                    {taskDetail?.title || (drawerLoading ? "加载中…" : "未加载")}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="hidden items-center gap-1 rounded-full border border-slate-200 bg-slate-50 p-1 sm:flex">
                    {(["50", "70", "100"] as const).map((size) => (
                      <button
                        key={size}
                        type="button"
                        onClick={() => setDrawerSize(size)}
                        className={[
                          "rounded-full px-3 py-1 text-xs",
                          drawerSize === size
                            ? "bg-slate-900 text-white"
                            : "text-slate-600 hover:bg-white",
                        ].join(" ")}
                        title={size === "50" ? "50%" : size === "70" ? "70%" : "全屏"}
                      >
                        {size === "100" ? "全屏" : `${size}%`}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={closeDrawer}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    aria-label="关闭"
                    title="关闭"
                  >
                    ×
                  </button>
                </div>
              </div>

              <div className="border-b border-slate-200 px-5 py-3">
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      { key: "images", label: "图片处理" },
                      { key: "info", label: "商品信息" },
                      { key: "defaults", label: "上架默认值" },
                      { key: "raw", label: "原始采集" },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setDrawerTab(tab.key)}
                      className={[
                        "rounded-full border px-4 py-2 text-sm",
                        drawerTab === tab.key
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                      ].join(" ")}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 overflow-auto p-5">
                {drawerError ? (
                  <div className="rounded-[18px] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                    {drawerError}
                  </div>
                ) : drawerLoading ? (
                  <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                    正在加载…
                  </div>
                ) : (
                  <DrawerTabContent
                    tab={drawerTab}
                    task={taskDetail}
                    raw={rawDetail}
                    timeline={activeTaskId ? timelineMap[activeTaskId] || null : null}
                    onRefresh={activeTaskId ? () => loadWorkbenchDetail(activeTaskId) : undefined}
                  />
                )}
              </div>
            </div>
          </aside>
        </div>
      ) : null}
      <PromptEditorModal config={promptEditor} onClose={() => setPromptEditor(null)} />
    </div>
  );
}

function slotLabel(slot: string): string {
  const map: Record<string, string> = {
    carousel_4grid: "四宫格母图",
    carousel_1: "轮播 1（主图）",
    carousel_2: "轮播 2（细节）",
    carousel_3: "轮播 3（场景）",
    carousel_4: "轮播 4（卖点）",
    carousel_5: "轮播 5（附加）",
    carousel_6: "轮播 6（附加）",
    carousel_7: "轮播 7（附加）",
    carousel_8: "轮播 8（附加）",
    preview_1: "预览 1",
    preview_2: "预览 2",
    preview_3: "预览 3",
    main: "主图",
    sku_image: "SKU 图",
    size_chart: "尺寸图",
  };
  return map[slot] || slot;
}

type ImageViewTab = "layout" | "pool" | "size";

type LightboxImage = {
  src: string;
  alt: string;
  caption?: string;
};

type PoolCandidate = {
  src: string;
  label: string;
  source: string;
  assetId?: number;
};

function ImagesTab({ task, raw }: { task: ProductTaskDetail; raw: RawProductDetail | null }) {
  const [assets, setAssets] = useState<AssetsBySlotResponse>({});
  const [loading, setLoading] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [dimensionJson, setDimensionJson] = useState<Record<string, unknown> | null>(null);
  const [activeView, setActiveView] = useState<ImageViewTab>("layout");
  const [lightbox, setLightbox] = useState<LightboxImage | null>(null);
  const [selectedTargetSlot, setSelectedTargetSlot] = useState<string>("carousel_1");
  const [assigning, setAssigning] = useState(false);
  const [draggedSlot, setDraggedSlot] = useState<string | null>(null);
  const [draggedCandidate, setDraggedCandidate] = useState<PoolCandidate | null>(null);

  async function readErrorDetail(res: Response): Promise<string> {
    try {
      const body = (await res.json()) as { detail?: string | { message?: string } };
      if (typeof body?.detail === "string" && body.detail.trim()) return body.detail;
      if (body?.detail && typeof body.detail === "object" && typeof body.detail.message === "string") {
        return body.detail.message;
      }
    } catch {
      // ignore parse errors and fallback to HTTP code below
    }
    return `HTTP ${res.status}`;
  }

  async function loadAssets(): Promise<void> {
    setLoading(true);
    setOpError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/product-tasks/${task.id}/assets`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as AssetsBySlotResponse;
      setAssets(data || {});
    } catch (err) {
      setOpError(err instanceof Error ? err.message : "加载图片资产失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAssets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  async function pollJob(jobId: number): Promise<void> {
    setJobStatus(`job ${jobId}: queued`);
    for (let i = 0; i < 60; i += 1) {
      await new Promise((r) => setTimeout(r, 1000));
      const res = await fetch(`${apiBaseUrl}/api/jobs/${jobId}`, { cache: "no-store" });
      if (!res.ok) break;
      const job = (await res.json()) as { status: string; progress: number; error_message?: string | null };
      setJobStatus(
        `job ${jobId}: ${job.status} (${job.progress}%)${job.error_message ? ` - ${job.error_message}` : ""}`,
      );
      if (job.status === "success" || job.status === "failed") break;
    }
    await loadAssets();
  }

  async function generateCarousel4Grid(): Promise<void> {
    setOpError(null);
    setJobStatus(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/product-tasks/${task.id}/generate-images`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ job_type: "carousel_4grid" }),
      });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      const data = (await res.json()) as { job_ids: number[] };
      const jobId = data.job_ids?.[0];
      if (jobId) void pollJob(jobId);
    } catch (err) {
      setOpError(err instanceof Error ? err.message : "生成失败");
    }
  }

  async function generateSingle(slot: string): Promise<void> {
    setOpError(null);
    setJobStatus(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/product-tasks/${task.id}/generate-image`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slot }),
      });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      const data = (await res.json()) as { job_id: number };
      if (data.job_id) void pollJob(data.job_id);
    } catch (err) {
      setOpError(err instanceof Error ? err.message : "生成失败");
    }
  }

  async function setFinal(assetId: number): Promise<void> {
    setOpError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/assets/${assetId}/set-final`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadAssets();
    } catch (err) {
      setOpError(err instanceof Error ? err.message : "设置最终图失败");
    }
  }

  async function regenerate(assetId: number): Promise<void> {
    setOpError(null);
    setJobStatus(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/assets/${assetId}/regenerate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      const data = (await res.json()) as { job_id: number };
      if (data.job_id) void pollJob(data.job_id);
    } catch (err) {
      setOpError(err instanceof Error ? err.message : "重生成失败");
    }
  }

  async function runDimensionExtract(assetId: number): Promise<void> {
    setOpError(null);
    setDimensionJson(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/product-tasks/${task.id}/dimension-extract`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ asset_id: assetId }),
      });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      const data = (await res.json()) as { result: Record<string, unknown> };
      setDimensionJson(data.result || null);
    } catch (err) {
      setOpError(err instanceof Error ? err.message : "尺寸识别失败");
    }
  }

  const carouselSlots = ["carousel_1", "carousel_2", "carousel_3", "carousel_4"] as const;
  const extraCarouselSlots = ["carousel_5", "carousel_6", "carousel_7", "carousel_8"] as const;
  const supportSlots = ["sku_image", "size_chart"] as const;
  const assignableSlots = [...carouselSlots, ...extraCarouselSlots, ...supportSlots] as const;
  const selectedCarouselAssets = carouselSlots
    .map((slot) => ({ slot, asset: assets[slot]?.find((item) => item.selected_for_export) || assets[slot]?.[0] || null }))
    .filter((item) => item.asset?.public_url);
  const selectedExtraCarouselAssets = extraCarouselSlots
    .map((slot) => ({ slot, asset: assets[slot]?.find((item) => item.selected_for_export) || assets[slot]?.[0] || null }))
    .filter((item) => item.asset?.public_url);
  const carouselExportValue = [...selectedCarouselAssets, ...selectedExtraCarouselAssets]
    .map((item) => item.asset?.public_url)
    .filter(Boolean)
    .join(",");
  const allAssets = Object.values(assets).flat();
  const rawCandidates: PoolCandidate[] = [
    ...(raw?.main_image ? [{ src: raw.main_image, label: "原始主图", source: "raw" }] : []),
    ...(raw?.carousel_images || []).map((src, index) => ({ src, label: `原始轮播 ${index + 1}`, source: "raw" })),
    ...(raw?.detail_images || []).map((src, index) => ({ src, label: `详情图 ${index + 1}`, source: "raw" })),
    ...(raw?.sku_images || []).map((src, index) => ({ src, label: `SKU 图 ${index + 1}`, source: "raw" })),
    ...(raw?.size_chart_images || []).map((src, index) => ({ src, label: `尺寸图 ${index + 1}`, source: "raw" })),
    ...((raw?.screenshot_url ? [raw.screenshot_url] : task.screenshot_url ? [task.screenshot_url] : []).map((src, index) => ({
      src,
      label: `页面截图 ${index + 1}`,
      source: "raw",
    }))),
  ];
  const aiCandidates: PoolCandidate[] = allAssets
    .filter((asset) => asset.public_url)
    .map((asset) => ({
      src: asset.public_url as string,
      label: `${slotLabel(asset.slot)} · v${asset.version}`,
      source: "ai",
      assetId: asset.id,
    }));

  async function assignCandidateToSlot(payload: {
    targetSlot: string;
    sourceAssetId?: number;
    sourceUrl?: string;
    imageDataUrl?: string;
  }): Promise<void> {
    setAssigning(true);
    setOpError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/product-tasks/${task.id}/assign-image`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target_slot: payload.targetSlot,
          source_asset_id: payload.sourceAssetId,
          source_url: payload.sourceUrl,
          image_data_url: payload.imageDataUrl,
          mark_as_final: true,
        }),
      });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      await loadAssets();
      setJobStatus(`已把图片放入 ${slotLabel(payload.targetSlot)}。`);
    } catch (err) {
      setOpError(err instanceof Error ? err.message : "放入图片失败");
    } finally {
      setAssigning(false);
    }
  }

  async function handleUploadToSelectedSlot(file: File): Promise<void> {
    const reader = new FileReader();
    reader.onload = async () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result) return;
      await assignCandidateToSlot({ targetSlot: selectedTargetSlot, imageDataUrl: result });
    };
    reader.readAsDataURL(file);
  }

  async function uploadToSlot(slot: string, file: File): Promise<void> {
    setSelectedTargetSlot(slot);
    const reader = new FileReader();
    reader.onload = async () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result) return;
      await assignCandidateToSlot({ targetSlot: slot, imageDataUrl: result });
    };
    reader.readAsDataURL(file);
  }

  async function reorderSlots(sourceSlot: string, targetSlot: string): Promise<void> {
    if (!sourceSlot || !targetSlot || sourceSlot === targetSlot) return;
    setAssigning(true);
    setOpError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/product-tasks/${task.id}/reorder-slots`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source_slot: sourceSlot, target_slot: targetSlot }),
      });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      await loadAssets();
      setJobStatus(`已调整 ${slotLabel(sourceSlot)} 和 ${slotLabel(targetSlot)} 的位置。`);
    } catch (err) {
      setOpError(err instanceof Error ? err.message : "调整位置失败");
    } finally {
      setAssigning(false);
      setDraggedSlot(null);
    }
  }

  return (
    <div className="space-y-4">
      {opError ? (
        <div className="rounded-[18px] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {opError}
        </div>
      ) : null}
      {jobStatus ? (
        <div className="rounded-[18px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {jobStatus}
        </div>
      ) : null}

      <Section title="图片工作区">
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard label="当前轮播位" value={slotLabel(selectedTargetSlot)} hint="素材池将把图片放到这里" />
          <MetricCard label="生成资产数量" value={String(allAssets.length)} hint="AI图、四宫格切图、尺寸资产" />
          <MetricCard
            label="已设最终图"
            value={String(allAssets.filter((asset) => asset.selected_for_export).length)}
            hint="已确认用于导出"
          />
          <MetricCard
            label="当前视图"
            value={
              activeView === "layout" ? "轮播编排" : activeView === "pool" ? "素材池" : "尺寸"
            }
            hint="围绕选图、入槽、排序来处理"
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {(
            [
              { key: "layout", label: "轮播编排", desc: "按位置放图和重生" },
              { key: "pool", label: "素材池", desc: "从原图 / AI 图 / 上传图选图" },
              { key: "size", label: "尺寸图", desc: "尺寸识别与结果" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveView(tab.key)}
              className={[
                "rounded-2xl border px-4 py-3 text-left",
                activeView === tab.key
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-white",
              ].join(" ")}
            >
              <div className="text-sm font-medium">{tab.label}</div>
              <div className={["mt-1 text-xs", activeView === tab.key ? "text-slate-300" : "text-slate-500"].join(" ")}>
                {tab.desc}
              </div>
            </button>
          ))}
        </div>
      </Section>

      {activeView === "layout" ? (
        <Section title="轮播编排">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={generateCarousel4Grid}
              className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800"
            >
              生成四宫格轮播图
            </button>
            {assignableSlots.map((slot) => (
              <button
                key={slot}
                type="button"
                onClick={() => setSelectedTargetSlot(slot)}
                className={[
                  "rounded-full border px-4 py-2 text-sm",
                  selectedTargetSlot === slot
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                ].join(" ")}
              >
                目标位置：{slotLabel(slot)}
              </button>
            ))}
            <button
              type="button"
              onClick={loadAssets}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              刷新
            </button>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1.2fr_0.9fr_1.1fr]">
            <div className="grid gap-3">
              {carouselSlots.slice(0, 2).map((slot) => (
                <CompactSlotCard
                  key={slot}
                  slot={slot}
                  assets={assets[slot] || []}
                  onSetFinal={setFinal}
                  onRegenerate={regenerate}
                  onGenerateSingle={generateSingle}
                  onSelectSlot={setSelectedTargetSlot}
                  selected={selectedTargetSlot === slot}
                  dragged={draggedSlot === slot}
                  onDragStart={setDraggedSlot}
                  onReorder={reorderSlots}
                  onOpenPoolForSlot={(slot) => {
                    setSelectedTargetSlot(slot);
                    setActiveView("pool");
                  }}
                  onUploadToSlot={uploadToSlot}
                  allowGenerate
                  onAssignCandidate={(candidate) =>
                    assignCandidateToSlot({
                      targetSlot: slot,
                      sourceAssetId: candidate.assetId,
                      sourceUrl: candidate.assetId ? undefined : candidate.src,
                    })
                  }
                  draggedCandidate={draggedCandidate}
                  onCandidateDragStateChange={setDraggedCandidate}
                  onPreview={(src, caption) => setLightbox({ src, alt: caption, caption })}
                />
              ))}
            </div>

            <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">四宫格母图</div>
                  <div className="mt-1 text-xs text-slate-500">中间保留一张母图，用来核对切图来源和整体画面。</div>
                </div>
                <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
                  {assets.carousel_4grid?.length || 0} 张
                </div>
              </div>
              {(assets.carousel_4grid || []).length ? (
                <div className="mt-4 space-y-3">
                  {(assets.carousel_4grid || []).slice(0, 1).map((asset) => (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() =>
                        asset.public_url &&
                        setLightbox({
                          src: asset.public_url,
                          alt: "四宫格母图",
                          caption: `四宫格母图 v${asset.version}`,
                        })
                      }
                      className="block w-full rounded-[16px] border border-slate-200 bg-white p-2"
                    >
                      <HoverZoomImage
                        src={asset.public_url || ""}
                        alt="四宫格母图"
                        thumbClassName="h-72 w-full rounded-[12px] object-contain bg-slate-50"
                      />
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={generateCarousel4Grid}
                    className="w-full rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800"
                  >
                    重生成四宫格母图
                  </button>
                </div>
              ) : (
                <div className="mt-4 flex h-72 items-center justify-center rounded-[16px] border border-dashed border-slate-200 bg-white text-sm text-slate-500">
                  暂无四宫格母图
                </div>
              )}
            </div>

            <div className="grid gap-3">
              {carouselSlots.slice(2, 4).map((slot) => (
                <CompactSlotCard
                  key={slot}
                  slot={slot}
                  assets={assets[slot] || []}
                  onSetFinal={setFinal}
                  onRegenerate={regenerate}
                  onGenerateSingle={generateSingle}
                  onSelectSlot={setSelectedTargetSlot}
                  selected={selectedTargetSlot === slot}
                  dragged={draggedSlot === slot}
                  onDragStart={setDraggedSlot}
                  onReorder={reorderSlots}
                  onOpenPoolForSlot={(slot) => {
                    setSelectedTargetSlot(slot);
                    setActiveView("pool");
                  }}
                  onUploadToSlot={uploadToSlot}
                  allowGenerate
                  onAssignCandidate={(candidate) =>
                    assignCandidateToSlot({
                      targetSlot: slot,
                      sourceAssetId: candidate.assetId,
                      sourceUrl: candidate.assetId ? undefined : candidate.src,
                    })
                  }
                  draggedCandidate={draggedCandidate}
                  onCandidateDragStateChange={setDraggedCandidate}
                  onPreview={(src, caption) => setLightbox({ src, alt: caption, caption })}
                />
              ))}
            </div>
          </div>

            <div className="mt-4 rounded-[18px] border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">主图轮播图字段</div>
                <div className="mt-1 text-xs text-slate-500">
                  默认同步当前 `轮播1~4` 位置的最终图。你在上面换图、拖拽、补图后，这里会一起变化，导出时可直接作为产品轮播图字段。
                </div>
              </div>
              <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
                当前 {selectedCarouselAssets.length + selectedExtraCarouselAssets.length} 张
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-4">
              {[...carouselSlots, ...extraCarouselSlots].map((slot) => {
                const asset = assets[slot]?.find((item) => item.selected_for_export) || assets[slot]?.[0] || null;
                return (
                  <div key={`export-${slot}`} className="rounded-[16px] border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs font-medium text-slate-700">{slotLabel(slot)}</div>
                    {asset?.public_url ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setLightbox({ src: asset.public_url || "", alt: slotLabel(slot), caption: `${slotLabel(slot)} · 导出采用图` })}
                          className="mt-2 block w-full"
                        >
                          <HoverZoomImage
                            src={asset.public_url}
                            alt={slotLabel(slot)}
                            thumbClassName="h-28 w-full rounded-[12px] bg-white object-contain"
                          />
                        </button>
                        <div className="mt-2 text-[11px] text-slate-500">{asset.source_type} / v{asset.version}</div>
                      </>
                    ) : (
                      <div className="mt-2 flex h-28 items-center justify-center rounded-[12px] border border-dashed border-slate-200 bg-white text-xs text-slate-400">
                        未放图
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-4 rounded-[14px] border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">导出字段预览值</div>
              <div className="mt-2 break-all text-xs text-slate-700">
                {carouselExportValue || "当前还没有可导出的轮播图 URL"}
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-[18px] border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">附加轮播图位</div>
                <div className="mt-1 text-xs text-slate-500">
                  这里用于继续补更多主图轮播图。`5~8` 不参与四宫格生成，但会进入最终导出的轮播图字段。
                </div>
              </div>
              <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
                已补 {selectedExtraCarouselAssets.length} 张
              </div>
            </div>
            <div className="mt-4 grid gap-3 xl:grid-cols-2">
              {extraCarouselSlots.map((slot) => (
                <CompactSlotCard
                  key={slot}
                  slot={slot}
                  assets={assets[slot] || []}
                  onSetFinal={setFinal}
                  onRegenerate={regenerate}
                  onGenerateSingle={generateSingle}
                  onSelectSlot={setSelectedTargetSlot}
                  selected={selectedTargetSlot === slot}
                  dragged={draggedSlot === slot}
                  onDragStart={setDraggedSlot}
                  onReorder={reorderSlots}
                  onOpenPoolForSlot={(nextSlot) => {
                    setSelectedTargetSlot(nextSlot);
                    setActiveView("pool");
                  }}
                  onUploadToSlot={uploadToSlot}
                  allowGenerate={false}
                  onAssignCandidate={(candidate) =>
                    assignCandidateToSlot({
                      targetSlot: slot,
                      sourceAssetId: candidate.assetId,
                      sourceUrl: candidate.assetId ? undefined : candidate.src,
                    })
                  }
                  draggedCandidate={draggedCandidate}
                  onCandidateDragStateChange={setDraggedCandidate}
                  onPreview={(src, caption) => setLightbox({ src, alt: caption, caption })}
                />
              ))}
            </div>
          </div>

          <div className="mt-4 grid gap-3 xl:grid-cols-2">
            {supportSlots.map((slot) => (
              <CompactSlotCard
                key={slot}
                slot={slot}
                assets={assets[slot] || []}
                onSetFinal={setFinal}
                onRegenerate={regenerate}
                onGenerateSingle={generateSingle}
                onSelectSlot={setSelectedTargetSlot}
                selected={selectedTargetSlot === slot}
                dragged={draggedSlot === slot}
                onDragStart={setDraggedSlot}
                onReorder={reorderSlots}
                onOpenPoolForSlot={(slot) => {
                  setSelectedTargetSlot(slot);
                  setActiveView("pool");
                }}
                onUploadToSlot={uploadToSlot}
                allowGenerate
                onAssignCandidate={(candidate) =>
                  assignCandidateToSlot({
                    targetSlot: slot,
                    sourceAssetId: candidate.assetId,
                    sourceUrl: candidate.assetId ? undefined : candidate.src,
                  })
                }
                draggedCandidate={draggedCandidate}
                onCandidateDragStateChange={setDraggedCandidate}
                onPreview={(src, caption) => setLightbox({ src, alt: caption, caption })}
              />
            ))}
          </div>

        </Section>
      ) : null}

      {activeView === "pool" ? (
        <Section title="素材池">
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              当前放入位置：{slotLabel(selectedTargetSlot)}
            </div>
            <label className="inline-flex cursor-pointer items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
              本地上传
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleUploadToSelectedSlot(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            {assigning ? <span className="text-xs text-slate-500">正在放图...</span> : null}
          </div>

          <div className="mt-4">
            <CandidatePoolSection
              title="原始采集素材"
              description="从原始主图、轮播图、详情图、SKU 图、尺寸图、页面截图里选一张塞进当前目标位"
              items={rawCandidates}
              onAssign={(item) => void assignCandidateToSlot({ targetSlot: selectedTargetSlot, sourceUrl: item.src })}
              onPreview={(src, caption) => setLightbox({ src, alt: caption, caption })}
              onDragStateChange={setDraggedCandidate}
            />
          </div>

          <div className="mt-4">
            <CandidatePoolSection
              title="AI 生成素材"
              description="从已经生成过的四宫格切图、预览图、尺寸资产里挑图放到当前目标位"
              items={aiCandidates}
              onAssign={(item) =>
                void assignCandidateToSlot({
                  targetSlot: selectedTargetSlot,
                  sourceAssetId: item.assetId,
                })
              }
              onPreview={(src, caption) => setLightbox({ src, alt: caption, caption })}
              onDragStateChange={setDraggedCandidate}
            />
          </div>
        </Section>
      ) : null}

      {activeView === "size" ? (
        <>
          <Section title="尺寸识别工作区">
            <div className="text-sm text-slate-600">
              先从原始尺寸图或生成图里挑一张更清晰的图，再执行尺寸识别。识别结果会显示在下方 JSON 区。
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {allAssets.slice(0, 12).map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => runDimensionExtract(asset.id)}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  识别：{slotLabel(asset.slot)} v{asset.version}
                </button>
              ))}
            </div>
            <div className="mt-4">
              <pre className="max-h-[360px] overflow-auto rounded-[14px] border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                {dimensionJson ? JSON.stringify(dimensionJson, null, 2) : "暂无尺寸识别结果"}
              </pre>
            </div>
          </Section>

          <Section title="尺寸相关参考图">
            <ImageGallerySection
              title="采集尺寸图"
              description="优先使用采集的尺寸图进行人工核对"
              images={raw?.size_chart_images || []}
              onPreview={(src, index) =>
                setLightbox({
                  src,
                  alt: `size-chart-${index + 1}`,
                  caption: `采集尺寸图 · 第 ${index + 1} 张`,
                })
              }
            />
          </Section>
        </>
      ) : null}

      {loading ? (
        <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          正在加载图片资产…
        </div>
      ) : null}

      <ImageLightbox image={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}

function CompactSlotCard({
  slot,
  assets,
  onSetFinal,
  onRegenerate,
  onGenerateSingle,
  onSelectSlot,
  selected,
  dragged,
  onDragStart,
  onReorder,
  onOpenPoolForSlot,
  onUploadToSlot,
  allowGenerate,
  onAssignCandidate,
  draggedCandidate,
  onCandidateDragStateChange,
  onPreview,
}: {
  slot: string;
  assets: ProductAsset[];
  onSetFinal: (assetId: number) => Promise<void>;
  onRegenerate: (assetId: number) => Promise<void>;
  onGenerateSingle: (slot: string) => Promise<void>;
  onSelectSlot: (slot: string) => void;
  selected: boolean;
  dragged: boolean;
  onDragStart: (slot: string | null) => void;
  onReorder: (sourceSlot: string, targetSlot: string) => Promise<void>;
  onOpenPoolForSlot: (slot: string) => void;
  onUploadToSlot: (slot: string, file: File) => Promise<void>;
  allowGenerate: boolean;
  onAssignCandidate: (candidate: PoolCandidate) => Promise<void>;
  draggedCandidate: PoolCandidate | null;
  onCandidateDragStateChange: (candidate: PoolCandidate | null) => void;
  onPreview: (src: string, caption: string) => void;
}) {
  const finalAsset = assets.find((a) => a.selected_for_export) || assets[0] || null;

  return (
    <div
      draggable={Boolean(finalAsset)}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", slot);
        onDragStart(slot);
      }}
      onDragEnd={() => onDragStart(null)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        if (draggedCandidate) {
          void onAssignCandidate(draggedCandidate);
          onCandidateDragStateChange(null);
          return;
        }
        void onReorder((event.dataTransfer.getData("text/plain") || slot).trim(), slot);
      }}
      className={[
        "rounded-[18px] border p-4 transition",
        selected ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white",
        dragged ? "opacity-60" : "",
        draggedCandidate ? "ring-2 ring-sky-200" : "",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">{slotLabel(slot)}</div>
          <div className="mt-1 text-xs text-slate-500">{assets.length ? `候选 ${assets.length} 张` : "暂无图片"}</div>
        </div>
        <button
          type="button"
          onClick={() => onSelectSlot(slot)}
          className={[
            "rounded-full px-3 py-1 text-xs",
            selected ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
          ].join(" ")}
        >
          {selected ? "当前目标位" : "设为目标位"}
        </button>
      </div>

      <div className="mt-3 flex items-center gap-3">
        {finalAsset?.public_url ? (
          <button type="button" onClick={() => onPreview(finalAsset.public_url || "", `${slotLabel(slot)} · v${finalAsset.version}`)}>
            <HoverZoomImage
              src={finalAsset.public_url}
              alt={slotLabel(slot)}
              thumbClassName="h-24 w-24 rounded-[14px] border border-slate-200 bg-white p-1 object-contain"
            />
          </button>
        ) : (
          <div className="flex h-24 w-24 items-center justify-center rounded-[14px] border border-dashed border-slate-200 bg-white text-xs text-slate-400">
            暂无
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-2">
          <div className="text-xs text-slate-600">
            当前采用：
            {finalAsset ? `${finalAsset.source_type} / v${finalAsset.version}` : "未设置"}
          </div>
          <div className="text-[11px] text-slate-500">支持槽位拖拽换位，也可以把素材池图片直接拖到这里入槽。</div>
          <div className="flex flex-wrap gap-2">
            {finalAsset ? (
              <>
                <button
                  type="button"
                  onClick={() => void onSetFinal(finalAsset.id)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                >
                  设为最终
                </button>
                <button
                  type="button"
                  onClick={() => void onRegenerate(finalAsset.id)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                >
                  重生成
                </button>
                <button
                  type="button"
                  onClick={() => onSelectSlot(slot)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                >
                  选中位置
                </button>
              </>
            ) : null}
            <button
              type="button"
              onClick={() => onOpenPoolForSlot(slot)}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
            >
              选其他图片
            </button>
            <label className="inline-flex cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50">
              本地上传
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void onUploadToSlot(slot, file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            {allowGenerate ? (
              <button
                type="button"
                onClick={() => void onGenerateSingle(slot)}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
              >
                AI 生一张
              </button>
            ) : (
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-500">
                仅支持手动补图
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CandidatePoolSection({
  title,
  description,
  items,
  onAssign,
  onPreview,
  onDragStateChange,
}: {
  title: string;
  description: string;
  items: PoolCandidate[];
  onAssign: (item: PoolCandidate) => void;
  onPreview: (src: string, caption: string) => void;
  onDragStateChange: (candidate: PoolCandidate | null) => void;
}) {
  return (
    <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          <div className="mt-1 text-xs text-slate-500">{description}</div>
        </div>
        <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
          {items.length} 张
        </div>
      </div>
      {items.length ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {items.map((item, index) => (
            <div
              key={`${item.label}-${index}-${item.src}`}
              draggable
              onDragStart={() => onDragStateChange(item)}
              onDragEnd={() => onDragStateChange(null)}
              className="rounded-[16px] border border-slate-200 bg-white p-2"
            >
              <button type="button" onClick={() => onPreview(item.src, item.label)} className="block w-full">
                <HoverZoomImage
                  src={item.src}
                  alt={item.label}
                  thumbClassName="h-32 w-full rounded-[12px] bg-slate-50 object-contain"
                />
              </button>
              <div className="mt-2 line-clamp-2 text-xs text-slate-600">{item.label}</div>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => onAssign(item)}
                  className="flex-1 rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-xs text-white hover:bg-slate-800"
                >
                  放到当前位置
                </button>
                <button
                  type="button"
                  onClick={() => onPreview(item.src, item.label)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                >
                  查看
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 text-sm text-slate-500">暂无可选素材</div>
      )}
    </div>
  );
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{hint}</div>
    </div>
  );
}

function ImageGallerySection({
  title,
  description,
  images,
  onPreview,
}: {
  title: string;
  description: string;
  images: string[];
  onPreview?: (src: string, index: number) => void;
}) {
  return (
    <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          <div className="mt-1 text-xs text-slate-500">{description}</div>
        </div>
        <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
          {images.length} 张
        </div>
      </div>
      {images.length ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {images.map((src, index) => (
            <button
              key={`${title}-${index}-${src}`}
              type="button"
              onClick={() => onPreview?.(src, index)}
              className="rounded-[16px] border border-slate-200 bg-white p-2 text-left transition hover:border-slate-300 hover:shadow-[0_12px_32px_rgba(15,23,42,0.08)]"
            >
              <HoverZoomImage
                src={src}
                alt={`${title}-${index + 1}`}
                thumbClassName="h-52 w-full rounded-[12px] object-contain bg-slate-50"
                previewWidth={420}
              />
              <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500">
                <span>{title} #{index + 1}</span>
                <span>{onPreview ? "点击查看" : "悬浮查看"}</span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-[14px] border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
          暂无图片
        </div>
      )}
    </div>
  );
}

function ImageLightbox({
  image,
  onClose,
}: {
  image: LightboxImage | null;
  onClose: () => void;
}) {
  if (!image) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/80 p-6" onClick={onClose}>
      <div
        className="relative max-h-[92vh] w-full max-w-6xl rounded-[24px] border border-slate-700 bg-slate-900 p-4 shadow-[0_30px_120px_rgba(0,0,0,0.45)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-white">{image.caption || image.alt}</div>
            <div className="mt-1 truncate text-xs text-slate-400">{image.src}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700"
          >
            ×
          </button>
        </div>
        <div className="flex max-h-[80vh] items-center justify-center overflow-auto rounded-[18px] bg-slate-950 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.src} alt={image.alt} className="max-h-[76vh] w-auto max-w-full object-contain" />
        </div>
      </div>
    </div>
  );
}

function PromptableHeader({
  label,
  onEditPrompt,
}: {
  label: string;
  onEditPrompt: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span>{label}</span>
      <button
        type="button"
        onClick={onEditPrompt}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 bg-white text-[11px] text-slate-600 hover:bg-slate-50"
        title={`编辑${label}提示词`}
      >
        提
      </button>
    </div>
  );
}

function ReviewBoard({
  items,
  rowMeta,
  timelineMap,
  onOpenDrawer,
}: {
  items: ProductTaskListItem[];
  rowMeta: Record<number, RowMeta>;
  timelineMap: Record<number, ProductTaskTimelineResponse>;
  onOpenDrawer: (taskId: number) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {items.length === 0 ? (
        <div className="rounded-[24px] border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          暂无任务数据
        </div>
      ) : (
        items.map((item) => {
          const meta = rowMeta[item.id];
          const detail = meta?.detail;
          const thumbnail = taskThumbnail(item, meta);
          const timeline = timelineMap[item.id];
          const summary = timeline?.summary;
          const recentEvents = timeline?.events.slice(-6).reverse() || [];
          const blocked = Boolean(
            summary?.last_error_message || summary?.exception_level === "blocking" || summary?.main_status === "failed",
          );
          const headline = summary?.current_step || statusText(item.main_status);

          return (
            <button key={item.id} type="button" onClick={() => onOpenDrawer(item.id)} className="text-left">
              <article className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_14px_50px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_20px_70px_rgba(15,23,42,0.08)]">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-xs text-slate-500">任务日志 · Task #{item.id}</div>
                    <div className="mt-2 line-clamp-2 text-base font-semibold text-slate-900">
                      {detail?.title || item.title}
                    </div>
                    <div className="mt-2 text-xs text-slate-500">
                      当前类目：{detail?.selected_category_id || detail?.ai?.category_best_path || "-"}
                    </div>
                  </div>
                  <div className="shrink-0">
                    {thumbnail ? (
                      <HoverZoomImage
                        src={thumbnail}
                        alt={item.title}
                        thumbClassName="h-20 w-20 rounded-2xl border border-slate-200 bg-white p-1 object-contain"
                      />
                    ) : (
                      <ThumbnailPlaceholder />
                    )}
                  </div>
                </div>

                <div className="mt-4 rounded-[16px] border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium text-slate-900">流程日志</div>
                    <span
                      className={[
                        "rounded-full border px-3 py-1",
                        blocked
                          ? "border-rose-200 bg-rose-50 text-rose-700"
                          : summary?.main_status === "review_ready" || summary?.main_status === "exported"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-amber-200 bg-amber-50 text-amber-800",
                      ].join(" ")}
                    >
                      {headline}
                    </span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {recentEvents.length ? (
                      recentEvents.map((event, index) => (
                        <div key={`${item.id}-${event.stage}-${index}`} className="grid grid-cols-[20px_1fr_auto] items-center gap-2">
                          <div
                            className={[
                              "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold",
                              event.status === "success"
                                ? "bg-emerald-100 text-emerald-700"
                                : event.status === "running" || event.status === "started" || event.status === "queued"
                                  ? "bg-amber-100 text-amber-800"
                                  : event.status === "failed" || event.status === "warning"
                                    ? "bg-rose-100 text-rose-700"
                                    : "bg-slate-200 text-slate-500",
                            ].join(" ")}
                          >
                            {index + 1}
                          </div>
                          <div className="min-w-0">
                            <div className="text-[12px] font-medium text-slate-800">{event.title}</div>
                            <div className="truncate text-[11px] text-slate-500">
                              {formatDateTime(event.ts)} · {event.message}
                            </div>
                          </div>
                          <div
                            className={[
                              "rounded-full border px-2 py-0.5 text-[10px]",
                              event.status === "success"
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : event.status === "running" || event.status === "started" || event.status === "queued"
                                  ? "border-amber-200 bg-amber-50 text-amber-800"
                                  : event.status === "failed" || event.status === "warning"
                                    ? "border-rose-200 bg-rose-50 text-rose-700"
                                    : "border-slate-200 bg-white text-slate-500",
                            ].join(" ")}
                          >
                            {statusText(event.status)}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-[14px] border border-dashed border-slate-200 bg-white p-3 text-[11px] text-slate-500">
                        日志加载中，或该任务还没有产生明细事件。
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2 text-xs text-slate-600">
                  <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-3">
                    <div className="text-[11px] text-slate-500">本次任务记录</div>
                    <div className="mt-1">创建：{formatDateTime(item.created_at)}</div>
                    <div className="mt-1">主状态：{statusText(summary?.main_status || item.main_status)}</div>
                    <div className="mt-1">图片状态：{statusText(summary?.image_status || item.image_status)}</div>
                    <div className="mt-1">导出状态：{statusText(summary?.export_status || item.export_status)}</div>
                  </div>
                  <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-3">
                    当前卡点：{headline}
                    <div className="mt-1">
                      {recentEvents[0]?.message ||
                        `类目 ${statusText(summary?.category_status || item.category_status)} / 标题 ${statusText(summary?.title_status || item.title_status)}`}
                    </div>
                  </div>
                  <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-3 sm:col-span-2">
                    下一步：
                    {summary?.main_status === "review_ready"
                      ? " 进入人工复核，检查标题、类目、主图轮播。"
                      : summary?.main_status === "failed" || blocked
                        ? " 先处理当前异常，再重试对应步骤。"
                        : summary?.main_status === "image_running"
                          ? " 等待图片任务完成，确认四宫格和轮播位。"
                          : " 等待下一步流程继续推进。"}
                    <div className="mt-1 line-clamp-2">报错：{summary?.last_error_message || item.last_error_message || "无"}</div>
                  </div>
                </div>
              </article>
            </button>
          );
        })
      )}
    </div>
  );
}

function WorkbenchTable({
  items,
  rowMeta,
  selectedIds,
  allSelected,
  onToggleSelect,
  onToggleSelectAll,
  quickTitleDrafts,
  quickCategoryDrafts,
  rowLoading,
  onQuickTitleChange,
  onQuickCategoryChange,
  onPickCandidate,
  onGenerateTitles,
  onSaveTitle,
  onSaveCategory,
  onGenerateFourGrid,
  onOpenDrawer,
  onDelete,
  onOpenPromptEditor,
}: {
  items: ProductTaskListItem[];
  rowMeta: Record<number, RowMeta>;
  selectedIds: number[];
  allSelected: boolean;
  onToggleSelect: (taskId: number) => void;
  onToggleSelectAll: () => void;
  quickTitleDrafts: Record<number, string>;
  quickCategoryDrafts: Record<number, string>;
  rowLoading: Record<number, string>;
  onQuickTitleChange: (taskId: number, value: string) => void;
  onQuickCategoryChange: (taskId: number, value: string) => void;
  onPickCandidate: (taskId: number, path: string) => void;
  onGenerateTitles: (taskId: number) => void;
  onSaveTitle: (taskId: number) => void;
  onSaveCategory: (taskId: number) => void;
  onGenerateFourGrid: (taskId: number) => void;
  onOpenDrawer: (taskId: number) => void;
  onDelete: (taskId: number) => void;
  onOpenPromptEditor: (fieldLabel: string, promptTypes: string[]) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-[24px] border border-slate-200 bg-white">
      <table className="min-w-full border-collapse text-left text-sm">
        <thead className="bg-slate-100 text-slate-600">
          <tr>
            <th className="px-4 py-3 font-medium">
              <input type="checkbox" checked={allSelected} onChange={onToggleSelectAll} />
            </th>
            <th className="px-4 py-3 font-medium">商品缩略图</th>
            <th className="px-4 py-3 font-medium">
              <PromptableHeader
                label="标题处理"
                onEditPrompt={() => onOpenPromptEditor("标题处理", ["product_info_from_screenshot", "title_package"])}
              />
            </th>
            <th className="px-4 py-3 font-medium">
              <PromptableHeader
                label="类目处理"
                onEditPrompt={() => onOpenPromptEditor("类目处理", ["product_info_from_screenshot"])}
              />
            </th>
            <th className="px-4 py-3 font-medium">
              <PromptableHeader
                label="SKU 图/字段"
                onEditPrompt={() => onOpenPromptEditor("SKU 图/字段", ["product_info_from_screenshot"])}
              />
            </th>
            <th className="px-4 py-3 font-medium">
              <PromptableHeader
                label="主图 / 四宫格"
                onEditPrompt={() => onOpenPromptEditor("主图 / 四宫格", ["title_package", "image_prompt_package", "image_prompt_carousel_4grid"])}
              />
            </th>
            <th className="px-4 py-3 font-medium">主图轮播图</th>
            <th className="px-4 py-3 font-medium">
              <PromptableHeader
                label="尺寸图"
                onEditPrompt={() => onOpenPromptEditor("尺寸图", ["dimension_extract_from_image", "image_prompt_dimension"])}
              />
            </th>
            <th className="px-4 py-3 font-medium">原图/AI图</th>
            <th className="px-4 py-3 font-medium">处理结果</th>
            <th className="px-4 py-3 font-medium">来源/图片/采集</th>
            <th className="px-4 py-3 font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={12} className="px-4 py-8 text-center text-slate-500">
                暂无任务数据
              </td>
            </tr>
          ) : (
            items.map((item) => {
              const meta = rowMeta[item.id];
              const detail = meta?.detail || null;
              const rowAction = rowLoading[item.id] || "";
              const thumbnail = taskThumbnail(item, meta);
              const fourGridSlots = ["carousel_1", "carousel_2", "carousel_3", "carousel_4"].map((slot) => selectedSlotAsset(meta?.assets, slot));
              const fourGridAssetCount =
                (meta?.assets?.carousel_1?.length || 0) +
                (meta?.assets?.carousel_2?.length || 0) +
                (meta?.assets?.carousel_3?.length || 0) +
                (meta?.assets?.carousel_4?.length || 0);
              const fourGridParentCount = meta?.assets?.carousel_4grid?.length || 0;
              const hasFourGrid = fourGridSlots.some(Boolean);
              const fourGridParent = selectedSlotAsset(meta?.assets, "carousel_4grid");
              const sizeChartAsset = latestAsset(meta?.assets?.size_chart);
              const sizeAssetCount = meta?.assets?.size_chart?.length || 0;
              const sizeRawCount = meta?.raw?.size_chart_images?.length || 0;
              const skuImages = meta?.raw?.sku_images || [];
              const sizeChartThumb = sizeChartAsset?.public_url || meta?.raw?.size_chart_images?.[0] || null;
              const sizeChartStatus = sizeChartAsset?.selected_for_export
                ? "已确认"
                : sizeChartAsset
                  ? "需确认"
                  : meta?.raw?.size_chart_images?.length
                    ? "待识别"
                    : "未上传";
              const rawMainCount = meta?.raw?.main_image ? 1 : 0;
              const rawCarouselCount = meta?.raw?.carousel_images?.length || 0;
              const rawSkuCount = meta?.raw?.sku_images?.length || 0;
              const rawDetailCount = meta?.raw?.detail_images?.length || 0;
              const rawScreenshotCount = meta?.raw?.screenshot_url || item.screenshot_url ? 1 : 0;
              const rawImageTotal =
                rawMainCount + rawCarouselCount + rawSkuCount + rawDetailCount + sizeRawCount + rawScreenshotCount;
              const aiImageTotal = Object.values(meta?.assets || {}).reduce((total, assets) => total + assets.length, 0);
              const collectTime = meta?.raw?.created_at || item.created_at;
              const exceptionTone =
                item.exception_level === "blocking" || item.exception_level === "failed"
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : "border-amber-200 bg-amber-50 text-amber-700";
              const exceptionLabel = item.exception_level
                ? item.exception_level === "blocking"
                  ? "阻塞"
                  : item.exception_level === "failed"
                    ? "失败"
                    : "警告"
                : null;
              const aiTitleText = detail?.ai?.title_cn ? detail.ai.title_cn : item.main_status === "ai_running" ? "AI 处理中" : "待生成";
              const aiCategoryText = detail?.ai?.category_best_path || item.selected_category_id || "";
              const quickTitle = quickTitleDrafts[item.id] ?? detail?.title ?? item.title;
              const quickCategory = quickCategoryDrafts[item.id] ?? detail?.selected_category_id ?? detail?.ai?.category_best_path ?? "";

              return (
                <tr key={item.id} className="border-t border-slate-200 align-top">
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => onToggleSelect(item.id)} />
                  </td>
                  <td className="px-4 py-3">
                    {thumbnail ? (
                      <HoverZoomImage
                        src={thumbnail}
                        alt={item.title}
                        thumbClassName="h-20 w-20 rounded-2xl border border-slate-200 bg-white p-1 object-contain"
                      />
                    ) : (
                      <ThumbnailPlaceholder label="暂无图片" />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="w-[280px] space-y-2">
                      <div className="rounded-[12px] border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                        <div className="text-[11px] text-slate-500">原始标题</div>
                        <HoverTitleText value={meta?.raw?.title || item.title} />
                      </div>
                      <div className="rounded-[12px] border border-sky-200 bg-sky-50 p-3 text-xs text-slate-600">
                        <div className="text-[11px] text-slate-500">AI 标题</div>
                        <div className="mt-1 line-clamp-2 text-slate-800">{aiTitleText || "-"}</div>
                      </div>
                      <input
                        value={quickTitle}
                        onChange={(event) => onQuickTitleChange(item.id, event.target.value)}
                        className="h-10 w-full rounded-[12px] border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                        placeholder="最终导出标题"
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => onGenerateTitles(item.id)}
                          disabled={rowAction !== ""}
                          className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                        >
                          {rowAction === "gen-title" ? "生成中..." : "生成标题"}
                        </button>
                        <button
                          type="button"
                          onClick={() => onSaveTitle(item.id)}
                          disabled={rowAction !== ""}
                          className="rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-xs text-white hover:bg-slate-800"
                        >
                          {rowAction === "save-title" ? "保存中..." : "保存标题"}
                        </button>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="w-[250px] space-y-2">
                      <div className="rounded-[12px] border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
                        AI：{aiCategoryText || statusText(item.category_status)}
                      </div>
                      <input
                        value={quickCategory}
                        onChange={(event) => onQuickCategoryChange(item.id, event.target.value)}
                        className="h-10 w-full rounded-[12px] border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                        placeholder="最终导出类目"
                      />
                      <div className="flex flex-wrap gap-2">
                        {(detail?.ai?.category_top3 || []).slice(0, 3).map((candidate) => (
                          <button
                            key={`${item.id}-${candidate.path}`}
                            type="button"
                            onClick={() => onPickCandidate(item.id, candidate.path)}
                            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] text-slate-700 hover:bg-slate-50"
                          >
                            {candidate.path.split(">").slice(-1)[0]?.trim() || "候选"}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => onSaveCategory(item.id)}
                          disabled={rowAction !== ""}
                          className="rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-xs text-white hover:bg-slate-800"
                        >
                          {rowAction === "save-category" ? "保存中..." : "保存类目"}
                        </button>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {skuImages.length ? (
                      <div>
                        <div className="grid grid-cols-2 gap-1">
                          {skuImages.slice(0, 4).map((url, index) => (
                            <HoverZoomImage
                              key={`${item.id}-sku-${index + 1}`}
                              src={url}
                              alt={`SKU 图-${index + 1}`}
                              thumbClassName="h-12 w-12 rounded-lg border border-slate-200 bg-white p-1 object-contain"
                            />
                          ))}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] text-slate-600">
                            SKU 图 {skuImages.length} 张
                          </span>
                          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] text-slate-600">
                            SKU 字段 {item.platform_sku || meta?.raw?.platform_sku || item.source_id || "-"}
                          </span>
                          <button
                            type="button"
                            onClick={() => onOpenDrawer(item.id)}
                            className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                          >
                            换图
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2 text-xs text-slate-500">
                        <div>暂无 SKU 图</div>
                        <div>SKU 字段：{item.platform_sku || meta?.raw?.platform_sku || item.source_id || "-"}</div>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {hasFourGrid ? (
                      <div>
                        <TableFourGridCell parentAsset={fourGridParent} slotAssets={fourGridSlots} />
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] text-slate-600">
                            4 槽位 {fourGridSlots.filter(Boolean).length}/4
                          </span>
                          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] text-slate-600">
                            母图 {fourGridParentCount} 张
                          </span>
                          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] text-slate-600">
                            切图资产 {fourGridAssetCount} 张
                          </span>
                          <button
                            type="button"
                            onClick={() => onOpenDrawer(item.id)}
                            className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                          >
                            换图/排序
                          </button>
                          <button
                            type="button"
                            onClick={() => onGenerateFourGrid(item.id)}
                            className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                          >
                            重生成
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="text-xs text-slate-500">
                          {item.image_status === "running" || item.main_status === "image_running"
                            ? "生成中..."
                            : fourGridParentCount > 0
                              ? "母图已生成，切图待完成"
                              : "未生成"}
                        </div>
                        <button
                          type="button"
                          onClick={() => onGenerateFourGrid(item.id)}
                          className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                        >
                          生成四宫格
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <TableCarouselFieldCell assets={meta?.assets} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-2">
                      {sizeChartThumb ? (
                        <HoverZoomImage
                          src={sizeChartThumb}
                          alt="尺寸图"
                          thumbClassName="h-14 w-14 rounded-lg border border-slate-200 bg-white p-1 object-contain"
                        />
                      ) : (
                        <div className="text-xs text-slate-400">暂无尺寸图</div>
                      )}
                      <div className="inline-flex w-fit items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600">
                        {sizeChartStatus}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        原始尺寸图 {sizeRawCount} 张 / AI尺寸资产 {sizeAssetCount} 张
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-1 text-xs text-slate-600">
                      <div>原始图 {rawImageTotal} 张</div>
                      <div>AI 图 {aiImageTotal} 张</div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="max-w-[240px] space-y-2 text-xs">
                      <span
                        className={[
                          "inline-flex items-center rounded-full border px-2.5 py-1 font-medium",
                          statusBadgeColor(item.main_status),
                        ].join(" ")}
                      >
                        主状态：{statusText(item.main_status)}
                      </span>
                      <span
                        className={[
                          "ml-2 inline-flex items-center rounded-full border px-2.5 py-1 font-medium",
                          statusBadgeColor(item.export_status),
                        ].join(" ")}
                      >
                        导出：{statusText(item.export_status)}
                      </span>
                      {item.exception_level ? (
                        <>
                          <span className={["inline-flex items-center rounded-full border px-2 py-1", exceptionTone].join(" ")}>
                            异常：{exceptionLabel}
                            {item.exception_status ? ` / ${item.exception_status}` : ""}
                          </span>
                          <div className="text-slate-600">{item.last_error_message || "有异常待处理"}</div>
                        </>
                      ) : (
                        <div className="text-slate-400">无异常</div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    <div>平台：{item.product_platform || meta?.raw?.platform || "-"}</div>
                    <div className="mt-1">source_id：{item.source_id || meta?.raw?.source_id || "-"}</div>
                    <div className="mt-1">raw_id：{item.raw_product_id}</div>
                    <div className="mt-1">采集：{formatDateTime(collectTime)}</div>
                    <div className="mt-1">SKU图：{rawSkuCount} 张</div>
                    <div className="mt-1">尺寸图：{sizeChartStatus}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => onOpenDrawer(item.id)}
                        className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                      >
                        查看 / 修改
                      </button>
                      <button
                        type="button"
                        onClick={() => onGenerateFourGrid(item.id)}
                        disabled={rowAction !== ""}
                        className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                      >
                        {rowAction === "gen-4grid" ? "提交中..." : "生四宫格"}
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(item.id)}
                        disabled={rowAction !== ""}
                        className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-100"
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function TableFourGridCell({
  parentAsset,
  slotAssets,
}: {
  parentAsset: ProductAsset | null;
  slotAssets: Array<ProductAsset | null>;
}) {
  return (
    <div className="w-[180px] space-y-2">
      <div className="rounded-[12px] border border-amber-200 bg-amber-50 p-2">
        <div className="mb-1 text-center text-[10px] text-amber-700">四宫格母图</div>
        <div className="flex justify-center">
          <TableMiniImage asset={parentAsset} fallback="母图" highlight />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {slotAssets.map((asset, index) => (
          <div key={`slot-${index + 1}`} className="space-y-1">
            <div className="text-center text-[10px] text-slate-400">{index + 1}</div>
            <TableMiniImage asset={asset} fallback={String(index + 1)} />
          </div>
        ))}
      </div>
    </div>
  );
}

function TableCarouselFieldCell({ assets }: { assets: AssetsBySlotResponse | undefined }) {
  const carouselSlots = [
    "carousel_1",
    "carousel_2",
    "carousel_3",
    "carousel_4",
    "carousel_5",
    "carousel_6",
    "carousel_7",
    "carousel_8",
  ] as const;
  const exportAssets = carouselSlots
    .map((slot) => ({ slot, asset: selectedSlotAsset(assets, slot) }))
    .filter((item) => item.asset?.public_url);

  return (
    <div className="w-[180px] space-y-2">
      <div className="grid grid-cols-4 gap-1">
        {carouselSlots.map((slot, index) => (
          <div key={slot} className="space-y-1">
            <div className="text-center text-[10px] text-slate-400">{index + 1}</div>
            <TableMiniImage asset={selectedSlotAsset(assets, slot)} fallback={String(index + 1)} />
          </div>
        ))}
      </div>
      <div className="text-[11px] text-slate-500">当前导出 {exportAssets.length} 张，顺序按 1-8 轮播位。</div>
    </div>
  );
}

function TableMiniImage({
  asset,
  fallback,
  highlight = false,
}: {
  asset: ProductAsset | null;
  fallback: string;
  highlight?: boolean;
}) {
  if (!asset?.public_url) {
    return (
      <div
        className={[
          "flex h-12 w-12 items-center justify-center rounded-lg text-[10px]",
          highlight
            ? "border border-amber-200 bg-amber-50 text-amber-700"
            : "bg-slate-100 text-slate-400",
        ].join(" ")}
      >
        {fallback}
      </div>
    );
  }

  return (
    <HoverZoomImage
      src={asset.public_url}
      alt={fallback}
      thumbClassName={[
        "h-12 w-12 rounded-lg border bg-white p-1 object-contain",
        highlight ? "border-amber-300" : "border-slate-200",
      ].join(" ")}
    />
  );
}

function DrawerTabContent({
  tab,
  task,
  raw,
  timeline,
  onRefresh,
}: {
  tab: DrawerTab;
  task: ProductTaskDetail | null;
  raw: RawProductDetail | null;
  timeline: ProductTaskTimelineResponse | null;
  onRefresh?: (() => Promise<void>) | undefined;
}) {
  if (!task) {
    return (
      <div className="rounded-[18px] border border-slate-200 bg-white p-5 text-sm text-slate-600">
        未加载任务数据
      </div>
    );
  }

  if (tab === "info") {
    return <InfoTab task={task} raw={raw} timeline={timeline} onRefresh={onRefresh} />;
  }

  if (tab === "images") {
    return <ImagesTab task={task} raw={raw} />;
  }

  if (tab === "defaults") {
    return <DefaultsTab task={task} />;
  }

  return <RawDataTab task={task} raw={raw} />;
}

function CompareCard({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "raw" | "ai" | "final";
  items: { label: string; value: string }[];
}) {
  const toneClass =
    tone === "raw"
      ? "border-slate-200 bg-slate-50"
      : tone === "ai"
        ? "border-sky-200 bg-sky-50"
        : "border-emerald-200 bg-emerald-50";

  return (
    <div className={["rounded-[18px] border p-4", toneClass].join(" ")}>
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      <div className="mt-3 space-y-3">
        {items.map((item) => (
          <div key={`${title}-${item.label}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-slate-500">{item.label}</div>
              {item.value && item.value !== "-" ? (
                <button
                  type="button"
                  onClick={() => void copyText(item.value)}
                  className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
                >
                  复制
                </button>
              ) : null}
            </div>
            <div className="mt-1 whitespace-pre-wrap break-all text-sm text-slate-800">{item.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HoverTitleText({ value }: { value: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <div className="mt-1 flex items-start gap-2">
        <div className="line-clamp-2 flex-1 text-slate-800">{value || "-"}</div>
        {value ? (
          <button
            type="button"
            onClick={() => void copyText(value)}
            className="shrink-0 rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
          >
            复制
          </button>
        ) : null}
      </div>
      {open && value ? (
        <div className="absolute left-0 top-full z-30 mt-2 w-[420px] max-w-[70vw] rounded-[12px] border border-slate-200 bg-white p-3 shadow-[0_16px_42px_rgba(15,23,42,0.16)]">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] font-medium text-slate-500">完整原标题</div>
            <button
              type="button"
              onClick={() => void copyText(value)}
              className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
            >
              复制全文
            </button>
          </div>
          <div className="mt-2 whitespace-pre-wrap break-all text-xs text-slate-800 select-text">{value}</div>
        </div>
      ) : null}
    </div>
  );
}

function InfoTab({
  task,
  raw,
  timeline,
  onRefresh,
}: {
  task: ProductTaskDetail;
  raw: RawProductDetail | null;
  timeline: ProductTaskTimelineResponse | null;
  onRefresh?: (() => Promise<void>) | undefined;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualTitle, setManualTitle] = useState(task.title || "");
  const [manualCategory, setManualCategory] = useState(task.selected_category_id || task.ai?.category_best_path || "");

  useEffect(() => {
    setManualTitle(task.title || "");
    setManualCategory(task.selected_category_id || task.ai?.category_best_path || "");
  }, [task.id, task.title, task.selected_category_id, task.ai?.category_best_path]);

  async function refreshAfterMutation(): Promise<void> {
    if (onRefresh) {
      await onRefresh();
    }
  }

  async function runProductInfo(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/product-tasks/${task.id}/run-product-info`, {
        method: "POST",
        headers: buildAiRequestHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "触发商品理解失败");
    } finally {
      setLoading(false);
    }
  }

  async function regenerateTitles(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/product-tasks/${task.id}/generate-titles`, {
        method: "POST",
        headers: buildAiRequestHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "触发标题重生成失败");
    } finally {
      setLoading(false);
    }
  }

  async function selectCategory(path: string): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/product-tasks/${task.id}/select-category`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category_path: path }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await refreshAfterMutation();
    } catch (err) {
      setError(err instanceof Error ? err.message : "选择类目失败");
    } finally {
      setLoading(false);
    }
  }

  async function applyFieldChoice(fieldKey: string, selectedSource: "raw" | "ai" | "manual", manualValue?: string): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/product-tasks/${task.id}/field-choice`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          field_key: fieldKey,
          selected_source: selectedSource,
          manual_value: manualValue,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await refreshAfterMutation();
    } catch (err) {
      setError(err instanceof Error ? err.message : "应用字段选择失败");
    } finally {
      setLoading(false);
    }
  }

  const productInfoSummary = task.ai?.product_info as
    | {
        product_core?: Record<string, unknown>;
        category_search?: Record<string, unknown>;
        temu_category_search?: Record<string, unknown>;
        image_basis?: Record<string, unknown>;
      }
    | null
    | undefined;
  const categoryCandidates =
    task.ai?.category_candidates?.length ? task.ai.category_candidates : ((task.category_candidates_json as { path: string; score?: number | null }[]) || []);

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-[18px] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
      ) : null}

      <Section title="字段对照">
        <div className="grid gap-4 xl:grid-cols-3">
          <CompareCard
            title="原始采集"
            tone="raw"
            items={[
              { label: "标题", value: raw?.title || task.title || "-" },
              { label: "平台", value: raw?.platform || task.product_platform || "-" },
              { label: "SKU", value: raw?.platform_sku || raw?.source_id || task.platform_sku || "-" },
              { label: "价格", value: raw?.price || "-" },
              { label: "链接", value: raw?.url || task.source_url || "-" },
            ]}
          />
          <CompareCard
            title="AI 生成"
            tone="ai"
            items={[
              { label: "中文标题", value: task.ai?.title_cn || "-" },
              { label: "英文标题", value: task.ai?.title_en || "-" },
              { label: "建议类目", value: task.ai?.category_best_path || "-" },
              {
                label: "类目检索词",
                value:
                  String((productInfoSummary?.temu_category_search || {}).core_leaf_terms_cn || "") ||
                  String((productInfoSummary?.category_search || {}).core_leaf_term || "") ||
                  categoryCandidates.map((item) => item.path).join("\n") ||
                  "-",
              },
            ]}
          />
          <CompareCard
            title="当前采用"
            tone="final"
            items={[
              { label: "任务标题", value: task.title || "-" },
              { label: "采用类目", value: task.selected_category_id || task.ai?.category_best_path || "-" },
              { label: "主状态", value: statusText(task.main_status) },
              { label: "导出状态", value: statusText(task.export_status) },
              { label: "备注", value: task.notes || "-" },
            ]}
          />
        </div>
      </Section>

      <Section title="快捷操作">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void runProductInfo()}
            disabled={loading}
            className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
          >
            重跑商品理解
          </button>
          <button
            type="button"
            onClick={() => void regenerateTitles()}
            disabled={loading}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            重生成标题
          </button>
          {onRefresh ? (
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={loading}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              刷新详情
            </button>
          ) : null}
        </div>
      </Section>

      <Section title="类目候选">
        {categoryCandidates.length ? (
          <div className="space-y-3">
            {categoryCandidates.map((item) => {
              const active = (task.selected_category_id || task.ai?.category_best_path || "") === item.path;
              return (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => void selectCategory(item.path)}
                  disabled={loading}
                  className={[
                    "block w-full rounded-[16px] border px-4 py-3 text-left",
                    active
                      ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                      : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50",
                  ].join(" ")}
                >
                  <div className="text-sm font-medium">{item.path}</div>
                  <div className="mt-1 text-xs text-slate-500">检索分：{"score" in item ? item.score ?? "-" : "-"}</div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="text-sm text-slate-600">暂无类目候选</div>
        )}

        <div className="mt-4 rounded-[16px] border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs text-slate-500">手动类目</div>
          <input
            value={manualCategory}
            onChange={(event) => setManualCategory(event.target.value)}
            className="mt-2 h-11 w-full rounded-[14px] border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
            placeholder="输入完整类目路径"
          />
          <div className="mt-3">
            <button
              type="button"
              onClick={() => void applyFieldChoice("selected_category_id", "manual", manualCategory)}
              disabled={loading || !manualCategory.trim()}
              className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
            >
              保存手动类目
            </button>
          </div>
        </div>
      </Section>

      <Section title="标题采用">
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs text-slate-500">当前标题</div>
            <div className="mt-1 text-sm text-slate-900">{task.title || "-"}</div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void applyFieldChoice("task_title", "raw")}
                disabled={loading}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                用原始标题
              </button>
              <button
                type="button"
                onClick={() => void applyFieldChoice("task_title", "ai")}
                disabled={loading || !task.ai?.title_cn}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                用 AI 标题
              </button>
            </div>
          </div>

          <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs text-slate-500">手动标题</div>
            <input
              value={manualTitle}
              onChange={(event) => setManualTitle(event.target.value)}
              className="mt-2 h-11 w-full rounded-[14px] border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
              placeholder="输入最终采用标题"
            />
            <div className="mt-3">
              <button
                type="button"
                onClick={() => void applyFieldChoice("task_title", "manual", manualTitle)}
                disabled={loading || !manualTitle.trim()}
                className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
              >
                保存手动标题
              </button>
            </div>
          </div>
        </div>
      </Section>

      <Section title="任务状态">
        <div className="grid gap-2 text-sm text-slate-700 md:grid-cols-3">
          <div>
            <div className="text-xs text-slate-500">主状态</div>
            <div className="mt-1">{statusText(task.main_status)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">类目状态</div>
            <div className="mt-1">{statusText(task.category_status)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">导出状态</div>
            <div className="mt-1">{statusText(task.export_status)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">图片提示词状态</div>
            <div className="mt-1">{statusText(task.image_prompt_status)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">生成模式</div>
            <div className="mt-1">{task.generation_mode}</div>
          </div>
        </div>
      </Section>

      <Section title="AI 理解">
        {task.ai ? (
          <div className="space-y-3 text-sm text-slate-700">
            <div>
              <div className="text-xs text-slate-500">中文标题</div>
              <div className="mt-1">{task.ai.title_cn || "-"}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">英文标题</div>
              <div className="mt-1">{task.ai.title_en || "-"}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">商品描述</div>
              <div className="mt-1 whitespace-pre-wrap">{task.ai.product_description || "-"}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">标题包</div>
              <pre className="mt-1 overflow-auto rounded-[14px] border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                {task.ai.title_package ? JSON.stringify(task.ai.title_package, null, 2) : "-"}
              </pre>
            </div>
            <div>
              <div className="text-xs text-slate-500">图片提示词包</div>
              <pre className="mt-1 overflow-auto rounded-[14px] border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                {task.ai.image_prompt_package ? JSON.stringify(task.ai.image_prompt_package, null, 2) : "-"}
              </pre>
            </div>
            <div>
              <div className="text-xs text-slate-500">Product Info</div>
              <pre className="mt-1 overflow-auto rounded-[14px] border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                {task.ai.product_info ? JSON.stringify(task.ai.product_info, null, 2) : "-"}
              </pre>
            </div>
            <div>
              <div className="text-xs text-slate-500">Product DNA</div>
              <pre className="mt-1 overflow-auto rounded-[14px] border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                {task.ai.product_dna ? JSON.stringify(task.ai.product_dna, null, 2) : "-"}
              </pre>
            </div>
          </div>
        ) : (
          <div className="text-sm text-slate-600">暂无 AI 结果</div>
        )}
      </Section>

      <Section title="AI 调用日志 / 排查">
        {timeline?.events?.filter((event) => String(event.stage).startsWith("ai.")).length ? (
          <div className="space-y-4">
            {timeline.events
              .filter((event) => String(event.stage).startsWith("ai."))
              .map((event) => (
                <div key={`${event.stage}-${event.ts || "na"}`} className="rounded-[16px] border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium text-slate-900">{event.title}</div>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span>{formatDateTime(event.ts)}</span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">{statusText(event.status)}</span>
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{event.message}</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">stage: {event.stage}</span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">model: {String(event.meta?.model || "-")}</span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">耗时: {String(event.meta?.duration_ms || 0)}ms</span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">prompt: {String(event.meta?.prompt_type || "-")}</span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">
                      模板: #{String((event.meta?.prompt_template as Record<string, unknown> | undefined)?.template_id || "-")}
                    </span>
                  </div>
                  {!!event.meta?.error && (
                    <div className="mt-2 rounded-[12px] border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
                      {String(event.meta.error)}
                    </div>
                  )}
                  <div className="mt-3 grid gap-3 xl:grid-cols-3">
                    <div>
                      <div className="text-xs text-slate-500">输入</div>
                      <pre className="mt-1 overflow-auto rounded-[14px] border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                        {formatJson(event.meta?.input)}
                      </pre>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">提示词</div>
                      <pre className="mt-1 overflow-auto rounded-[14px] border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                        {typeof event.meta?.prompt === "string" && event.meta.prompt ? event.meta.prompt : "-"}
                      </pre>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">输出</div>
                      <pre className="mt-1 overflow-auto rounded-[14px] border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                        {formatJson(event.meta?.output)}
                      </pre>
                    </div>
                  </div>
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => void copyTraceEvent(event)}
                      className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                    >
                      复制本步骤日志
                    </button>
                  </div>
                </div>
              ))}
          </div>
        ) : (
          <div className="text-sm text-slate-600">暂无 AI 调用日志</div>
        )}
      </Section>
    </div>
  );
}

function DefaultsTab({ task }: { task: ProductTaskDetail }) {
  return (
    <div className="space-y-4">
      <Section title="上架默认值">
        <div className="text-sm leading-6 text-slate-600">
          这里用于补当前商品导出模板里还没填满的字段。可以套用系统默认值、时间默认值，也可以对单个字段改成当前商品专用值。
        </div>
      </Section>
      <ExportFieldsTab task={task} />
    </div>
  );
}

function RawDataTab({
  task,
  raw,
}: {
  task: ProductTaskDetail;
  raw: RawProductDetail | null;
}) {
  const screenshotImages = raw?.screenshot_url ? [raw.screenshot_url] : task.screenshot_url ? [task.screenshot_url] : [];

  return (
    <div className="space-y-4">
      <Section title="原始采集字段">
        <div className="grid gap-4 xl:grid-cols-2">
          <CompareCard
            title="原始文本"
            tone="raw"
            items={[
              { label: "原始标题", value: raw?.title || task.title || "-" },
              { label: "平台", value: raw?.platform || task.product_platform || "-" },
              { label: "链接", value: raw?.url || task.source_url || "-" },
              { label: "SKU", value: raw?.platform_sku || task.platform_sku || task.source_id || "-" },
              { label: "采集时间", value: formatDateTime(raw?.created_at || task.created_at) },
            ]}
          />
          <CompareCard
            title="当前任务"
            tone="final"
            items={[
              { label: "任务标题", value: task.title || "-" },
              { label: "采用类目", value: task.selected_category_id || task.ai?.category_best_path || "-" },
              { label: "主状态", value: statusText(task.main_status) },
              { label: "导出状态", value: statusText(task.export_status) },
              { label: "异常", value: task.last_error_message || "-" },
            ]}
          />
        </div>
      </Section>

      <Section title="原始图片证据">
        <div className="space-y-4">
          <ImageGallerySection title="页面截图" description="只在抽屉里查看原始页面截图" images={screenshotImages} onPreview={() => {}} />
          <ImageGallerySection title="原始主图" description="采集到的主图" images={raw?.main_image ? [raw.main_image] : []} onPreview={() => {}} />
          <ImageGallerySection title="原始轮播图" description="采集到的轮播图" images={raw?.carousel_images || []} onPreview={() => {}} />
          <ImageGallerySection title="SKU 图" description="采集到的 SKU 图" images={raw?.sku_images || []} onPreview={() => {}} />
          <ImageGallerySection title="详情图" description="采集到的详情图" images={raw?.detail_images || []} onPreview={() => {}} />
          <ImageGallerySection title="尺寸图" description="采集到的尺寸图" images={raw?.size_chart_images || []} onPreview={() => {}} />
        </div>
      </Section>
    </div>
  );
}

function ExportFieldsTab({ task }: { task: ProductTaskDetail }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ExportFieldDraft | null>(null);
  const [candidates, setCandidates] = useState<ExportFieldCandidates>({});
  const [manualJson, setManualJson] = useState("{\n  \"is_sensitive\": false\n}");
  const [manualFieldKey, setManualFieldKey] = useState("product_title_cn");
  const [manualFieldValue, setManualFieldValue] = useState("");

  async function loadPreview(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/product-tasks/${task.id}/export-fields/preview`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { draft: ExportFieldDraft | null; candidates?: ExportFieldCandidates };
      setDraft(data.draft || null);
      setCandidates(data.candidates || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  async function applyRules(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/product-tasks/${task.id}/apply-default-rules`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { draft: ExportFieldDraft };
      setDraft(data.draft);
      await loadPreview();
    } catch (err) {
      setError(err instanceof Error ? err.message : "应用规则失败");
    } finally {
      setLoading(false);
    }
  }

  async function saveManual(): Promise<void> {
    setLoading(true);
    setError(null);
    let obj: Record<string, unknown>;
    try {
      const parsed = JSON.parse(manualJson);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("必须是 JSON 对象");
      obj = parsed as Record<string, unknown>;
    } catch (err) {
      setLoading(false);
      setError(err instanceof Error ? err.message : "JSON 解析失败");
      return;
    }

    try {
      const res = await fetch(`${apiBaseUrl}/api/product-tasks/${task.id}/export-fields`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fields: obj }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { draft: ExportFieldDraft };
      setDraft(data.draft);
      await loadPreview();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setLoading(false);
    }
  }

  async function chooseFieldSource(fieldKey: string, selectedSource: "raw" | "ai" | "manual", manualValue?: string): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/product-tasks/${task.id}/export-fields/choose`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          field_key: fieldKey,
          selected_source: selectedSource,
          manual_value: manualValue,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { draft: ExportFieldDraft; candidates?: ExportFieldCandidates };
      setDraft(data.draft);
      setCandidates(data.candidates || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "字段选择失败");
    } finally {
      setLoading(false);
    }
  }

  const fields = draft?.fields_json || {};
  const sources = draft?.field_sources_json || {};
  const warnings = (draft?.warnings_json || []) as { field?: string; message?: string; type?: string }[];
  const warningByField = warnings.reduce<Record<string, string[]>>((acc, w) => {
    const f = String(w.field || "");
    if (!f) return acc;
    acc[f] = acc[f] || [];
    acc[f].push(String(w.message || w.type || "warning"));
    return acc;
  }, {});

  const fieldKeys = Object.keys(fields).sort((a, b) => a.localeCompare(b));
  const manualOverrideCount = Object.values(sources).filter((src) => {
    if (!src || typeof src !== "object") return false;
    return String((src as Record<string, unknown>).source || "") === "manual_override";
  }).length;

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-[18px] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <Section title="导出字段作用">
        <div className="text-sm leading-6 text-slate-700">
          导出字段是最终写入平台导入模板（例如 Temu Excel）的标准字段集合。它把 AI 结果、规则默认值、人工覆盖统一成一份“可导出数据草稿”。
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div className="rounded-[14px] border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <div className="text-xs text-slate-500">字段总数</div>
            <div className="mt-1 text-lg font-semibold text-slate-900">{fieldKeys.length}</div>
          </div>
          <div className="rounded-[14px] border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <div className="text-xs text-slate-500">警告字段数</div>
            <div className="mt-1 text-lg font-semibold text-amber-700">{Object.keys(warningByField).length}</div>
          </div>
          <div className="rounded-[14px] border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <div className="text-xs text-slate-500">人工覆盖字段数</div>
            <div className="mt-1 text-lg font-semibold text-slate-900">{manualOverrideCount}</div>
          </div>
        </div>
      </Section>

      <Section title="导出字段草稿">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void applyRules()}
            className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800"
            disabled={loading}
          >
            应用默认规则生成草稿
          </button>
          <button
            type="button"
            onClick={() => void loadPreview()}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            disabled={loading}
          >
            刷新预览
          </button>
        </div>

        <div className="mt-4 rounded-[18px] border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          {draft ? (
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs">
                draft_id: {draft.id}
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs">
                status: {draft.status}
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs">
                updated_at: {draft.updated_at}
              </span>
            </div>
          ) : (
            <div className="text-slate-600">暂无草稿，点击“应用默认规则生成草稿”</div>
          )}
        </div>

        {draft ? (
          <div className="mt-4 overflow-hidden rounded-[18px] border border-slate-200 bg-white">
            <div className="grid grid-cols-[220px_1fr_220px_1fr] gap-0 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-700">
              <div>字段</div>
              <div>当前值</div>
              <div>来源</div>
              <div>警告</div>
            </div>
            <div className="divide-y divide-slate-100">
              {fieldKeys.map((k) => {
                const v = fields[k];
                const src = sources[k] as Record<string, unknown> | undefined;
                const srcText = src ? `${String(src.source || "-")} / ${String(src.priority || "-")}` : "-";
                const warn = warningByField[k]?.join("；") || "";
                const candidate = candidates[k];
                return (
                  <div
                    key={k}
                    className="grid grid-cols-[220px_1fr_220px_1fr] gap-0 px-4 py-3 text-sm text-slate-700"
                  >
                    <div className="truncate font-mono text-xs text-slate-900">{k}</div>
                    <div className="break-all font-mono text-xs">
                      {typeof v === "string" ? v : JSON.stringify(v)}
                    </div>
                    <div className="break-all text-xs text-slate-600">{srcText}</div>
                    <div className="break-all text-xs text-amber-700">{warn}</div>
                    {candidate ? (
                      <div className="col-span-4 mt-3 rounded-[14px] border border-slate-100 bg-slate-50 p-3">
                        <div className="flex flex-wrap gap-2">
                          {candidate.raw !== undefined && candidate.raw !== null && candidate.raw !== "" ? (
                            <button
                              type="button"
                              onClick={() => void chooseFieldSource(k, "raw")}
                              disabled={loading}
                              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                              用 Raw
                            </button>
                          ) : null}
                          {candidate.ai !== undefined && candidate.ai !== null && candidate.ai !== "" ? (
                            <button
                              type="button"
                              onClick={() => void chooseFieldSource(k, "ai")}
                              disabled={loading}
                              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                              用 AI
                            </button>
                          ) : null}
                        </div>
                        <div className="mt-2 grid gap-2 md:grid-cols-3">
                          <CandidateCell label="Raw 候选" value={candidate.raw} />
                          <CandidateCell label="AI 候选" value={candidate.ai} />
                          <CandidateCell label="Manual 候选" value={candidate.manual} />
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </Section>

      <Section title="手动覆盖（manual_override）">
        <div className="text-sm text-slate-600">
          填写 JSON 对象：字段名 {"->"} 值。提交后该字段来源标记为 manual_override。
        </div>
        <textarea
          value={manualJson}
          onChange={(e) => setManualJson(e.target.value)}
          className="mt-3 h-[200px] w-full resize-none rounded-[18px] border border-slate-200 bg-white p-3 text-sm font-mono outline-none focus:border-slate-400"
          placeholder='{\n  "is_sensitive": false\n}'
        />
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void saveManual()}
            className="h-11 rounded-full bg-slate-900 px-5 text-sm font-medium text-white hover:bg-slate-800"
            disabled={loading}
          >
            保存覆盖
          </button>
        </div>

        <div className="mt-6 border-t border-slate-200 pt-4">
          <div className="text-sm text-slate-600">也可以直接对单个字段设置 manual 值。</div>
          <div className="mt-3 grid gap-3 md:grid-cols-[220px_1fr_auto]">
            <select
              value={manualFieldKey}
              onChange={(event) => setManualFieldKey(event.target.value)}
              className="h-11 rounded-[16px] border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
            >
              {fieldKeys.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
            <input
              value={manualFieldValue}
              onChange={(event) => setManualFieldValue(event.target.value)}
              className="h-11 rounded-[16px] border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
              placeholder="输入该字段的 manual 值"
            />
            <button
              type="button"
              onClick={() => void chooseFieldSource(manualFieldKey, "manual", manualFieldValue)}
              className="h-11 rounded-full bg-slate-900 px-5 text-sm font-medium text-white hover:bg-slate-800"
              disabled={loading || !manualFieldKey || !manualFieldValue.trim()}
            >
              保存单字段
            </button>
          </div>
        </div>
      </Section>
    </div>
  );
}

function CandidateCell({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-[12px] border border-slate-200 bg-white p-3">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="mt-1 break-all font-mono text-xs text-slate-700">
        {value === undefined || value === null || value === "" ? "-" : typeof value === "string" ? value : JSON.stringify(value)}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[18px] border border-slate-200 bg-white p-5">
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function PromptEditorModal({
  config,
  onClose,
}: {
  config: PromptEditorConfig | null;
  onClose: () => void;
}) {
  const [selectedType, setSelectedType] = useState("");
  const [overrideText, setOverrideText] = useState("");
  const [resolved, setResolved] = useState<Record<string, { id: number; scope: string; version: number }>>({});
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!config) return;
    const activeConfig = config;
    const initialType = activeConfig.promptTypes[0] || "";
    setSelectedType(initialType);
    setNotice(null);
    setError(null);

    async function loadResolvedPrompt() {
      setLoading(true);
      try {
        const nextResolved: Record<string, { id: number; scope: string; version: number }> = {};
        for (const type of activeConfig.promptTypes) {
          const res = await fetch(
            `${apiBaseUrl}/api/prompt-templates/resolve?prompt_type=${encodeURIComponent(type)}&task_id=${activeConfig.taskIds[0]}`,
            { cache: "no-store" },
          );
          if (!res.ok) continue;
          const item = (await res.json()) as { id: number; scope: string; version: number; template_text: string };
          nextResolved[type] = { id: item.id, scope: item.scope, version: item.version };
          if (type === initialType) {
            setOverrideText(item.template_text);
          }
        }
        setResolved(nextResolved);
      } catch (err) {
        setError(err instanceof Error ? err.message : "加载提示词失败");
      } finally {
        setLoading(false);
      }
    }

    void loadResolvedPrompt();
  }, [config]);

  async function changeType(nextType: string) {
    if (!config) return;
    setSelectedType(nextType);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch(
        `${apiBaseUrl}/api/prompt-templates/resolve?prompt_type=${encodeURIComponent(nextType)}&task_id=${config.taskIds[0]}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const item = (await res.json()) as { id: number; scope: string; template_text: string; version: number };
      setOverrideText(item.template_text);
      setResolved((prev) => ({ ...prev, [nextType]: { id: item.id, scope: item.scope, version: item.version } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "切换提示词失败");
    }
  }

  async function saveOverride() {
    if (!config || !selectedType || !overrideText.trim()) return;
    setLoading(true);
    setNotice(null);
    setError(null);
    try {
      for (const taskId of config.taskIds) {
        const resolvedRes = await fetch(
          `${apiBaseUrl}/api/prompt-templates/resolve?prompt_type=${encodeURIComponent(selectedType)}&task_id=${taskId}`,
          { cache: "no-store" },
        );
        let existingTaskOverrideId: number | null = null;
        if (resolvedRes.ok) {
          const existing = (await resolvedRes.json()) as { id: number; scope: string };
          if (existing.scope === "task") existingTaskOverrideId = existing.id;
        }

        if (existingTaskOverrideId) {
          await fetch(`${apiBaseUrl}/api/prompt-templates/${existingTaskOverrideId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ template_text: overrideText, enabled: true }),
          }).then(async (res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
          });
        } else {
          await fetch(`${apiBaseUrl}/api/prompt-templates`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: `${selectedType} (task#${taskId})`,
              prompt_type: selectedType,
              scope: "task",
              category_id: null,
              task_id: taskId,
              template_text: overrideText,
              variables_json: {},
              version: 1,
              enabled: true,
            }),
          }).then(async (res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
          });
        }
      }
      setNotice(`已保存并应用到 ${config.taskIds.length} 个任务。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存提示词失败");
    } finally {
      setLoading(false);
    }
  }

  async function restoreDefault() {
    if (!config || !selectedType) return;
    setLoading(true);
    setNotice(null);
    setError(null);
    try {
      for (const taskId of config.taskIds) {
        const resolvedRes = await fetch(
          `${apiBaseUrl}/api/prompt-templates/resolve?prompt_type=${encodeURIComponent(selectedType)}&task_id=${taskId}`,
          { cache: "no-store" },
        );
        if (!resolvedRes.ok) continue;
        const existing = (await resolvedRes.json()) as { id: number; scope: string };
        if (existing.scope !== "task") continue;
        await fetch(`${apiBaseUrl}/api/prompt-templates/${existing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: false }),
        }).then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        });
      }
      setNotice("已恢复默认提示词。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "恢复默认失败");
    } finally {
      setLoading(false);
    }
  }

  async function rerunPrompt() {
    if (!config || !selectedType) return;
    setLoading(true);
    setNotice(null);
    setError(null);
    try {
      for (const taskId of config.taskIds) {
        await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}/run-ai`, {
          method: "POST",
          headers: buildAiRequestHeaders(true),
          body: JSON.stringify({ prompt_types: [selectedType] }),
        }).then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        });
      }
      setNotice(`已触发 ${config.taskIds.length} 个任务重跑 ${selectedType}。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "重跑失败");
    } finally {
      setLoading(false);
    }
  }

  if (!config) return null;

  return (
    <div className="fixed inset-0 z-[110] bg-black/35 p-6" onClick={onClose}>
      <div
        className="mx-auto mt-8 max-w-5xl rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_30px_120px_rgba(15,23,42,0.22)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-slate-500">字段提示词</div>
            <div className="mt-1 text-xl font-semibold text-slate-900">{config.fieldLabel}</div>
            <div className="mt-1 text-xs text-slate-500">当前应用到 {config.taskIds.length} 个任务</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          >
            ×
          </button>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[280px_1fr]">
          <div className="space-y-2">
            {config.promptTypes.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => void changeType(type)}
                className={[
                  "block w-full rounded-[16px] border px-4 py-3 text-left",
                  selectedType === type ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white hover:bg-slate-50",
                ].join(" ")}
              >
                <div className="font-mono text-xs font-semibold text-slate-900">{type}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {resolved[type] ? `${resolved[type].scope} · v${resolved[type].version}` : "加载中"}
                </div>
              </button>
            ))}
          </div>

          <div>
            <textarea
              value={overrideText}
              onChange={(event) => setOverrideText(event.target.value)}
              className="h-[340px] w-full resize-none rounded-[18px] border border-slate-200 bg-white p-3 text-sm font-mono outline-none focus:border-slate-400"
              placeholder="编辑当前字段对应的提示词模板"
            />
            {error ? <div className="mt-2 text-sm text-rose-600">{error}</div> : null}
            {notice ? <div className="mt-2 text-sm text-emerald-700">{notice}</div> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void restoreDefault()}
                disabled={loading}
                className="h-10 rounded-full border border-slate-300 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                恢复默认
              </button>
              <button
                type="button"
                onClick={() => void saveOverride()}
                disabled={loading}
                className="h-10 rounded-full bg-slate-900 px-4 text-sm font-medium text-white disabled:opacity-50"
              >
                保存并应用
              </button>
              <button
                type="button"
                onClick={() => void rerunPrompt()}
                disabled={loading}
                className="h-10 rounded-full border border-slate-300 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                保存后重跑
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
