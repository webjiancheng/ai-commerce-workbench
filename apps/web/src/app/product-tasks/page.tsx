"use client";

import { SearchableCategoryInput, type CategorySearchItem, type CategorySearchResponse } from "@/components/product-tasks/searchable-category-input";
import { statusBadgeColor, statusText } from "@/components/product-tasks/status";
import { TaskFilters } from "@/components/product-tasks/task-filters";
import { WorkbenchTable } from "@/components/product-tasks/workbench-table";
import { InfoTab } from "@/features/product-tasks/components/info-tab";
import { DefaultsTab } from "@/features/product-tasks/components/defaults-tab";
import { ImagesTabView } from "@/features/product-tasks/components/images-tab-view";
import { TraceTabLogsView } from "@/features/product-tasks/components/trace-tab-logs-view";
import { TraceTabDefaultView } from "@/features/product-tasks/components/trace-tab-default-view";
import { applyTaskDefaultRule, listEnabledDefaultRules, type DefaultRuleOption } from "@/features/default-rules/api";
import { PromptEditorModal } from "@/features/product-tasks/components/prompt-editor-modal";
import { RawDataTab } from "@/features/product-tasks/components/raw-data-tab";
import { ReviewBoard } from "@/features/product-tasks/components/review-board";
import { TaskDrawer, type TaskDrawerSize, type TaskDrawerTab } from "@/features/product-tasks/components/task-drawer";
import {
  makeDraftId,
  nonEmptyPairs,
  type DynamicPair,
} from "@/features/product-tasks/components/defaults-tab-helpers";
import { buildTraceSummary } from "@/features/product-tasks/trace-summary";
import { useProductTaskList } from "@/features/product-tasks/hooks/use-product-task-list";
import { useTaskRowMeta } from "@/features/product-tasks/hooks/use-task-row-meta";
import {
  assignImageToSlotApi,
  generateCarousel4GridApi,
  generateSellingImagesApi,
  generateSingleImageApi,
  generateSizeImageApi,
  generateSkuImageApi,
  patchTaskImageSettingsApi,
  regenerateAssetApi,
  removeSlotImageApi,
  reorderSlotsApi,
  runDimensionExtractApi,
  setFinalAssetApi,
} from "@/features/product-tasks/image-workbench/api";
import {
  type LightboxImage,
  type PoolCandidate,
} from "@/features/product-tasks/image-workbench/components/media-panels";
import { useImageAssets } from "@/features/product-tasks/image-workbench/use-image-assets";
import { generateTaskFourGrid, generateTaskTitles, runTaskAi } from "@/features/product-tasks/api";
import type {
  AssetsBySlotResponse,
  CategoryStatus,
  ExportFieldDraft,
  ExportImageSettings,
  ExportStatus,
  ProductAsset,
  ProductTaskDetail,
  ProductTaskListItem,
  ProductTaskTimelineEvent,
  ProductTaskTimelineResponse,
  PromptEditorConfig,
  RawProductDetail,
  RawSkuPropItem,
  RowMeta,
  TaskMainStatus,
} from "@/features/product-tasks/types";
import { apiBaseUrl } from "@/lib/api";
import { AiPurpose, resolveLocalImageRuntime, resolveLocalTextRuntime } from "@/lib/local-settings";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

// 归一化历史 enum 到三模式口径
type NormalizedGenerationMode = "task_only" | "title_only" | "title_and_4grid";

const BACKWARD_COMPAT_MAP: Record<string, NormalizedGenerationMode> = {
  no_ai: "task_only",
  title_and_image_prompts: "title_and_4grid",
  full_later: "title_and_4grid",
};

function normalizeGenerationMode(raw: string): NormalizedGenerationMode {
  return BACKWARD_COMPAT_MAP[raw] as NormalizedGenerationMode || (raw as NormalizedGenerationMode);
}

function getGenerationModeLabel(mode: string): string {
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

function normalizeRawSkuProps(items: RawSkuPropItem[] | null | undefined): RawSkuPropItem[] {
  return (items || []).map((item, index) => ({
    group_name: String(item?.group_name || "").trim(),
    option_name: String(item?.option_name || "").trim(),
    image_url: item?.image_url ? String(item.image_url).trim() || null : null,
    hint_text: item?.hint_text ? String(item.hint_text).trim() || null : null,
    group_index: Number.isFinite(item?.group_index) ? Number(item.group_index) : 0,
    option_index: Number.isFinite(item?.option_index) ? Number(item.option_index) : index,
    selected: Boolean(item?.selected),
  }));
}

function makeEmptyRawSkuProp(groupIndex = 0, optionIndex = 0): RawSkuPropItem {
  return {
    group_name: "",
    option_name: "",
    image_url: null,
    hint_text: null,
    group_index: groupIndex,
    option_index: optionIndex,
    selected: false,
  };
}

function buildAiRequestHeaders(
  includeJsonContentType = false,
  preferredPurposes?: AiPurpose[],
): Record<string, string> {
  const runtime = resolveLocalTextRuntime(preferredPurposes);
  const imageRuntime = resolveLocalImageRuntime();
  const headers: Record<string, string> = includeJsonContentType ? { "content-type": "application/json" } : {};
  if (runtime?.apiKey) headers["X-AI-API-Key"] = runtime.apiKey;
  if (runtime?.baseUrl) headers["X-AI-Base-URL"] = runtime.baseUrl;
  if (runtime?.model) headers["X-AI-Model"] = runtime.model;
  if (imageRuntime?.apiKey) headers["X-AI-Image-API-Key"] = imageRuntime.apiKey;
  if (imageRuntime?.baseUrl) headers["X-AI-Image-Base-URL"] = imageRuntime.baseUrl;
  if (imageRuntime?.model) headers["X-AI-Image-Model"] = imageRuntime.model;
  return headers;
}

function mapPromptTypesToPurposes(promptTypes?: string[]): AiPurpose[] {
  if (!promptTypes?.length) {
    return ["title_package", "product_info", "title"];
  }

  const mapped = new Set<AiPurpose>();
  for (const type of promptTypes) {
    if (type === "product_info_from_screenshot") mapped.add("product_info");
    else if (type === "title_package_lite") mapped.add("title_package_lite");
    else if (type === "title_package" || type === "title_en_with_cn_translation" || type === "title_en") mapped.add("title_package");
    else if (type === "dimension_extract_from_image") mapped.add("dimension_extract");
    else if (type.startsWith("image_prompt_") || type === "image_prompt_package") mapped.add("title_package");
    else mapped.add("title");
  }
  return Array.from(mapped);
}

type WorkbenchDetailResponse = {
  ok: boolean;
  task: ProductTaskDetail;
  raw: RawProductDetail | null;
  assets: AssetsBySlotResponse;
  export_draft: ExportFieldDraft | null;
};

function rowMetaFromWorkbenchDetail(payload: WorkbenchDetailResponse): RowMeta {
  return {
    raw: payload.raw,
    assets: payload.assets || {},
    detail: payload.task,
    exportDraft: payload.export_draft || null,
  };
}

type ViewMode = "cards" | "table";
type DrawerSize = TaskDrawerSize;
type DrawerTab = TaskDrawerTab;

const DRAWER_SIZE_KEY = "ai-caiji.workbench.drawerSize";

function logEventStatusColor(status: string): string {
  if (status === "success" || status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "failed" || status === "warning" || status === "blocking") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "running" || status === "queued" || status === "started") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-white text-slate-500";
}

function getEventJobId(event: ProductTaskTimelineEvent): number | null {
  const raw = event.meta?.job_id;
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

function imageJobFinishedEvent(events: ProductTaskTimelineEvent[], jobId: number | null): ProductTaskTimelineEvent | null {
  if (!jobId) return null;
  return (
    events.find(
      (event) =>
        event.stage === "image.result" &&
        getEventJobId(event) === jobId &&
        (event.status === "success" || event.status === "failed"),
    ) || null
  );
}

function displayTimelineEvent(
  event: ProductTaskTimelineEvent,
  allEvents: ProductTaskTimelineEvent[],
): ProductTaskTimelineEvent {
  if (event.stage === "image.queued" || event.stage === "image.running") {
    const resultEvent = imageJobFinishedEvent(allEvents, getEventJobId(event));
    if (resultEvent?.status === "success") {
      return {
        ...event,
        status: "completed",
        title: event.stage === "image.queued" ? event.title.replace("已创建", "已创建并完成") : event.title.replace("开始执行", "执行已完成"),
        message: `${event.message} 该图片任务后续已完成，见完成事件。`,
      };
    }
    if (resultEvent?.status === "failed") {
      return {
        ...event,
        status: "failed",
        title: event.stage === "image.queued" ? event.title.replace("已创建", "已创建后失败") : event.title.replace("开始执行", "执行失败"),
        message: `${event.message} 该图片任务后续失败，见失败事件。`,
      };
    }
  }
  return event;
}

function getLatestImageJobSummaries(events: ProductTaskTimelineEvent[]): ProductTaskTimelineEvent[] {
  const imageEvents = events.filter((event) => String(event.stage).startsWith("image."));
  const grouped = new Map<number, ProductTaskTimelineEvent[]>();
  const ungrouped: ProductTaskTimelineEvent[] = [];

  for (const event of imageEvents) {
    const jobId = getEventJobId(event);
    if (!jobId) {
      ungrouped.push(event);
      continue;
    }
    grouped.set(jobId, [...(grouped.get(jobId) || []), event]);
  }

  const summaries = Array.from(grouped.entries())
    .map(([jobId, jobEvents]) => {
      const result = jobEvents.find((event) => event.stage === "image.result");
      const running = jobEvents.find((event) => event.stage === "image.running");
      const queued = jobEvents.find((event) => event.stage === "image.queued");
      const base = result || running || queued || jobEvents[jobEvents.length - 1];
      if (!base) return null;
      const slotText = String(base.meta?.target_slots || base.meta?.slot || "-");
      if (result) {
        return {
          ...result,
          title: result.status === "success" ? `图片任务 #${jobId} 已完成` : `图片任务 #${jobId} 失败`,
          message:
            result.status === "success"
              ? `已输出 ${Array.isArray(result.meta?.output_asset_ids) ? result.meta.output_asset_ids.length : 0} 张图；目标槽位：${slotText}。`
              : result.message,
        };
      }
      if (running) return { ...running, title: `图片任务 #${jobId} 执行中` };
      return { ...base, title: `图片任务 #${jobId} 已提交`, message: `${base.message} 等待后台开始执行。` };
    })
    .filter((event): event is ProductTaskTimelineEvent => Boolean(event));

  return [...summaries, ...ungrouped].sort((a, b) => {
    const at = a.ts ? new Date(a.ts).getTime() : 0;
    const bt = b.ts ? new Date(b.ts).getTime() : 0;
    return bt - at;
  });
}

function eventUsage(event: ProductTaskTimelineEvent): Record<string, unknown> {
  return (event.meta?.usage as Record<string, unknown> | undefined) || {};
}

function eventCost(event: ProductTaskTimelineEvent): Record<string, unknown> {
  return (event.meta?.cost as Record<string, unknown> | undefined) || {};
}

function eventRuntime(event: ProductTaskTimelineEvent): Record<string, unknown> {
  return (event.meta?.runtime as Record<string, unknown> | undefined) || {};
}

function eventProvider(event: ProductTaskTimelineEvent): Record<string, unknown> {
  return (event.meta?.provider as Record<string, unknown> | undefined) || {};
}

function isModelCallEvent(event: ProductTaskTimelineEvent): boolean {
  const provider = eventProvider(event);
  const runtime = eventRuntime(event);
  const providerSource = String(provider.provider_source || runtime.provider_source || "").toLowerCase();
  const providerName = String(provider.provider_name || runtime.provider_name || "").toLowerCase();
  const model = String(event.meta?.model || runtime.model || "");
  const usage = eventUsage(event);
  const hasTokens = Number(usage.total_tokens || usage.prompt_tokens || usage.completion_tokens || 0) > 0;
  const hasPrompt = Boolean(event.meta?.has_prompt || (typeof event.meta?.prompt === "string" && event.meta.prompt && event.meta.prompt !== "dynamic_image_prompt_context"));
  if (providerSource === "code" || providerName.startsWith("dynamic_") || model.startsWith("code.")) return false;
  return hasTokens || hasPrompt;
}

function modelCallSummary(event: ProductTaskTimelineEvent, fallbackCurrency = "USD"): string {
  const runtime = eventRuntime(event);
  const usage = eventUsage(event);
  const cost = eventCost(event);
  const provider = eventProvider(event);
  const model = String(event.meta?.model || runtime.model || "-");
  const providerName = String(provider.provider_display_name || runtime.provider_display_name || provider.provider_name || runtime.provider_name || "-");
  const totalTokens = Number(usage.total_tokens || 0);
  const promptTokens = Number(usage.prompt_tokens || 0);
  const completionTokens = Number(usage.completion_tokens || 0);
  const currency = String(cost.currency || fallbackCurrency);
  const estimatedCost = Number(cost.estimated_cost);
  const tokenText = totalTokens
    ? `${formatInteger(totalTokens)} tokens（in ${formatInteger(promptTokens)} / out ${formatInteger(completionTokens)}）`
    : "tokens 未返回";
  const costText = Number.isFinite(estimatedCost) ? formatMoney(estimatedCost, currency) : "费用未估算";
  return `${providerName} / ${model} · ${tokenText} · ${costText}`;
}

function dedupeCompatAiEvents(events: ProductTaskTimelineEvent[]): ProductTaskTimelineEvent[] {
  const titlePackage = events.find((event) => event.stage === "ai.title_package");
  return events.filter((event) => {
    if (event.stage !== "ai.title_en" || !titlePackage) return true;
    const sameTime = event.ts === titlePackage.ts;
    const sameModel = String(event.meta?.model || "") === String(titlePackage.meta?.model || "");
    const sameUsage = formatJson(event.meta?.usage) === formatJson(titlePackage.meta?.usage);
    const sameOutput = formatJson(event.meta?.output) === formatJson(titlePackage.meta?.output);
    return !(sameTime && sameModel && sameUsage && sameOutput);
  });
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

function formatInteger(value: unknown): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return Math.round(num).toLocaleString("zh-CN");
}

function formatMoney(value: unknown, currency = "USD"): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return `${currency} ${num.toFixed(num >= 0.1 ? 4 : 6)}`;
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
  const usableAssets = (assets || []).filter((asset) => asset.status !== "removed" && asset.public_url);
  return usableAssets.find((asset) => asset.selected_for_export) || usableAssets[0] || null;
}

function slotHasRemovalMarker(assetsBySlot: AssetsBySlotResponse | undefined, slot: string): boolean {
  return Boolean(
    (assetsBySlot?.[slot] || []).some(
      (asset) => asset.selected_for_export && (asset.status === "removed" || asset.source_type === "manual_removed"),
    ),
  );
}

function rawCarouselSequence(raw: RawProductDetail | null | undefined): string[] {
  return Array.from(new Set([...(raw?.main_image ? [raw.main_image] : []), ...(raw?.carousel_images || [])]));
}

function normalizeExportImageSettings(settings: ExportImageSettings | null | undefined): Required<ExportImageSettings> {
  const rawPosition = Number(settings?.size_chart_position || 3);
  return {
    insert_size_chart_in_carousel: settings?.insert_size_chart_in_carousel !== false,
    size_chart_position: Number.isFinite(rawPosition) ? Math.max(1, Math.min(Math.trunc(rawPosition), 10)) : 3,
  };
}

function insertItemAtPosition<T>(items: T[], item: T | null, enabled: boolean, position: number): T[] {
  if (!enabled || !item) return items;
  const index = Math.max(0, Math.min(position - 1, items.length));
  return [...items.slice(0, index), item, ...items.slice(index)];
}

export default function ProductTasksPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-500">加载中...</div>}>
      <ProductTasksPageInner />
    </Suspense>
  );
}

function ProductTasksPageInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialViewMode: ViewMode = pathname === "/logs" || searchParams.get("view") === "logs" ? "cards" : "table";
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [bulkLoading, setBulkLoading] = useState<string | null>(null);
  const [rowLoading, setRowLoading] = useState<Record<number, string>>({});
  const [categoryOptions, setCategoryOptions] = useState<CategorySearchItem[]>([]);
  const [defaultRules, setDefaultRules] = useState<DefaultRuleOption[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState<number | "">("");
  const [bulkTitleMode, setBulkTitleMode] = useState<"current" | "raw" | "ai">("ai");
  const [bulkTitlePrefix, setBulkTitlePrefix] = useState("");
  const [bulkTitleSuffix, setBulkTitleSuffix] = useState("");
  const [bulkCategoryValue, setBulkCategoryValue] = useState("");
  const [bulkSite, setBulkSite] = useState("美国站");
  const [bulkWarehouse, setBulkWarehouse] = useState("美国-饰品");
  const [bulkLeadTime, setBulkLeadTime] = useState("2个工作日内发货");
  const [bulkMaterialLang, setBulkMaterialLang] = useState("英语");
  const [bulkOriginCountry, setBulkOriginCountry] = useState("中国");
  const [bulkOriginProvince, setBulkOriginProvince] = useState("广东省");
  const [bulkCurrency, setBulkCurrency] = useState("CNY");
  const [bulkDefaultStock, setBulkDefaultStock] = useState("100");
  const [bulkDeclaredPrice, setBulkDeclaredPrice] = useState("");
  const [bulkPackageLength, setBulkPackageLength] = useState("10");
  const [bulkPackageWidth, setBulkPackageWidth] = useState("8");
  const [bulkPackageHeight, setBulkPackageHeight] = useState("2");
  const [bulkPackageWeight, setBulkPackageWeight] = useState("30");
  const [bulkDynamicFields, setBulkDynamicFields] = useState<DynamicPair[]>([
    { id: makeDraftId("bulk_attr"), key: "主体材质", value: "" },
    { id: makeDraftId("bulk_attr"), key: "镀层", value: "" },
  ]);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateRuleId, setTemplateRuleId] = useState<number | "">("");
  const [templateOverwriteMode, setTemplateOverwriteMode] = useState<"fill_empty" | "overwrite_system" | "force_overwrite">("overwrite_system");
  const [templateKindFilter, setTemplateKindFilter] = useState<
    "all" | "product_template" | "sku_template" | "shipping_template" | "price_dimension_template" | "image_video_template" | "sensitive_template" | "packaging_template"
  >("all");
  const [templateOnlyMiaoshou, setTemplateOnlyMiaoshou] = useState(true);
  const [batchEditModalOpen, setBatchEditModalOpen] = useState(false);
  const [batchEditFieldRows, setBatchEditFieldRows] = useState<DynamicPair[]>([
    { id: makeDraftId("batch_edit"), key: "", value: "" },
  ]);
  const [batchTemplateName, setBatchTemplateName] = useState("批量编辑模板");
  const [batchTemplateKind, setBatchTemplateKind] = useState<
    "product_template" | "sku_template" | "shipping_template" | "price_dimension_template" | "image_video_template" | "sensitive_template" | "packaging_template"
  >("product_template");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerSize, setDrawerSize] = useState<DrawerSize>("70");
  const [drawerTab, setDrawerTab] = useState<DrawerTab>(pathname === "/logs" ? "trace" : "images");
  const [activeTaskId, setActiveTaskId] = useState<number | null>(null);
  const [taskDetail, setTaskDetail] = useState<ProductTaskDetail | null>(null);
  const [rawDetail, setRawDetail] = useState<RawProductDetail | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [promptEditor, setPromptEditor] = useState<PromptEditorConfig | null>(null);
  const [drawerSyncing, setDrawerSyncing] = useState(false);
  const isLogsRoute = pathname === "/logs";

  const {
    rowMeta,
    setRowMeta,
    quickTitleDrafts,
    setQuickTitleDrafts,
    quickCategoryDrafts,
    setQuickCategoryDrafts,
    loadRowMeta,
  } = useTaskRowMeta();

  const {
    keyword,
    setKeyword,
    status,
    setStatus,
    categoryStatus,
    setCategoryStatus,
    exportStatus,
    setExportStatus,
    exceptionOnly,
    setExceptionOnly,
    lowConfidenceOnly,
    setLowConfidenceOnly,
    loading,
    error: listError,
    data,
    timelineMap,
    selectedIds,
    loadList,
    loadTaskTimeline,
    currentPage,
    totalPages,
    allSelected,
    changePage,
    changePageSize,
    toggleSelectAll,
    toggleSelect,
    upsertTimeline,
  } = useProductTaskList({
    initialExceptionOnly: searchParams.get("exception") === "1",
    initialLowConfidenceOnly: searchParams.get("low_confidence") === "1",
    onItemsLoaded: (items) => {
      void loadRowMeta(items);
    },
  });
  const currentError = error || listError;

  useEffect(() => {
    const stored = window.localStorage.getItem(DRAWER_SIZE_KEY);
    if (stored === "50" || stored === "70" || stored === "100") setDrawerSize(stored);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadCategoryOptions(): Promise<void> {
      try {
        const response = await fetch(`${apiBaseUrl}/api/categories/search?limit=5000`, { cache: "no-store" });
        if (!response.ok) return;
        const result = (await response.json()) as CategorySearchResponse;
        if (!cancelled) {
          setCategoryOptions(result.items || []);
        }
      } catch {
        // ignore category preload failure
      }
    }
    void loadCategoryOptions();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadRuleOptions(): Promise<void> {
      try {
        const items = await listEnabledDefaultRules();
        if (cancelled) return;
        setDefaultRules(items);
        setSelectedRuleId((current) => current || items[0]?.id || "");
      } catch {
        if (!cancelled) setDefaultRules([]);
      }
    }
    void loadRuleOptions();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(DRAWER_SIZE_KEY, drawerSize);
  }, [drawerSize]);

  useEffect(() => {
    const nextView: ViewMode = pathname === "/logs" || searchParams.get("view") === "logs" ? "cards" : "table";
    setViewMode(nextView);
    setDrawerTab(pathname === "/logs" ? "trace" : "images");
  }, [pathname, searchParams]);

  useEffect(() => {
    const hasRunningTask = data.items.some(
      (item) =>
        item.main_status === "ai_running" ||
        item.main_status === "image_running" ||
        item.category_status === "running" ||
        item.title_status === "running" ||
        item.image_prompt_status === "running" ||
        item.image_status === "running",
    );
    if (!hasRunningTask) return;

    const timer = window.setInterval(() => {
      void loadList();
      if (drawerOpen && activeTaskId) {
        void loadWorkbenchDetail(activeTaskId).catch(() => {
          // ignore polling errors
        });
      }
    }, 5000);

    return () => {
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.items, drawerOpen, activeTaskId]);

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
    const [detailRes, timeline] = await Promise.all([
      fetch(`${apiBaseUrl}/api/product-tasks/${taskId}/workbench-detail`, {
        cache: "no-store",
      }),
      loadTaskTimeline(taskId),
    ]);
    if (!detailRes.ok) throw new Error(`加载详情失败: HTTP ${detailRes.status}`);
    const detail = (await detailRes.json()) as WorkbenchDetailResponse;
    setTaskDetail(detail.task);
    setRawDetail(detail.raw);
    setRowMeta((prev) => ({ ...prev, [taskId]: rowMetaFromWorkbenchDetail(detail) }));
    upsertTimeline(taskId, timeline);
  }

  async function openDrawer(taskId: number): Promise<void> {
    setDrawerOpen(true);
    setActiveTaskId(taskId);
    setDrawerTab(pathname === "/logs" ? "trace" : "images");
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

  async function syncDrawerAndTable(): Promise<void> {
    if (!activeTaskId) return;
    setDrawerSyncing(true);
    try {
      await loadWorkbenchDetail(activeTaskId);
      await loadList();
    } finally {
      setDrawerSyncing(false);
    }
  }

  function closeDrawer(): void {
    setDrawerOpen(false);
    setActiveTaskId(null);
  }

  const selectedItems = data.items.filter((item) => selectedIds.includes(item.id));
  const selectedDraftCount = selectedItems.filter((item) => rowMeta[item.id]?.exportDraft).length;
  const selectedExportReadyCount = selectedItems.filter((item) => item.export_status === "ready").length;
  const selectedLowConfidenceCount = selectedItems.filter((item) => item.category_status === "low_confidence").length;
  const selectedRule = defaultRules.find((item) => item.id === selectedRuleId);
  const filteredTemplateRules = defaultRules.filter((item) => {
    if (templateOnlyMiaoshou) {
      const adapter = String(item.conditions_json?.adapter_key || "miaoshou_temu_non_apparel");
      if (adapter !== "miaoshou_temu_non_apparel") return false;
    }
    if (templateKindFilter === "all") return true;
    const kind = String(item.conditions_json?.template_kind || "product_template");
    return kind === templateKindFilter;
  });
  const batchEditFilledCount = nonEmptyPairs(batchEditFieldRows).length;
  const quickBatchFieldGroups: Array<{ group: string; items: Array<{ key: string; label: string }> }> = [
    {
      group: "基础信息",
      items: [
        { key: "*产地", label: "产地" },
        { key: "*承诺发货时效", label: "承诺发货时效" },
        { key: "*定制品", label: "定制品" },
      ],
    },
    {
      group: "SKU 信息",
      items: [
        { key: "库存", label: "库存" },
        { key: "SKU分类类型", label: "SKU分类类型" },
        { key: "SKU分类数量", label: "SKU分类数量" },
        { key: "SKU分类单位", label: "SKU分类单位" },
      ],
    },
    {
      group: "价格尺寸",
      items: [
        { key: "* 长（cm）", label: "长(cm)" },
        { key: "* 宽（cm）", label: "宽(cm)" },
        { key: "* 高（cm）", label: "高(cm)" },
        { key: "* 重量（g）", label: "重量(g)" },
      ],
    },
    {
      group: "敏感属性",
      items: [
        { key: "* 是否敏感属性", label: "是否敏感属性" },
        { key: "敏感属性值", label: "敏感属性值" },
      ],
    },
    {
      group: "包装与编码",
      items: [
        { key: "包装清单", label: "包装清单" },
        { key: "包装清单数量", label: "包装清单数量" },
        { key: "产品编码类型", label: "产品编码类型" },
        { key: "产品编码", label: "产品编码" },
      ],
    },
  ];

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
    await generateTaskFourGrid(taskId);
  }

  async function runAi(taskId: number): Promise<void> {
    await runTaskAi(taskId, {});
  }

  async function generateTitles(taskId: number): Promise<void> {
    await generateTaskTitles(taskId);
  }

  async function rerunTaskPrompts(taskIds: number[], promptType: string): Promise<void> {
    for (const taskId of taskIds) {
      const response = await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}/run-ai`, {
        method: "POST",
        headers: buildAiRequestHeaders(true, mapPromptTypesToPurposes([promptType])),
        body: JSON.stringify({ prompt_types: [promptType] }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    }
  }

  async function saveQuickTitle(taskId: number): Promise<void> {
    const manualValue = (quickTitleDrafts[taskId] || "").trim();
    if (!manualValue) {
      setNotice("英文标题不能为空");
      return;
    }
    const response = await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}/field-choice`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        field_key: "product_title_en",
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
              ? meta?.detail?.ai?.title_en || ""
              : quickTitleDrafts[taskId] ||
                String(meta?.exportDraft?.fields_json?.["英文名称"] || meta?.exportDraft?.fields_json?.product_title_en || "").trim();
        const nextTitle = `${bulkTitlePrefix}${baseTitle}${bulkTitleSuffix}`.trim();
        if (!nextTitle) continue;
        await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}/field-choice`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            field_key: "product_title_en",
            selected_source: "manual",
            manual_value: nextTitle,
          }),
        }).then(async (response) => {
          const result = (await response.json()) as { detail?: string };
          if (!response.ok) throw new Error(result.detail || `HTTP ${response.status}`);
        });
      }
      setNotice(`已批量更新 ${selectedIds.length} 个商品英文标题。`);
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

  function patchBulkDynamicField(id: string, patch: Partial<DynamicPair>): void {
    setBulkDynamicFields((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  function buildBulkListingFields(): Record<string, string> {
    const fields: Record<string, string> = {
      "经营站点": bulkSite,
      "发货仓": bulkWarehouse,
      "发货仓1": bulkWarehouse,
      "承诺发货时效": bulkLeadTime,
      "素材语言": bulkMaterialLang,
      "商品产地": bulkOriginCountry,
      "产地省份": bulkOriginProvince,
      "币种": bulkCurrency,
      "最长边（cm）": bulkPackageLength,
      "次长边（cm）": bulkPackageWidth,
      "最短边（cm）": bulkPackageHeight,
      "重量（g）": bulkPackageWeight,
    };

    if (bulkDeclaredPrice.trim()) fields["申报价格-美国站"] = bulkDeclaredPrice.trim();
    if (bulkDefaultStock.trim()) fields["发货仓1库存"] = bulkDefaultStock.trim();

    for (const row of nonEmptyPairs(bulkDynamicFields)) {
      fields[row.key] = row.value;
    }

    return fields;
  }

  async function applyListingDefaultsToTask(taskId: number): Promise<void> {
    await applyTaskDefaultRule(taskId, selectedRuleId === "" ? null : selectedRuleId);

    const fields = buildBulkListingFields();
    const patchResponse = await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}/export-fields`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fields }),
    });
    const patchResult = (await patchResponse.json()) as { detail?: string };
    if (!patchResponse.ok) throw new Error(patchResult.detail || `HTTP ${patchResponse.status}`);
  }

  async function handleBulkApplyDefaults(): Promise<void> {
    if (!selectedIds.length) {
      setNotice("请先选择商品");
      return;
    }
    const ok = window.confirm(
      `将为已选择的 ${selectedIds.length} 个商品应用上架默认值并生成/刷新上架草稿。\n\n会写入当前批量默认值、动态附加字段、AI 标题/类目、商品资产等可导出字段；已人工覆盖的字段会尽量保留。是否继续？`,
    );
    if (!ok) return;
    await runBulkAction(
      "应用默认值并生成上架草稿",
      applyListingDefaultsToTask,
      "已为 {count} 个商品应用默认值并生成/刷新上架草稿。",
    );
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
    setBulkLoading("检查可导出性");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`${apiBaseUrl}/api/exports/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ product_task_ids: selectedIds }),
      });
      const result = (await response.json()) as {
        rows?: {
          task_id?: number;
          validation_result?: {
            errors?: { field_name?: string; message?: string; type?: string }[];
            warnings?: { field_name?: string; field_key?: string; message?: string; type?: string }[];
          };
        }[];
        detail?: string;
      };
      if (!response.ok) throw new Error(result.detail || `HTTP ${response.status}`);

      // Collect all errors with readable messages
      const allErrors: string[] = [];
      const allWarnings: string[] = [];
      for (const row of result.rows || []) {
        const taskId = row.task_id || "?";
        for (const err of row.validation_result?.errors || []) {
          const fieldName = err.field_name || "未知字段";
          let message = err.message || "校验失败";
          // Translate common error types to Chinese
          if (err.type === "missing" || err.type === "missing_image") {
            message = "未填写或未上传";
          } else if (err.type === "invalid_url") {
            message = "链接格式无效";
          } else if (err.type === "carousel_min_count") {
            message = "轮播图数量不足（至少3张）";
          }
          allErrors.push(`#${taskId} 【${fieldName}】${message}`);
        }
        for (const warning of row.validation_result?.warnings || []) {
          const fieldName = warning.field_name || warning.field_key || "提示";
          allWarnings.push(`#${taskId} 【${fieldName}】${warning.message || warning.type || "需要复核"}`);
        }
      }

      const errorsCount = allErrors.length;
      const warningsCount =
        result.rows?.reduce(
          (sum, row) =>
            sum + (Array.isArray(row.validation_result?.warnings) ? row.validation_result.warnings.length : 0),
          0,
        ) || 0;

      if (errorsCount > 0) {
        // Show first 10 errors with field names
        const errorSummary = allErrors.slice(0, 10).join("\n");
        const moreText = errorsCount > 10 ? `\n...还有 ${errorsCount - 10} 个错误` : "";
        setError(`校验未通过，共 ${errorsCount} 个错误：\n${errorSummary}${moreText}`);
      } else {
        const warningSummary = allWarnings.slice(0, 5).join("\n");
        const moreWarnings = warningsCount > 5 ? `\n...还有 ${warningsCount - 5} 条警告` : "";
        setNotice(
          warningSummary
            ? `已校验 ${selectedIds.length} 个商品，无阻断错误。警告 ${warningsCount} 条：\n${warningSummary}${moreWarnings}`
            : `已校验 ${selectedIds.length} 个商品，全部通过！警告 0 条。`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出检查失败");
    } finally {
      setBulkLoading(null);
    }
  }

  async function handleBulkExport(): Promise<void> {
    if (!selectedIds.length) {
      setNotice("请先选择商品");
      return;
    }
    setBulkLoading("导出 Excel");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`${apiBaseUrl}/api/exports/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ product_task_ids: selectedIds }),
      });
      const result = (await response.json()) as { batch_no?: string; detail?: string };
      if (!response.ok) {
        // Try to parse detailed error message
        const detailStr = result.detail || "";
        if (detailStr.includes("缺少必填字段")) {
          // Extract task-specific errors from the message
          const taskErrors = detailStr.split("；").filter(Boolean);
          const errorSummary = taskErrors.slice(0, 10).join("\n");
          const moreText = taskErrors.length > 10 ? `\n...还有 ${taskErrors.length - 10} 个商品有错误` : "";
          throw new Error(`导出失败，以下商品缺少必填字段：\n${errorSummary}${moreText}\n\n提示：请先完善商品信息（标题、类目、规格、尺寸图等）后再导出。`);
        }
        throw new Error(result.detail || `HTTP ${response.status}`);
      }
      setNotice(`已提交 ${selectedIds.length} 个商品导出，批次号：${result.batch_no || "-"}`);
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出 Excel 失败");
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

  async function applyTemplateToSelected(): Promise<void> {
    if (!selectedIds.length) {
      setNotice("请先选择商品");
      return;
    }
    const ruleId = templateRuleId === "" ? selectedRuleId : templateRuleId;
    if (ruleId === "") {
      setNotice("请先选择模板规则");
      return;
    }
    setBulkLoading("引用模板");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`${apiBaseUrl}/api/product-tasks/batch/apply-template`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          product_task_ids: selectedIds,
          default_rule_id: ruleId,
          overwrite_mode: templateOverwriteMode,
        }),
      });
      const result = (await response.json()) as { detail?: string; applied_count?: number; missing_task_ids?: number[] };
      if (!response.ok) throw new Error(result.detail || `HTTP ${response.status}`);
      const missing = (result.missing_task_ids || []).length;
      const appliedCount = Number(result.applied_count || 0);
      const modeLabel =
        templateOverwriteMode === "fill_empty"
          ? "只填空"
          : templateOverwriteMode === "force_overwrite"
            ? "强制覆盖"
            : "覆盖系统值";
      setNotice(`已为 ${appliedCount} 个商品应用模板（${modeLabel}）${missing ? `，${missing} 个任务不存在` : ""}。`);
      setTemplateModalOpen(false);
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "引用模板失败");
    } finally {
      setBulkLoading(null);
    }
  }

  async function applyBatchFieldPatch(): Promise<void> {
    if (!selectedIds.length) {
      setNotice("请先选择商品");
      return;
    }
    const fieldRows = nonEmptyPairs(batchEditFieldRows);
    if (!fieldRows.length) {
      setNotice("请至少填写一组字段");
      return;
    }
    const fields = fieldRows.reduce<Record<string, string>>((acc, item) => {
      acc[item.key] = item.value;
      return acc;
    }, {});
    setBulkLoading("批量编辑");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`${apiBaseUrl}/api/product-tasks/batch/patch-export-fields`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          product_task_ids: selectedIds,
          fields,
        }),
      });
      const result = (await response.json()) as { detail?: string; patched_count?: number; missing_task_ids?: number[] };
      if (!response.ok) throw new Error(result.detail || `HTTP ${response.status}`);
      const missingCount = (result.missing_task_ids || []).length;
      if (missingCount > 0) {
        setNotice(`已为 ${result.patched_count || 0} 个商品批量更新 ${fieldRows.length} 个字段，${missingCount} 个任务不存在。`);
      } else {
        setNotice(`已为 ${selectedIds.length} 个商品批量更新 ${fieldRows.length} 个字段。`);
      }
      setBatchEditModalOpen(false);
      setBatchEditFieldRows([{ id: makeDraftId("batch_edit"), key: "", value: "" }]);
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "批量编辑失败");
    } finally {
      setBulkLoading(null);
    }
  }

  async function saveBatchFieldsAsTemplate(): Promise<void> {
    const fieldRows = nonEmptyPairs(batchEditFieldRows);
    if (!fieldRows.length) {
      setNotice("请先填写要保存的字段");
      return;
    }
    if (!batchTemplateName.trim()) {
      setNotice("请填写模板名称");
      return;
    }
    const values = fieldRows.reduce<Record<string, string>>((acc, item) => {
      acc[item.key] = item.value;
      return acc;
    }, {});

    setBulkLoading("保存模板");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`${apiBaseUrl}/api/default-rules`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: batchTemplateName.trim(),
          rule_type: "category_default",
          scope: "category",
          platform: "Temu",
          site: "美国站",
          fulfillment_mode: "半托",
          category_path: null,
          priority: 100,
          enabled: true,
          conditions_json: {
            adapter_key: "miaoshou_temu_non_apparel",
            template_kind: batchTemplateKind,
          },
          match_json: {},
          values_json: values,
          output_json: values,
        }),
      });
      const result = (await response.json()) as { detail?: string };
      if (!response.ok) throw new Error(result.detail || `HTTP ${response.status}`);
      setNotice(`已保存模板「${batchTemplateName.trim()}」`);
      setBatchEditModalOpen(false);
      const items = await listEnabledDefaultRules();
      setDefaultRules(items);
      const saved = items.find((item) => item.name === batchTemplateName.trim());
      if (saved) {
        setSelectedRuleId(saved.id);
        setTemplateRuleId(saved.id);
      } else {
        setSelectedRuleId((current) => current || items[0]?.id || "");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存模板失败");
    } finally {
      setBulkLoading(null);
    }
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

          <TaskFilters
            isLogsRoute={isLogsRoute}
            keyword={keyword}
            status={status}
            categoryStatus={categoryStatus}
            exportStatus={exportStatus}
            exceptionOnly={exceptionOnly}
            lowConfidenceOnly={lowConfidenceOnly}
            onKeywordChange={setKeyword}
            onStatusChange={(value) => setStatus(value as TaskMainStatus | "")}
            onCategoryStatusChange={(value) => setCategoryStatus(value as CategoryStatus | "")}
            onExportStatusChange={(value) => setExportStatus(value as ExportStatus | "")}
            onToggleExceptionOnly={() => setExceptionOnly((value) => !value)}
            onToggleLowConfidenceOnly={() => setLowConfidenceOnly((value) => !value)}
          />

          {currentError ? <div className="mt-4 text-sm text-rose-600">加载失败：{currentError}</div> : null}
          {notice ? <div className="mt-4 text-sm text-emerald-700">{notice}</div> : null}
          {!isLogsRoute ? (
            <div className="mt-4 rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              已选择 {selectedIds.length} 个商品任务
              {bulkLoading ? <span className="ml-2 text-slate-500">当前操作：{bulkLoading}</span> : null}
            </div>
          ) : (
            <div className="mt-4 rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              日志台只保留排查相关筛选。批量上架、导出、删除请回到上架加工工作台执行。
            </div>
          )}

          {!isLogsRoute && selectedIds.length ? (
            <div className="mt-4 space-y-4 rounded-[22px] border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">批量操作面板</div>
                  <div className="mt-1 text-xs text-slate-500">先补上架默认值，再生成上架草稿，最后检查可导出性并导出 Excel。</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setTemplateRuleId(selectedRuleId);
                      setTemplateKindFilter("all");
                      setTemplateOnlyMiaoshou(true);
                      setTemplateModalOpen(true);
                    }}
                    className="h-10 rounded-full border border-slate-300 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    引用模板
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBatchEditFieldRows([{ id: makeDraftId("batch_edit"), key: "", value: "" }]);
                      setBatchTemplateName("批量编辑模板");
                      setBatchTemplateKind("product_template");
                      setBatchEditModalOpen(true);
                    }}
                    className="h-10 rounded-full border border-slate-300 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    批量编辑
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
                    当前选中 {selectedIds.length} 条
                  </div>
                  <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
                    草稿已生成 {selectedDraftCount}/{selectedIds.length}
                  </div>
                  <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
                    导出已就绪 {selectedExportReadyCount}/{selectedIds.length}
                  </div>
                  <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
                    类目待确认 {selectedLowConfidenceCount}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <section className="rounded-[18px] border border-slate-200 bg-white p-4">
                  <div className="text-sm font-semibold text-slate-900">内容处理</div>
                  <div className="mt-1 text-xs text-slate-500">先处理 AI、标题、类目和轮播图。</div>
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
                  <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_auto]">
                    <SearchableCategoryInput
                      value={bulkCategoryValue}
                      onChange={setBulkCategoryValue}
                      onSelect={setBulkCategoryValue}
                      allOptions={categoryOptions}
                      preferredPaths={selectedIds.flatMap((taskId) => {
                        const detail = rowMeta[taskId]?.detail;
                        return [
                          ...(detail?.ai?.category_top3 || []).map((candidate) => candidate.path),
                          detail?.selected_category_id || "",
                          detail?.ai?.category_best_path || "",
                        ].filter(Boolean);
                      })}
                      className="min-w-0"
                      minHeight={44}
                      placeholder="输入完整类目路径，应用到当前选中商品"
                    />
                    <button
                      type="button"
                      onClick={() => void applyBulkCategory()}
                      disabled={bulkLoading !== null}
                      className="h-11 rounded-full border border-slate-900 bg-slate-900 px-4 text-sm text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      批量套类目
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void runBulkAction("重新生成 AI 结果", runAi, "已提交 {count} 个商品的 AI 处理任务。")}
                      disabled={bulkLoading !== null}
                      className="h-11 rounded-full border border-slate-300 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      重新生成 AI 结果
                    </button>
                    <button
                      type="button"
                      onClick={() => void runBulkAction("批量生成标题", generateTitles, "已提交 {count} 个商品的标题生成任务。")}
                      disabled={bulkLoading !== null}
                      className="h-11 rounded-full border border-slate-300 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      批量生成标题
                    </button>
                    <button
                      type="button"
                      onClick={() => void applyBulkGenerateFourGrid()}
                      disabled={bulkLoading !== null}
                      className="h-11 rounded-full border border-slate-300 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      批量生成轮播图
                    </button>
                  </div>
                </section>

                <section className="rounded-[18px] border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">上架默认值</div>
                      <div className="mt-1 text-xs text-slate-500">批量补齐公共字段，并支持动态附加模板字段。</div>
                    </div>
                    <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
                      {selectedRule?.name || "未指定规则"}
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <div>
                      <label className="block text-xs text-slate-600">默认规则</label>
                      <select
                        value={selectedRuleId}
                        onChange={(event) => setSelectedRuleId(event.target.value ? Number(event.target.value) : "")}
                        className="mt-1 h-10 w-full rounded-[14px] border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                      >
                        <option value="">不指定，按系统自动匹配</option>
                        {defaultRules.map((item) => (
                          <option key={item.id} value={item.id}>{item.name}</option>
                        ))}
                      </select>
                      <div className="mt-1 text-[11px] text-slate-500">{selectedRule?.category_path || "未指定时按系统自动匹配"}</div>
                    </div>
                    <FormSelect label="经营站点" value={bulkSite} onChange={setBulkSite} options={["美国站", "英国站", "德国站", "法国站", "意大利站", "西班牙站", "日本站", "澳大利亚站"]} />
                    <FormSelect label="发货仓" value={bulkWarehouse} onChange={setBulkWarehouse} options={["美国-饰品", "美国-普货", "英国-饰品", "英国-普货", "德国-饰品", "德国-普货"]} />
                    <FormSelect label="承诺发货时效" value={bulkLeadTime} onChange={setBulkLeadTime} options={["2个工作日内发货", "3个工作日内发货", "5个工作日内发货", "7个工作日内发货"]} />
                    <FormSelect label="素材语言" value={bulkMaterialLang} onChange={setBulkMaterialLang} options={["英语", "英语+德语", "英语+法语", "英语+西班牙语", "多语言"]} />
                    <FormInput label="商品产地" value={bulkOriginCountry} onChange={setBulkOriginCountry} placeholder="中国" />
                    <FormInput label="产地省份" value={bulkOriginProvince} onChange={setBulkOriginProvince} placeholder="广东省" />
                    <FormInput label="币种" value={bulkCurrency} onChange={setBulkCurrency} placeholder="CNY" />
                    <FormInput label="默认库存" value={bulkDefaultStock} onChange={setBulkDefaultStock} placeholder="100" type="number" />
                    <FormInput label="申报价格-美国站" value={bulkDeclaredPrice} onChange={setBulkDeclaredPrice} placeholder="按需批量覆盖" type="number" />
                    <FormInput label="最长边（cm）" value={bulkPackageLength} onChange={setBulkPackageLength} placeholder="10" type="number" />
                    <FormInput label="次长边（cm）" value={bulkPackageWidth} onChange={setBulkPackageWidth} placeholder="8" type="number" />
                    <FormInput label="最短边（cm）" value={bulkPackageHeight} onChange={setBulkPackageHeight} placeholder="2" type="number" />
                    <FormInput label="重量（g）" value={bulkPackageWeight} onChange={setBulkPackageWeight} placeholder="30" type="number" />
                  </div>
                  <div className="mt-4 rounded-[16px] border border-dashed border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs font-medium text-slate-700">动态附加字段</div>
                    <div className="mt-1 text-[11px] text-slate-500">适合补主体材质、镀层、主题1、营销节日1等模板字段。</div>
                    <div className="mt-3 space-y-2">
                      {bulkDynamicFields.map((row) => (
                        <div key={row.id} className="grid gap-2 md:grid-cols-[220px_1fr_auto]">
                          <input
                            value={row.key}
                            onChange={(event) => patchBulkDynamicField(row.id, { key: event.target.value })}
                            placeholder="字段名，如 主体材质"
                            className="h-10 rounded-[14px] border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                          />
                          <input
                            value={row.value}
                            onChange={(event) => patchBulkDynamicField(row.id, { value: event.target.value })}
                            placeholder="字段值，如 合金"
                            className="h-10 rounded-[14px] border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                          />
                          <button
                            type="button"
                            onClick={() => setBulkDynamicFields((rows) => rows.length > 1 ? rows.filter((item) => item.id !== row.id) : rows)}
                            className="h-10 rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                            disabled={bulkDynamicFields.length <= 1}
                          >
                            删除
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => setBulkDynamicFields((rows) => [...rows, { id: makeDraftId("bulk_attr"), key: "", value: "" }])}
                      className="mt-3 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      添加字段
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleBulkApplyDefaults()}
                      disabled={bulkLoading !== null}
                      className="h-11 rounded-full border border-slate-900 bg-slate-900 px-4 text-sm text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      应用默认值并生成上架草稿
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleBulkValidate()}
                      disabled={bulkLoading !== null}
                      className="h-11 rounded-full border border-slate-300 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      检查可导出性
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleBulkExport()}
                      disabled={bulkLoading !== null}
                      className="h-11 rounded-full border border-slate-300 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      导出 Excel
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
                </section>
              </div>
            </div>
          ) : null}

          {templateModalOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
              <div className="w-full max-w-xl rounded-[20px] border border-slate-200 bg-white p-5 shadow-2xl">
                <div className="text-base font-semibold text-slate-900">引用模板</div>
                <div className="mt-1 text-xs text-slate-500">将默认值模板批量应用到当前选中商品任务。</div>
                <div className="mt-4">
                  <label className="block text-xs text-slate-600">模板类型</label>
                  <select
                    value={templateKindFilter}
                    onChange={(event) => setTemplateKindFilter(event.target.value as typeof templateKindFilter)}
                    className="mt-1 h-11 w-full rounded-[14px] border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                  >
                    <option value="all">全部模板类型</option>
                    <option value="product_template">产品模板</option>
                    <option value="sku_template">SKU模板</option>
                    <option value="shipping_template">发货模板</option>
                    <option value="price_dimension_template">价格尺寸模板</option>
                    <option value="image_video_template">图片视频模板</option>
                    <option value="sensitive_template">敏感属性模板</option>
                    <option value="packaging_template">包装模板</option>
                  </select>
                </div>
                <label className="mt-3 flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={templateOnlyMiaoshou}
                    onChange={(event) => setTemplateOnlyMiaoshou(event.target.checked)}
                  />
                  仅显示妙手非服饰模板
                </label>
                <div className="mt-3">
                  <label className="block text-xs text-slate-600">模板规则</label>
                  <select
                    value={templateRuleId}
                    onChange={(event) => setTemplateRuleId(event.target.value ? Number(event.target.value) : "")}
                    className="mt-1 h-11 w-full rounded-[14px] border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                  >
                    <option value="">请选择规则</option>
                    {filteredTemplateRules.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </div>
                <div className="mt-3">
                  <label className="block text-xs text-slate-600">覆盖策略</label>
                  <select
                    value={templateOverwriteMode}
                    onChange={(event) => setTemplateOverwriteMode(event.target.value as typeof templateOverwriteMode)}
                    className="mt-1 h-11 w-full rounded-[14px] border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                  >
                    <option value="overwrite_system">覆盖系统值（保留手工编辑）</option>
                    <option value="fill_empty">只填空（已有值不变）</option>
                    <option value="force_overwrite">强制覆盖（包括手工编辑）</option>
                  </select>
                </div>
                <div className="mt-5 flex justify-end gap-2">
                  <button type="button" onClick={() => setTemplateModalOpen(false)} className="h-10 rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50">取消</button>
                  <button type="button" onClick={() => void applyTemplateToSelected()} disabled={bulkLoading !== null} className="h-10 rounded-full border border-slate-900 bg-slate-900 px-4 text-sm text-white hover:bg-slate-800 disabled:opacity-50">应用模板</button>
                </div>
              </div>
            </div>
          ) : null}

          {batchEditModalOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
              <div className="w-full max-w-xl rounded-[20px] border border-slate-200 bg-white p-5 shadow-2xl">
                <div className="text-base font-semibold text-slate-900">批量编辑数据</div>
                <div className="mt-1 text-xs text-slate-500">按字段名批量写入导出草稿，适合临时批量覆盖。</div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  <div className="rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                    影响任务数：{selectedIds.length}
                  </div>
                  <div className="rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                    本次字段数：{batchEditFilledCount}
                  </div>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-[1fr_220px]">
                  <FormInput label="模板名称（可选保存）" value={batchTemplateName} onChange={setBatchTemplateName} placeholder="例如：妙手SKU通用模板" />
                  <div>
                    <label className="block text-xs text-slate-600">模板类型</label>
                    <select
                      value={batchTemplateKind}
                      onChange={(event) => setBatchTemplateKind(event.target.value as typeof batchTemplateKind)}
                      className="mt-1 h-10 w-full rounded-[14px] border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                    >
                      <option value="product_template">产品模板</option>
                      <option value="sku_template">SKU模板</option>
                      <option value="shipping_template">发货模板</option>
                      <option value="price_dimension_template">价格尺寸模板</option>
                      <option value="image_video_template">图片视频模板</option>
                      <option value="sensitive_template">敏感属性模板</option>
                      <option value="packaging_template">包装模板</option>
                    </select>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-[220px_1fr]">
                  <div className="rounded-[14px] border border-slate-200 bg-slate-50 p-2">
                    <div className="mb-2 text-xs font-medium text-slate-600">字段菜单</div>
                    <div className="space-y-2">
                      {quickBatchFieldGroups.map((group) => (
                        <div key={group.group}>
                          <div className="px-1 text-[11px] font-medium text-slate-500">{group.group}</div>
                          <div className="mt-1 space-y-1">
                            {group.items.map((item) => (
                              <button
                                key={item.key}
                                type="button"
                                onClick={() => {
                                  setBatchEditFieldRows((rows) => {
                                    const exists = rows.some((row) => row.key === item.key);
                                    if (exists) return rows;
                                    const firstEmptyIndex = rows.findIndex((row) => !row.key.trim());
                                    if (firstEmptyIndex >= 0) {
                                      return rows.map((row, idx) => (idx === firstEmptyIndex ? { ...row, key: item.key } : row));
                                    }
                                    return [...rows, { id: makeDraftId("batch_edit"), key: item.key, value: "" }];
                                  });
                                }}
                                className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-white"
                              >
                                {item.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-2">
                    {batchEditFieldRows.map((row) => (
                      <div key={row.id} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                        <input
                          value={row.key}
                          onChange={(event) =>
                            setBatchEditFieldRows((rows) =>
                              rows.map((item) => (item.id === row.id ? { ...item, key: event.target.value } : item)),
                            )
                          }
                          placeholder="字段名，例如：*产地"
                          className="h-10 rounded-[14px] border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                        />
                        <input
                          value={row.value}
                          onChange={(event) =>
                            setBatchEditFieldRows((rows) =>
                              rows.map((item) => (item.id === row.id ? { ...item, value: event.target.value } : item)),
                            )
                          }
                          placeholder="字段值，例如：中国-广东省"
                          className="h-10 rounded-[14px] border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setBatchEditFieldRows((rows) =>
                              rows.length > 1 ? rows.filter((item) => item.id !== row.id) : rows,
                            )
                          }
                          className="h-10 rounded-full border border-slate-200 bg-white px-3 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                          disabled={batchEditFieldRows.length <= 1}
                        >
                          删除
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        setBatchEditFieldRows((rows) => [...rows, { id: makeDraftId("batch_edit"), key: "", value: "" }])
                      }
                      className="mt-1 h-9 w-fit rounded-full border border-slate-300 bg-white px-4 text-xs text-slate-700 hover:bg-slate-50"
                    >
                      添加字段
                    </button>
                  </div>
                </div>
                <div className="mt-5 flex justify-end gap-2">
                  <button type="button" onClick={() => setBatchEditModalOpen(false)} className="h-10 rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50">取消</button>
                  <button type="button" onClick={() => void saveBatchFieldsAsTemplate()} disabled={bulkLoading !== null} className="h-10 rounded-full border border-slate-300 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">另存为模板</button>
                  <button type="button" onClick={() => void applyBatchFieldPatch()} disabled={bulkLoading !== null} className="h-10 rounded-full border border-slate-900 bg-slate-900 px-4 text-sm text-white hover:bg-slate-800 disabled:opacity-50">保存修改</button>
                </div>
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
              taskThumbnail={taskThumbnail}
              displayTimelineEvent={displayTimelineEvent}
              logEventStatusColor={logEventStatusColor}
              formatDateTime={formatDateTime}
              getGenerationModeLabel={getGenerationModeLabel}
              normalizeGenerationMode={normalizeGenerationMode}
              getLatestImageJobSummaries={getLatestImageJobSummaries}
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
              categoryOptions={categoryOptions}
              rowLoading={rowLoading}
              onQuickTitleChange={(taskId, value) =>
                setQuickTitleDrafts((prev) => ({ ...prev, [taskId]: value }))
              }
              onQuickCategoryChange={(taskId, value) =>
                setQuickCategoryDrafts((prev) => ({ ...prev, [taskId]: value }))
              }
              onRunAi={(taskId) => void runRowAction(taskId, "run-ai", () => runAi(taskId))}
              onGenerateTitles={(taskId) => void runRowAction(taskId, "gen-title", () => generateTitles(taskId))}
              onSaveTitle={(taskId) => void runRowAction(taskId, "save-title", () => saveQuickTitle(taskId))}
              onSaveCategory={(taskId) => void runRowAction(taskId, "save-category", () => saveQuickCategory(taskId))}
              onGenerateFourGrid={(taskId) => void runRowAction(taskId, "gen-4grid", () => generateFourGrid(taskId))}
              onOpenDrawer={(taskId) => void openDrawer(taskId)}
              onDelete={(taskId) => void handleDeleteOne(taskId)}
              onOpenPromptEditor={openPromptEditor}
              formatDateTime={formatDateTime}
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

      <TaskDrawer
        open={drawerOpen}
        isLogsRoute={isLogsRoute}
        activeTaskId={activeTaskId}
        taskTitle={taskDetail?.title || ""}
        loading={drawerLoading}
        syncing={drawerSyncing}
        error={drawerError}
        size={drawerSize}
        tab={drawerTab}
        onClose={closeDrawer}
        onSync={syncDrawerAndTable}
        onSizeChange={setDrawerSize}
        onTabChange={setDrawerTab}
        content={
          <DrawerTabContent
            tab={drawerTab}
            task={taskDetail}
            raw={rawDetail}
            timeline={activeTaskId ? timelineMap[activeTaskId] || null : null}
            onRefresh={activeTaskId ? syncDrawerAndTable : undefined}
            isLogsRoute={isLogsRoute}
            onOpenPromptEditor={openPromptEditor}
          />
        }
      />
      <PromptEditorModal
        config={promptEditor}
        onClose={() => setPromptEditor(null)}
        onRerunPrompt={rerunTaskPrompts}
      />
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

function ImagesTab({
  task,
  raw,
  onRefresh,
  onOpenPromptEditor,
}: {
  task: ProductTaskDetail;
  raw: RawProductDetail | null;
  onRefresh?: (() => Promise<void>) | undefined;
  onOpenPromptEditor: (fieldLabel: string, promptTypes: string[]) => void;
}) {
  const {
    assets,
    loading,
    error: assetLoadError,
    jobStatus,
    setJobStatus,
    loadAssets,
    pollJob,
  } = useImageAssets(task.id);
  const [opError, setOpError] = useState<string | null>(null);
  const [dimensionJson, setDimensionJson] = useState<Record<string, unknown> | null>(null);
  const [lightbox, setLightbox] = useState<LightboxImage | null>(null);
  const [selectedTargetSlot, setSelectedTargetSlot] = useState<string>("carousel_1");
  const [assigning, setAssigning] = useState(false);
  const [draggedSlot, setDraggedSlot] = useState<string | null>(null);
  const [busySlots, setBusySlots] = useState<Record<string, string>>({});
  const [removedSlots, setRemovedSlots] = useState<Record<string, boolean>>({});
  const [skuCodeDraft, setSkuCodeDraft] = useState("");
  const [skuTextDraft, setSkuTextDraft] = useState("");
  const [skuPropsDraft, setSkuPropsDraft] = useState<RawSkuPropItem[]>([]);
  const [skuSaving, setSkuSaving] = useState(false);
  const initialImageSettings = normalizeExportImageSettings(task.export_image_settings_json);
  const [insertSizeChartInCarousel, setInsertSizeChartInCarousel] = useState(initialImageSettings.insert_size_chart_in_carousel);
  const [sizeChartPosition, setSizeChartPosition] = useState(initialImageSettings.size_chart_position);
  const [imageSettingsSaving, setImageSettingsSaving] = useState(false);

  useEffect(() => {
    if (assetLoadError) setOpError(assetLoadError);
  }, [assetLoadError]);

  useEffect(() => {
    setRemovedSlots({});
    setBusySlots({});
  }, [task.id]);

  useEffect(() => {
    setSkuCodeDraft(raw?.platform_sku || task.platform_sku || "");
    setSkuTextDraft(raw?.sku_text || "");
    setSkuPropsDraft(normalizeRawSkuProps(raw?.sku_props));
  }, [raw?.id, raw?.platform_sku, raw?.sku_text, raw?.sku_props, task.platform_sku]);

  useEffect(() => {
    const next = normalizeExportImageSettings(task.export_image_settings_json);
    setInsertSizeChartInCarousel(next.insert_size_chart_in_carousel);
    setSizeChartPosition(next.size_chart_position);
  }, [task.id, task.export_image_settings_json]);

  function markSlotsBusy(slots: string[], label: string): () => void {
    setBusySlots((prev) => {
      const next = { ...prev };
      slots.forEach((slot) => {
        next[slot] = label;
      });
      return next;
    });
    return () => {
      setBusySlots((prev) => {
        const next = { ...prev };
        slots.forEach((slot) => {
          delete next[slot];
        });
        return next;
      });
    };
  }

  async function generateCarousel4Grid(): Promise<void> {
    setOpError(null);
    setJobStatus(null);
    const clearBusy = markSlotsBusy(["carousel_4grid", "carousel_1", "carousel_2", "carousel_3", "carousel_4"], "四宫格生成中");
    try {
      const data = await generateCarousel4GridApi(task.id);
      const jobId = data.job_ids?.[0];
      if (jobId) await pollJob(jobId, onRefresh);
    } catch (err) {
      setOpError(err instanceof Error ? err.message : "生成失败");
    } finally {
      clearBusy();
    }
  }

  async function generateSingle(slot: string): Promise<void> {
    setOpError(null);
    setJobStatus(null);
    const clearBusy = markSlotsBusy([slot], "AI 生成中");
    try {
      const data = await generateSingleImageApi(task.id, slot);
      if (data.job_id) await pollJob(data.job_id, onRefresh);
    } catch (err) {
      setOpError(err instanceof Error ? err.message : "生成失败");
    } finally {
      clearBusy();
    }
  }

  async function generateSellingImages(): Promise<void> {
    setOpError(null);
    setJobStatus(null);
    const clearBusy = markSlotsBusy(["carousel_1", "carousel_2", "carousel_3", "carousel_4"], "批量生成中");
    try {
      const data = await generateSellingImagesApi(task.id);
      setJobStatus(`卖点主图已提交 ${(data.job_ids || []).length} 个任务`);
      for (const jobId of data.job_ids || []) {
        await pollJob(jobId, onRefresh);
      }
    } catch (err) {
      setOpError(err instanceof Error ? err.message : "卖点主图生成失败");
    } finally {
      clearBusy();
    }
  }

  async function generateSkuImage(): Promise<void> {
    setOpError(null);
    setJobStatus(null);
    const clearBusy = markSlotsBusy(["sku_image"], "SKU 图生成中");
    try {
      const data = await generateSkuImageApi(task.id);
      if (data.job_id) await pollJob(data.job_id, onRefresh);
    } catch (err) {
      setOpError(err instanceof Error ? err.message : "SKU图生成失败");
    } finally {
      clearBusy();
    }
  }

  async function generateSizeImage(): Promise<void> {
    setOpError(null);
    setJobStatus(null);
    const clearBusy = markSlotsBusy(["size_chart"], "尺寸图生成中");
    try {
      const data = await generateSizeImageApi(task.id);
      if (data.job_id) await pollJob(data.job_id, onRefresh);
    } catch (err) {
      setOpError(err instanceof Error ? err.message : "尺寸图生成失败");
    } finally {
      clearBusy();
    }
  }

  async function setFinal(assetId: number): Promise<void> {
    setOpError(null);
    try {
      await setFinalAssetApi(assetId);
      await loadAssets();
      await onRefresh?.();
    } catch (err) {
      setOpError(err instanceof Error ? err.message : "设置最终图失败");
    }
  }

  async function saveExportImageSettings(next: Required<ExportImageSettings>): Promise<void> {
    setImageSettingsSaving(true);
    setOpError(null);
    try {
      await patchTaskImageSettingsApi(task.id, { export_image_settings_json: next });
      await onRefresh?.();
      setJobStatus(`尺寸图导出位置已保存：${next.insert_size_chart_in_carousel ? `第 ${next.size_chart_position} 张` : "不插入轮播图"}`);
    } catch (err) {
      setOpError(err instanceof Error ? err.message : "保存尺寸图导出位置失败");
    } finally {
      setImageSettingsSaving(false);
    }
  }

  async function regenerate(slot: string, assetId: number): Promise<void> {
    setOpError(null);
    setJobStatus(null);
    const clearBusy = markSlotsBusy([slot], "重生成中");
    try {
      const data = await regenerateAssetApi(assetId);
      if (data.job_id) await pollJob(data.job_id, onRefresh);
    } catch (err) {
      setOpError(err instanceof Error ? err.message : "重生成失败");
    } finally {
      clearBusy();
    }
  }

  async function runDimensionExtract(assetId: number): Promise<void> {
    setOpError(null);
    setDimensionJson(null);
    try {
      const data = await runDimensionExtractApi(task.id, assetId);
      setDimensionJson(data.result || null);
    } catch (err) {
      setOpError(err instanceof Error ? err.message : "尺寸识别失败");
    }
  }

  const carouselSlots = ["carousel_1", "carousel_2", "carousel_3", "carousel_4"] as const;
  const extraCarouselSlots = ["carousel_5", "carousel_6", "carousel_7", "carousel_8"] as const;
  const supportSlots = ["sku_image", "size_chart"] as const;
  const selectedCarouselAssets = carouselSlots
    .map((slot) => ({ slot, asset: latestAsset(assets[slot]) }))
    .filter((item) => item.asset?.public_url);
  const selectedExtraCarouselAssets = extraCarouselSlots
    .map((slot) => ({ slot, asset: latestAsset(assets[slot]) }))
    .filter((item) => item.asset?.public_url);
  const sizeChartExportAsset = latestAsset(assets.size_chart);
  const baseCarouselExportAssets: { slot: string; asset: ProductAsset | null }[] = [
    ...selectedCarouselAssets,
    ...selectedExtraCarouselAssets,
  ];
  const arrangedCarouselExportAssets = insertItemAtPosition(
    baseCarouselExportAssets,
    sizeChartExportAsset?.public_url ? { slot: "size_chart", asset: sizeChartExportAsset } : null,
    insertSizeChartInCarousel,
    sizeChartPosition,
  );
  const carouselExportValue = arrangedCarouselExportAssets
    .map((item) => item.asset?.public_url)
    .filter(Boolean)
    .join(",");
  const allAssets = Object.values(assets).flat();
  const rawCarouselImages = rawCarouselSequence(raw);
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

  function getRawReferenceImage(slot: string): string | null {
    if (removedSlots[slot] || slotHasRemovalMarker(assets, slot)) return null;
    if (slot.startsWith("carousel_")) {
      const index = Number(slot.split("_")[1]) - 1;
      return rawCarouselImages[index] || null;
    }
    if (slot === "sku_image") return raw?.sku_images?.[0] || null;
    if (slot === "size_chart") return raw?.size_chart_images?.[0] || null;
    return null;
  }

  function getPromptEditorConfig(slot: string): { label: string; promptTypes: string[] } {
    if (slot === "size_chart") {
      return { label: "尺寸图", promptTypes: ["dimension_extract_from_image", "image_prompt_dimension"] };
    }
    if (slot === "sku_image") {
      return { label: "SKU 图", promptTypes: ["product_info_from_screenshot", "image_prompt_main"] };
    }
    if (slot === "carousel_4grid") {
      return { label: "四宫格", promptTypes: ["image_prompt_carousel_4grid", "title_package"] };
    }
    if (slot === "carousel_1") {
      return { label: "轮播1（主图）", promptTypes: ["image_prompt_carousel_1", "image_prompt_main"] };
    }
    if (slot === "carousel_2") {
      return { label: "轮播2（细节）", promptTypes: ["image_prompt_carousel_2"] };
    }
    if (slot === "carousel_3") {
      return { label: "轮播3（场景）", promptTypes: ["image_prompt_carousel_3"] };
    }
    if (slot === "carousel_4") {
      return { label: "轮播4（卖点）", promptTypes: ["image_prompt_carousel_4"] };
    }
    if (slot.startsWith("carousel_")) {
      return { label: slotLabel(slot), promptTypes: ["image_prompt_carousel_4grid"] };
    }
    if (slot === "main") {
      return { label: "主图", promptTypes: ["image_prompt_main"] };
    }
    return { label: slotLabel(slot), promptTypes: ["title_package"] };
  }

  function focusRawOverview(slot: string): void {
    setSelectedTargetSlot(slot);
    if (typeof document !== "undefined") {
      document.getElementById("raw-source-overview")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function getFinalAssetForSlot(slot: string): ProductAsset | null {
    return latestAsset(assets[slot]);
  }

  function patchSkuPropDraft(index: number, patch: Partial<RawSkuPropItem>): void {
    setSkuPropsDraft((rows) => rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  function addSkuPropDraft(): void {
    setSkuPropsDraft((rows) => [...rows, makeEmptyRawSkuProp(rows.length, rows.length)]);
  }

  function removeSkuPropDraft(index: number): void {
    setSkuPropsDraft((rows) => rows.filter((_, rowIndex) => rowIndex !== index));
  }

  async function assignCandidateToSlot(payload: {
    targetSlot: string;
    sourceAssetId?: number;
    sourceUrl?: string;
    imageDataUrl?: string;
  }, options: { syncTable?: boolean; showStatus?: boolean } = {}): Promise<void> {
    const syncTable = options.syncTable ?? true;
    const showStatus = options.showStatus ?? true;
    const clearBusy = markSlotsBusy([payload.targetSlot], "替换图片中");
    setAssigning(true);
    setOpError(null);
    try {
      await assignImageToSlotApi(task.id, payload);
      await loadAssets();
      if (syncTable) await onRefresh?.();
      setRemovedSlots((prev) => ({ ...prev, [payload.targetSlot]: false }));
      if (showStatus) setJobStatus(`已把图片放入 ${slotLabel(payload.targetSlot)}。`);
    } catch (err) {
      setOpError(err instanceof Error ? err.message : "放入图片失败");
    } finally {
      setAssigning(false);
      clearBusy();
    }
  }

  async function syncVisibleCarouselToTable(): Promise<void> {
    setAssigning(true);
    setOpError(null);
    try {
      const slots = [...carouselSlots, ...extraCarouselSlots];
      let createdCount = 0;
      for (const slot of slots) {
        if (getFinalAssetForSlot(slot)?.public_url || removedSlots[slot] || slotHasRemovalMarker(assets, slot)) continue;
        const rawImage = getRawReferenceImage(slot);
        if (!rawImage) continue;
        await assignCandidateToSlot({ targetSlot: slot, sourceUrl: rawImage }, { syncTable: false, showStatus: false });
        createdCount += 1;
      }
      await loadAssets();
      await onRefresh?.();
      setJobStatus(
        createdCount > 0
          ? `已把 ${createdCount} 张原始轮播图写入当前编排，并同步外层表格。`
          : "当前编排已同步外层表格。",
      );
    } catch (err) {
      setOpError(err instanceof Error ? err.message : "同步表格失败");
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
    const clearBusy = markSlotsBusy([slot], "上传中");
    const reader = new FileReader();
    reader.onload = async () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result) {
        clearBusy();
        return;
      }
      await assignCandidateToSlot({ targetSlot: slot, imageDataUrl: result });
      clearBusy();
    };
    reader.onerror = () => clearBusy();
    reader.readAsDataURL(file);
  }

  async function reorderSlots(sourceSlot: string, targetSlot: string): Promise<void> {
    if (!sourceSlot || !targetSlot || sourceSlot === targetSlot) return;
    setAssigning(true);
    setOpError(null);
    try {
      const sourceRaw = getRawReferenceImage(sourceSlot);
      const targetRaw = getRawReferenceImage(targetSlot);
      const sourceAsset = getFinalAssetForSlot(sourceSlot);
      const targetAsset = getFinalAssetForSlot(targetSlot);
      const data = await reorderSlotsApi(task.id, sourceSlot, targetSlot);
      if (data.noop && !sourceAsset && sourceRaw) {
        if (targetAsset?.id) {
          await assignCandidateToSlot({ targetSlot: sourceSlot, sourceAssetId: targetAsset.id }, { syncTable: false, showStatus: false });
        } else if (targetRaw) {
          await assignCandidateToSlot({ targetSlot: sourceSlot, sourceUrl: targetRaw }, { syncTable: false, showStatus: false });
        }
        await assignCandidateToSlot({ targetSlot, sourceUrl: sourceRaw }, { syncTable: false, showStatus: false });
      } else if (sourceAsset && !targetAsset && targetRaw) {
        await assignCandidateToSlot({ targetSlot: sourceSlot, sourceUrl: targetRaw }, { syncTable: false, showStatus: false });
      }
      await loadAssets();
      await onRefresh?.();
      setRemovedSlots((prev) => ({ ...prev, [sourceSlot]: false, [targetSlot]: false }));
      setJobStatus(`已调整 ${slotLabel(sourceSlot)} 和 ${slotLabel(targetSlot)} 的位置。`);
    } catch (err) {
      setOpError(err instanceof Error ? err.message : "调整位置失败");
    } finally {
      setAssigning(false);
      setDraggedSlot(null);
    }
  }

  async function deleteSlotImage(slot: string): Promise<void> {
    const clearBusy = markSlotsBusy([slot], "删除中");
    setAssigning(true);
    setOpError(null);
    try {
      const data = await removeSlotImageApi(task.id, slot);
      await loadAssets();
      await onRefresh?.();
      setRemovedSlots((prev) => {
        const next = { ...prev, [slot]: true };
        for (const item of data.compacted || []) {
          next[item.to_slot] = next[item.from_slot] || false;
          delete next[item.from_slot];
        }
        return next;
      });
      setJobStatus(
        slot.startsWith("carousel_")
          ? `已删除 ${slotLabel(slot)}，并将后续轮播图自动前移。`
          : `已删除 ${slotLabel(slot)}。`,
      );
    } catch (err) {
      setOpError(err instanceof Error ? err.message : "删除图片失败");
    } finally {
      clearBusy();
      setAssigning(false);
    }
  }

  async function saveSkuAttributes(): Promise<void> {
    if (!raw?.id) {
      setOpError("缺少原始商品，无法保存 SKU 属性");
      return;
    }
    setSkuSaving(true);
    setOpError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/raw-products/${raw.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          platform_sku: skuCodeDraft.trim() || null,
          sku_text: skuTextDraft.trim() || null,
          skuProps: normalizeRawSkuProps(skuPropsDraft),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setJobStatus("SKU 属性已保存并同步。");
      await onRefresh?.();
    } catch (err) {
      setOpError(err instanceof Error ? err.message : "保存 SKU 属性失败");
    } finally {
      setSkuSaving(false);
    }
  }

  return (
    <ImagesTabView
      opError={opError}
      jobStatus={jobStatus}
      allAssets={allAssets}
      selectedTargetSlot={selectedTargetSlot}
      assigning={assigning}
      loading={loading}
      lightbox={lightbox}
      dimensionJson={dimensionJson}
      raw={raw}
      rawCandidates={rawCandidates}
      aiCandidates={aiCandidates}
      assets={assets}
      carouselSlots={carouselSlots}
      extraCarouselSlots={extraCarouselSlots}
      supportSlots={supportSlots}
      draggedSlot={draggedSlot}
      busySlots={busySlots}
      insertSizeChartInCarousel={insertSizeChartInCarousel}
      sizeChartPosition={sizeChartPosition}
      imageSettingsSaving={imageSettingsSaving}
      sizeChartExportAsset={sizeChartExportAsset}
      arrangedCarouselExportAssets={arrangedCarouselExportAssets}
      carouselExportValue={carouselExportValue}
      skuCodeDraft={skuCodeDraft}
      skuTextDraft={skuTextDraft}
      skuPropsDraft={skuPropsDraft}
      skuSaving={skuSaving}
      onCloseLightbox={() => setLightbox(null)}
      onSelectTargetSlot={setSelectedTargetSlot}
      onGenerateCarousel4Grid={() => void generateCarousel4Grid()}
      onGenerateSellingImages={() => void generateSellingImages()}
      onGenerateSkuImage={() => void generateSkuImage()}
      onGenerateSizeImage={() => void generateSizeImage()}
      onSyncVisibleCarouselToTable={() => void syncVisibleCarouselToTable()}
      onSetLightbox={setLightbox}
      onSetInsertSizeChartInCarousel={setInsertSizeChartInCarousel}
      onSetSizeChartPosition={setSizeChartPosition}
      onSaveExportImageSettings={(next) => void saveExportImageSettings(next)}
      onPatchSkuCodeDraft={setSkuCodeDraft}
      onPatchSkuTextDraft={setSkuTextDraft}
      onPatchSkuPropDraft={patchSkuPropDraft}
      onAddSkuPropDraft={addSkuPropDraft}
      onRemoveSkuPropDraft={removeSkuPropDraft}
      onSaveSkuAttributes={() => void saveSkuAttributes()}
      onHandleUploadToSelectedSlot={(file) => void handleUploadToSelectedSlot(file)}
      onAssignCandidateToSlot={(payload) => void assignCandidateToSlot(payload)}
      onUploadToSlot={(slot, file) => void uploadToSlot(slot, file)}
      onReorderSlots={(sourceSlot, targetSlot) => void reorderSlots(sourceSlot, targetSlot)}
      onSetDraggedSlot={setDraggedSlot}
      onFocusRawOverview={focusRawOverview}
      onGenerateSingle={(slot) => void generateSingle(slot)}
      onSetFinal={(assetId) => void setFinal(assetId)}
      onRegenerate={(slot, assetId) => void regenerate(slot, assetId)}
      onDeleteSlotImage={(slot) => void deleteSlotImage(slot)}
      onRunDimensionExtract={(assetId) => void runDimensionExtract(assetId)}
      onOpenPromptEditor={(slot) => {
        const config = getPromptEditorConfig(slot);
        onOpenPromptEditor(config.label, config.promptTypes);
      }}
      slotLabel={slotLabel}
      getRawReferenceImage={getRawReferenceImage}
    />
  );
}

function DrawerTabContent({
  tab,
  task,
  raw,
  timeline,
  onRefresh,
  isLogsRoute,
  onOpenPromptEditor,
}: {
  tab: DrawerTab;
  task: ProductTaskDetail | null;
  raw: RawProductDetail | null;
  timeline: ProductTaskTimelineResponse | null;
  onRefresh?: (() => Promise<void>) | undefined;
  isLogsRoute: boolean;
  onOpenPromptEditor: (fieldLabel: string, promptTypes: string[]) => void;
}) {
  if (!task) {
    return (
      <div className="rounded-[18px] border border-slate-200 bg-white p-5 text-sm text-slate-600">
        未加载任务数据
      </div>
    );
  }

  if (tab === "info") {
    return (
      <InfoTab
        task={task}
        raw={raw}
        timeline={timeline}
        onRefresh={onRefresh}
        isLogsRoute={isLogsRoute}
        formatDateTime={formatDateTime}
        formatJson={formatJson}
        copyTraceEvent={copyTraceEvent}
        getGenerationModeLabel={getGenerationModeLabel}
        buildAiRequestHeaders={buildAiRequestHeaders}
      />
    );
  }

  if (tab === "trace") {
    return <TraceTab task={task} raw={raw} timeline={timeline} isLogsRoute={isLogsRoute} />;
  }

  if (isLogsRoute) {
    return (
      <InfoTab
        task={task}
        raw={raw}
        timeline={timeline}
        onRefresh={onRefresh}
        isLogsRoute={isLogsRoute}
        formatDateTime={formatDateTime}
        formatJson={formatJson}
        copyTraceEvent={copyTraceEvent}
        getGenerationModeLabel={getGenerationModeLabel}
        buildAiRequestHeaders={buildAiRequestHeaders}
      />
    );
  }

  if (tab === "images") {
    return <ImagesTab task={task} raw={raw} onRefresh={onRefresh} onOpenPromptEditor={onOpenPromptEditor} />;
  }

  if (tab === "defaults") {
    return <DefaultsTab task={task} raw={raw} />;
  }

  return <RawDataTab task={task} raw={raw} formatDateTime={formatDateTime} onCopyText={copyText} />;
}

function TraceTab({
  task,
  raw,
  timeline,
  isLogsRoute,
}: {
  task: ProductTaskDetail;
  raw: RawProductDetail | null;
  timeline: ProductTaskTimelineResponse | null;
  isLogsRoute: boolean;
}) {
  const {
    modelEvents,
    codeStepEvents,
    backendEvents,
    normMode,
    categoryOutput,
    categoryQueries,
    categoryCandidates,
    categoryKeywords,
    runtimeFromEvents,
    timelineEventsForDisplay,
    flowPlan,
    totalPromptTokens,
    totalCompletionTokens,
    totalTokens,
    totalEstimatedCost,
    costCurrency,
    aiStepRows,
    defaultChainChecks,
    followupChecks,
    compactImageSummaries,
    compactTimelineEvents,
  } = buildTraceSummary({
    task,
    raw,
    timeline,
    normalizeGenerationMode,
    dedupeCompatAiEvents,
    isModelCallEvent,
    getLatestImageJobSummaries,
    displayTimelineEvent,
  });

  if (isLogsRoute) {
    return (
      <TraceTabLogsView
        task={task}
        raw={raw}
        timeline={timeline}
        normMode={normMode}
        defaultChainChecks={defaultChainChecks}
        followupChecks={followupChecks}
        compactImageSummaries={compactImageSummaries}
        compactTimelineEvents={compactTimelineEvents}
        modelEvents={modelEvents}
        totalTokens={totalTokens}
        totalPromptTokens={totalPromptTokens}
        totalCompletionTokens={totalCompletionTokens}
        totalEstimatedCost={totalEstimatedCost}
        costCurrency={costCurrency}
        codeStepEvents={codeStepEvents}
        formatDateTime={formatDateTime}
        formatJson={formatJson}
        copyTraceEvent={copyTraceEvent}
        statusText={statusText}
        logEventStatusColor={logEventStatusColor}
        modelCallSummary={modelCallSummary}
        isModelCallEvent={isModelCallEvent}
        getGenerationModeLabel={getGenerationModeLabel}
        formatMoney={formatMoney}
        formatInteger={formatInteger}
      />
    );
  }

  return (
    <TraceTabDefaultView
      task={task}
      raw={raw}
      timeline={timeline}
      normMode={normMode}
      categoryOutput={categoryOutput as Record<string, unknown>}
      categoryQueries={categoryQueries}
      categoryCandidates={categoryCandidates as Array<Record<string, unknown>>}
      categoryKeywords={categoryKeywords}
      runtimeFromEvents={runtimeFromEvents as Record<string, unknown>}
      timelineEventsForDisplay={timelineEventsForDisplay}
      flowPlan={flowPlan}
      totalPromptTokens={totalPromptTokens}
      totalCompletionTokens={totalCompletionTokens}
      totalTokens={totalTokens}
      totalEstimatedCost={totalEstimatedCost}
      costCurrency={costCurrency}
      aiStepRows={aiStepRows as Array<Record<string, unknown>>}
      modelEvents={modelEvents}
      backendEvents={backendEvents}
      formatDateTime={formatDateTime}
      formatJson={formatJson}
      copyTraceEvent={copyTraceEvent}
      statusText={statusText}
      statusBadgeColor={statusBadgeColor}
      formatMoney={formatMoney}
      formatInteger={formatInteger}
    />
  );
}

function FormInput({
  label, value, onChange, placeholder, type = "text", caption
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  caption?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-slate-600">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 h-10 w-full rounded-[14px] border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
      />
      {caption ? <div className="mt-1 text-[11px] text-slate-500">{caption}</div> : null}
    </div>
  );
}

function FormSelect({
  label, value, onChange, options, caption
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  caption?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-slate-600">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-10 w-full rounded-[14px] border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt || "（空）"}</option>
        ))}
      </select>
      {caption ? <div className="mt-1 text-[11px] text-slate-500">{caption}</div> : null}
    </div>
  );
}
