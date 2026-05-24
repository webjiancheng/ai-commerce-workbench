"use client";

import { apiBaseUrl } from "@/lib/api";
import { HoverZoomImage } from "@/components/hover-zoom-image";
import { AiPurpose, resolveLocalImageRuntime, resolveLocalTextRuntime } from "@/lib/local-settings";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import Select, { type InputActionMeta, type SingleValue, type StylesConfig } from "react-select";

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
    case "task_only": return "仅创建任务，不使用 AI";
    case "title_only": return "AI 标题 + 类目";
    case "title_and_4grid": return "AI 标题 + 类目 + 四宫格";
    default: return mode;
  }
}

type GenerationMode = "task_only" | "title_only" | "title_and_4grid" | "no_ai" | "title_and_image_prompts" | "full_later";

type ExportImageSettings = {
  insert_size_chart_in_carousel?: boolean;
  size_chart_position?: number;
};

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
    title_cn: string | null;
    title_en: string | null;
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

type RawSkuPropItem = {
  group_name: string;
  option_name: string;
  image_url: string | null;
  hint_text?: string | null;
  group_index: number;
  option_index: number;
  selected?: boolean;
};

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

function buildSpecTypeFromRawSkuProps(items: RawSkuPropItem[] | null | undefined): string {
  const groups = Array.from(
    new Set(
      normalizeRawSkuProps(items)
        .map((item) => item.group_name)
        .filter(Boolean),
    ),
  );
  if (!groups.length) return "";
  return groups.slice(0, 2).join("/");
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
  exportDraft: ExportFieldDraft | null;
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

function rowMetaFromWorkbenchDetail(payload: WorkbenchDetailResponse): RowMeta {
  return {
    raw: payload.raw,
    assets: payload.assets || {},
    detail: payload.task,
    exportDraft: payload.export_draft || null,
  };
}

type CategorySearchItem = {
  path: string;
  leaf: string;
};

type CategorySearchResponse = {
  items: CategorySearchItem[];
  total: number;
  query: string;
};

type CategorySelectOption = {
  value: string;
  label: string;
  path: string;
  leaf: string;
  preferred: boolean;
};

function categoryLeaf(path: string): string {
  const parts = String(path || "")
    .split(">")
    .map((item) => item.trim())
    .filter(Boolean);
  return parts[parts.length - 1] || String(path || "").trim();
}

function mergeCategoryOptions(
  preferredPaths: string[],
  allOptions: CategorySearchItem[],
  query: string,
  limit = 24,
): CategorySearchItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  const merged = new Map<string, CategorySearchItem>();

  // When query is provided, filter by query first, then show results
  if (normalizedQuery) {
    const matched: CategorySearchItem[] = [];
    for (const option of allOptions) {
      const path = String(option.path || "").trim();
      if (!path || merged.has(path)) continue;
      const path_lc = path.toLowerCase();
      const leaf_lc = (option.leaf || categoryLeaf(path)).toLowerCase();
      // Match if query appears in path or leaf
      if (path_lc.includes(normalizedQuery) || leaf_lc.includes(normalizedQuery)) {
        matched.push({ path, leaf: option.leaf || categoryLeaf(path) });
        merged.set(path, matched[matched.length - 1]);
      }
      if (merged.size >= limit) break;
    }
    // If not enough results, also try partial token matches
    if (merged.size < limit && normalizedQuery.length > 1) {
      for (const option of allOptions) {
        const path = String(option.path || "").trim();
        if (!path || merged.has(path)) continue;
        const path_lc = path.toLowerCase();
        const leaf_lc = (option.leaf || categoryLeaf(path)).toLowerCase();
        // Try matching individual tokens from the query
        const tokens = normalizedQuery.split(/[\s,，]+/).filter(Boolean);
        const hasMatch = tokens.some(token => path_lc.includes(token) || leaf_lc.includes(token));
        if (hasMatch) {
          matched.push({ path, leaf: option.leaf || categoryLeaf(path) });
          merged.set(path, matched[matched.length - 1]);
        }
        if (merged.size >= limit) break;
      }
    }
    return Array.from(merged.values());
  }

  // When query is empty, show preferred first then fill with all options
  const preferredSet = new Set(preferredPaths.map((item) => String(item || "").trim()).filter(Boolean));

  for (const path of preferredPaths) {
    const text = String(path || "").trim();
    if (!text || merged.has(text)) continue;
    merged.set(text, { path: text, leaf: categoryLeaf(text) });
  }

  if (merged.size < limit) {
    const remaining = limit - merged.size;
    for (const option of allOptions) {
      const path = String(option.path || "").trim();
      if (!path || merged.has(path) || !preferredSet.has(path)) continue;
      merged.set(path, { path, leaf: option.leaf || categoryLeaf(path) });
      if (merged.size >= limit) break;
    }
  }

  if (merged.size < limit) {
    for (const option of allOptions) {
      const path = String(option.path || "").trim();
      if (!path || merged.has(path)) continue;
      merged.set(path, { path, leaf: option.leaf || categoryLeaf(path) });
      if (merged.size >= limit) break;
    }
  }

  return Array.from(merged.values());
}

function toCategorySelectOptions(items: CategorySearchItem[], preferredPaths: string[]): CategorySelectOption[] {
  const preferredSet = new Set(preferredPaths.map((item) => String(item || "").trim()).filter(Boolean));
  return items.map((item) => ({
    value: item.path,
    label: item.leaf || categoryLeaf(item.path),
    path: item.path,
    leaf: item.leaf || categoryLeaf(item.path),
    preferred: preferredSet.has(item.path),
  }));
}

function SearchableCategoryInput({
  value,
  onChange,
  onSelect,
  allOptions,
  preferredPaths,
  placeholder,
  className,
  minHeight = 44,
}: {
  value: string;
  onChange: (value: string) => void;
  onSelect: (path: string) => void;
  allOptions: CategorySearchItem[];
  preferredPaths: string[];
  placeholder: string;
  className?: string;
  minHeight?: number;
}) {
  const [inputValue, setInputValue] = useState("");
  const [serverSuggestions, setServerSuggestions] = useState<CategorySearchItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Debounced search on server when input changes
  useEffect(() => {
    const query = inputValue.trim();
    if (!query) {
      setServerSuggestions([]);
      return;
    }

    const timer = window.setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await fetch(`${apiBaseUrl}/api/categories/search?q=${encodeURIComponent(query)}&limit=100`, {
          cache: "no-store",
        });
        if (response.ok) {
          const result = (await response.json()) as CategorySearchResponse;
          setServerSuggestions(result.items || []);
        }
      } catch {
        // ignore search errors
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      window.clearTimeout(timer);
    };
  }, [inputValue]);

  // Compute suggestions: use server results if available, otherwise local search
  // Always include the currently selected value in options to ensure it displays correctly
  const suggestions = useMemo(() => {
    const query = inputValue.trim();
    let baseItems: CategorySearchItem[] = [];

    // When we have server results, use them as the base
    if (serverSuggestions.length > 0) {
      baseItems = serverSuggestions;
    } else if (query) {
      // No server results, fall back to local search
      baseItems = mergeCategoryOptions(preferredPaths, allOptions, query, 80);
    }

    // Deduplicate by path
    const pathMap = new Map<string, string>();
    for (const item of baseItems) {
      pathMap.set(item.path, item.leaf || categoryLeaf(item.path));
    }

    // Always add the currently selected value to ensure it displays correctly
    if (value && !pathMap.has(value)) {
      pathMap.set(value, categoryLeaf(value));
    }

    // Add preferred paths that might not be in results yet
    for (const preferredPath of preferredPaths) {
      if (!pathMap.has(preferredPath)) {
        pathMap.set(preferredPath, categoryLeaf(preferredPath));
      }
    }

    // Convert back to array, limit to 80
    const result: CategorySearchItem[] = [];
    for (const [path, leaf] of pathMap) {
      if (result.length >= 80) break;
      result.push({ path, leaf });
    }
    return result;
  }, [allOptions, preferredPaths, inputValue, serverSuggestions, value]);

  // Compute options from suggestions
  const options = useMemo(
    () => toCategorySelectOptions(suggestions, preferredPaths),
    [preferredPaths, suggestions],
  );

  // Find selected option: look in both current options AND allOptions to handle server search results
  const selectedOption = useMemo(() => {
    const text = String(value || "").trim();
    if (!text) return null;
    // First try to find in current options (for display after search)
    const found = options.find((option) => option.value === text);
    if (found) return found;
    // Fallback: search in allOptions and serverSuggestions to create the option
    const allItems = [...serverSuggestions, ...allOptions];
    const match = allItems.find((item) => item.path === text);
    if (match) {
      return {
        value: match.path,
        label: match.leaf || categoryLeaf(match.path),
        path: match.path,
        leaf: match.leaf || categoryLeaf(match.path),
        preferred: preferredPaths.includes(match.path),
      };
    }
    return null;
  }, [options, value, allOptions, serverSuggestions, preferredPaths]);

  const styles: StylesConfig<CategorySelectOption, false> = {
    control: (base, state) => ({
      ...base,
      minHeight,
      borderRadius: 14,
      borderColor: state.isFocused ? "#94a3b8" : "#e2e8f0",
      backgroundColor: "#fff",
      boxShadow: "none",
      paddingLeft: 4,
      paddingRight: 4,
      "&:hover": { borderColor: "#94a3b8" },
    }),
    valueContainer: (base) => ({
      ...base,
      padding: "0 8px",
    }),
    placeholder: (base) => ({
      ...base,
      color: "#94a3b8",
      fontSize: 14,
    }),
    singleValue: (base) => ({
      ...base,
      color: "#0f172a",
      fontSize: 14,
    }),
    input: (base) => ({
      ...base,
      color: "#0f172a",
      fontSize: 14,
    }),
    menu: (base) => ({
      ...base,
      borderRadius: 18,
      border: "1px solid #e2e8f0",
      boxShadow: "0 18px 50px rgba(15,23,42,0.12)",
      overflow: "hidden",
      zIndex: 30,
    }),
    menuList: (base) => ({
      ...base,
      padding: 8,
      maxHeight: 320,
    }),
    option: (base, state) => ({
      ...base,
      borderRadius: 12,
      backgroundColor: state.isSelected ? "#dbeafe" : state.isFocused ? "#f8fafc" : "#fff",
      color: "#0f172a",
      padding: 0,
      cursor: "pointer",
      overflow: "hidden",
    }),
    noOptionsMessage: (base) => ({
      ...base,
      color: "#64748b",
      fontSize: 12,
      padding: "8px 10px",
    }),
    indicatorSeparator: () => ({ display: "none" }),
    dropdownIndicator: (base) => ({
      ...base,
      color: "#64748b",
      padding: 6,
    }),
    clearIndicator: (base) => ({
      ...base,
      color: "#64748b",
      padding: 6,
    }),
  };

  return (
    <div className={`relative ${className || ""}`}>
      {isSearching && inputValue.trim() ? (
        <div className="absolute right-10 top-1/2 -translate-y-1/2 text-xs text-slate-400">搜索中...</div>
      ) : null}
      <Select<CategorySelectOption, false>
        unstyled={false}
        options={options}
        value={selectedOption}
        inputValue={inputValue}
        onInputChange={(nextValue: string, meta: InputActionMeta) => {
          if (meta.action === "input-change") {
            setInputValue(nextValue);
            onChange(nextValue);
          }
          if (meta.action === "menu-close") {
            setInputValue("");
          }
          return nextValue;
        }}
        onChange={(option: SingleValue<CategorySelectOption>) => {
          const nextPath = option?.path || "";
          // If user selected an option, add it to serverSuggestions to ensure it stays visible
          if (nextPath && !serverSuggestions.some((s) => s.path === nextPath)) {
            setServerSuggestions((prev) => [
              { path: nextPath, leaf: categoryLeaf(nextPath) },
              ...prev.slice(0, 99),
            ]);
          }
          // Call onChange and onSelect to update external state first
          onChange(nextPath);
          onSelect(nextPath);
          // Clear input after a brief delay to ensure value is updated first
          setTimeout(() => setInputValue(""), 0);
        }}
        isClearable
        filterOption={null}
        styles={styles}
        formatOptionLabel={(option) => (
          <div className="px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-800">{option.leaf}</span>
              {option.preferred ? (
                <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-700">优先</span>
              ) : null}
            </div>
            <div className="mt-1 line-clamp-2 text-[11px] text-slate-500">{option.path}</div>
          </div>
        )}
        noOptionsMessage={() => "没有匹配类目，继续输入搜索"}
        placeholder={placeholder}
      />
    </div>
  );
}

type ViewMode = "cards" | "table";
type DrawerSize = "50" | "70" | "100";
type DrawerTab = "trace" | "images" | "info" | "defaults" | "raw";

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
    skipped: "已跳过",
  };
  return map[status] || status;
}

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

  const summaries = Array.from(grouped.entries()).map(([jobId, jobEvents]) => {
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
  }).filter((event): event is ProductTaskTimelineEvent => Boolean(event));

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

function selectedSlotAsset(assetsBySlot: AssetsBySlotResponse | undefined, slot: string): ProductAsset | null {
  return latestAsset(assetsBySlot?.[slot]);
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

function rawImageForCarouselSlot(raw: RawProductDetail | null | undefined, slot: string): string | null {
  if (!slot.startsWith("carousel_")) return null;
  const index = Number(slot.split("_")[1]) - 1;
  if (!Number.isInteger(index) || index < 0) return null;
  return rawCarouselSequence(raw)[index] || null;
}

type TableSlotImage = {
  slot: string;
  asset: ProductAsset | null;
  rawUrl: string | null;
  publicUrl: string | null;
};

function tableSlotImage(
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

function ThumbnailPlaceholder({ label = "暂无图" }: { label?: string }) {
  return (
    <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-[10px] text-slate-400">
      {label}
    </div>
  );
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
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<TaskMainStatus | "">("");
  const [categoryStatus, setCategoryStatus] = useState<CategoryStatus | "">("");
  const [exportStatus, setExportStatus] = useState<ExportStatus | "">("");
  const [exceptionOnly, setExceptionOnly] = useState<boolean>(searchParams.get("exception") === "1");
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
  const [categoryOptions, setCategoryOptions] = useState<CategorySearchItem[]>([]);
  const [bulkTitleMode, setBulkTitleMode] = useState<"current" | "raw" | "ai">("ai");
  const [bulkTitlePrefix, setBulkTitlePrefix] = useState("");
  const [bulkTitleSuffix, setBulkTitleSuffix] = useState("");
  const [bulkCategoryValue, setBulkCategoryValue] = useState("");

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
    window.localStorage.setItem(DRAWER_SIZE_KEY, drawerSize);
  }, [drawerSize]);

  useEffect(() => {
    const nextView: ViewMode = pathname === "/logs" || searchParams.get("view") === "logs" ? "cards" : "table";
    setViewMode(nextView);
    setDrawerTab(pathname === "/logs" ? "trace" : "images");
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

  async function loadTaskTimeline(taskId: number): Promise<ProductTaskTimelineResponse> {
    const response = await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}/timeline`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as ProductTaskTimelineResponse;
  }

  async function loadTimelines(items: ProductTaskListItem[]): Promise<void> {
    if (!items.length) {
      setTimelineMap({});
      return;
    }
    try {
      const results = await Promise.all(items.map((item) => loadTaskTimeline(item.id)));
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
    setTimelineMap((prev) => ({ ...prev, [taskId]: timeline }));
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

  async function loadRowMeta(items: ProductTaskListItem[]): Promise<void> {
    const pairs = await Promise.all(
      items.map(async (item) => {
        try {
          const response = await fetch(`${apiBaseUrl}/api/product-tasks/${item.id}/workbench-detail`, {
            cache: "no-store",
          });
          if (!response.ok) {
            return [item.id, { raw: null, assets: {}, detail: null, exportDraft: null }] as const;
          }
          const payload = (await response.json()) as WorkbenchDetailResponse;
          return [item.id, rowMetaFromWorkbenchDetail(payload)] as const;
        } catch {
          return [item.id, { raw: null, assets: {}, detail: null, exportDraft: null }] as const;
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
          next[item.id] =
            String(meta?.exportDraft?.fields_json?.product_title_en || meta?.detail?.ai?.title_en || "").trim();
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
      headers: buildAiRequestHeaders(true, ["dimension_extract", "title_package"]),
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
      headers: buildAiRequestHeaders(true, ["title_package", "product_info", "title"]),
      body: JSON.stringify({}),
    });
    const result = (await response.json()) as { detail?: string };
    if (!response.ok) throw new Error(result.detail || `HTTP ${response.status}`);
  }

  async function generateTitles(taskId: number): Promise<void> {
    const response = await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}/generate-titles`, {
      method: "POST",
      headers: buildAiRequestHeaders(false, ["title_package_lite", "title"]),
    });
    const result = (await response.json()) as { detail?: string };
    if (!response.ok) throw new Error(result.detail || `HTTP ${response.status}`);
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
              : quickTitleDrafts[taskId] || String(meta?.exportDraft?.fields_json?.product_title_en || "").trim();
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

  async function applyDefaults(taskId: number): Promise<void> {
    const response = await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}/apply-default-rules`, {
      method: "POST",
    });
    const result = (await response.json()) as { detail?: string };
    if (!response.ok) throw new Error(result.detail || `HTTP ${response.status}`);
  }

  async function handleBulkApplyDefaults(): Promise<void> {
    if (!selectedIds.length) {
      setNotice("请先选择商品");
      return;
    }
    const ok = window.confirm(
      `将为已选择的 ${selectedIds.length} 个商品生成或刷新导出字段草稿。\n\n会写入上架默认值规则、AI 标题/类目、商品资产等可导出字段；已人工覆盖的字段会尽量保留。是否继续？`,
    );
    if (!ok) return;
    await runBulkAction(
      "生成导出草稿",
      applyDefaults,
      "已为 {count} 个商品生成/刷新导出字段草稿。",
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

          <div className={["mt-6 grid gap-3", isLogsRoute ? "lg:grid-cols-[1.4fr_0.75fr_0.75fr_0.75fr_auto]" : "lg:grid-cols-[1.3fr_0.7fr_0.7fr_0.7fr_auto]"].join(" ")}>
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
              {!isLogsRoute ? (
                <>
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
                onClick={() => void handleBulkApplyDefaults()}
                disabled={!selectedIds.length || bulkLoading !== null}
                title="根据上架默认值规则、AI结果和商品资产生成或刷新导出字段草稿，不是直接导出 Excel。"
                className={[
                  "h-11 rounded-full px-4 text-sm",
                  !selectedIds.length || bulkLoading !== null
                    ? "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400"
                    : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                ].join(" ")}
              >
                批量生成导出草稿
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
                </>
              ) : null}
            </div>
          </div>

          {error ? <div className="mt-4 text-sm text-rose-600">加载失败：{error}</div> : null}
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
            <div className="mt-4 rounded-[22px] border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">批量处理工具栏</div>
                  <div className="mt-1 text-xs text-slate-500">先批量处理标题和类目，再生成导出草稿，最后校验或导出 Excel。</div>
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
                  批量类目
                </button>
                <button
                  type="button"
                  onClick={() => void handleBulkApplyDefaults()}
                  disabled={bulkLoading !== null}
                  title="根据上架默认值规则、AI结果和商品资产生成或刷新导出字段草稿，不是直接导出 Excel。"
                  className="h-11 rounded-full border border-slate-300 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  生成导出草稿
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
              categoryOptions={categoryOptions}
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
              onRunAi={(taskId) => void runRowAction(taskId, "run-ai", () => runAi(taskId))}
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
                  <button
                    type="button"
                    onClick={() => void syncDrawerAndTable()}
                    disabled={!activeTaskId || drawerSyncing}
                    className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {drawerSyncing ? "保存中..." : "保存并同步"}
                  </button>
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
                    isLogsRoute
                      ? ([
                          { key: "trace", label: "流程排查" },
                          { key: "info", label: "商品信息" },
                        ] as const)
                      : ([
                          { key: "images", label: "图片处理" },
                          { key: "info", label: "商品信息" },
                          { key: "defaults", label: "上架默认值" },
                          { key: "raw", label: "原始采集" },
                        ] as const)
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
                    onRefresh={activeTaskId ? syncDrawerAndTable : undefined}
                    isLogsRoute={isLogsRoute}
                    onOpenPromptEditor={openPromptEditor}
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
  const [assets, setAssets] = useState<AssetsBySlotResponse>({});
  const [loading, setLoading] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
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
    await onRefresh?.();
  }

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
      const res = await fetch(`${apiBaseUrl}/api/product-tasks/${task.id}/generate-images`, {
        method: "POST",
        headers: buildAiRequestHeaders(true, ["dimension_extract", "title_package"]),
        body: JSON.stringify({ job_type: "carousel_4grid" }),
      });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      const data = (await res.json()) as { job_ids: number[] };
      const jobId = data.job_ids?.[0];
      if (jobId) await pollJob(jobId);
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
      const res = await fetch(`${apiBaseUrl}/api/product-tasks/${task.id}/generate-image`, {
        method: "POST",
        headers: buildAiRequestHeaders(
          true,
          slot === "size_chart"
            ? ["dimension_extract", "title_package", "product_info"]
            : ["title_package", "product_info"],
        ),
        body: JSON.stringify({ slot }),
      });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      const data = (await res.json()) as { job_id: number };
      if (data.job_id) await pollJob(data.job_id);
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
      const res = await fetch(`${apiBaseUrl}/api/product-tasks/${task.id}/generate-selling-images`, {
        method: "POST",
        headers: buildAiRequestHeaders(true, ["title_package", "product_info"]),
        body: JSON.stringify({ slots: ["carousel_1", "carousel_2", "carousel_3", "carousel_4"] }),
      });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      const data = (await res.json()) as { job_ids: number[] };
      setJobStatus(`卖点主图已提交 ${(data.job_ids || []).length} 个任务`);
      for (const jobId of data.job_ids || []) {
        await pollJob(jobId);
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
      const res = await fetch(`${apiBaseUrl}/api/product-tasks/${task.id}/generate-sku-image`, {
        method: "POST",
        headers: buildAiRequestHeaders(true, ["title_package", "product_info"]),
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      const data = (await res.json()) as { job_id?: number };
      if (data.job_id) await pollJob(data.job_id);
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
      const res = await fetch(`${apiBaseUrl}/api/product-tasks/${task.id}/generate-size-image`, {
        method: "POST",
        headers: buildAiRequestHeaders(true, ["dimension_extract", "title_package", "product_info"]),
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      const data = (await res.json()) as { job_id?: number };
      if (data.job_id) await pollJob(data.job_id);
    } catch (err) {
      setOpError(err instanceof Error ? err.message : "尺寸图生成失败");
    } finally {
      clearBusy();
    }
  }

  async function setFinal(assetId: number): Promise<void> {
    setOpError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/assets/${assetId}/set-final`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
      const res = await fetch(`${apiBaseUrl}/api/product-tasks/${task.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ export_image_settings_json: next }),
      });
      if (!res.ok) throw new Error(await readErrorDetail(res));
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
      const res = await fetch(`${apiBaseUrl}/api/assets/${assetId}/regenerate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      const data = (await res.json()) as { job_id: number };
      if (data.job_id) await pollJob(data.job_id);
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
      const res = await fetch(`${apiBaseUrl}/api/product-tasks/${task.id}/reorder-slots`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source_slot: sourceSlot, target_slot: targetSlot }),
      });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      const data = (await res.json()) as { noop?: boolean };
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
      const res = await fetch(`${apiBaseUrl}/api/product-tasks/${task.id}/remove-slot-image`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slot, compact_following: true }),
      });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      const data = (await res.json()) as { compacted?: { from_slot: string; to_slot: string }[] };
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
      if (!res.ok) throw new Error(await readErrorDetail(res));
      setJobStatus("SKU 属性已保存并同步。");
      await onRefresh?.();
    } catch (err) {
      setOpError(err instanceof Error ? err.message : "保存 SKU 属性失败");
    } finally {
      setSkuSaving(false);
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
          <MetricCard label="当前处理" value="轮播编排" hint="先看原始图，再决定是否采用 AI 图" />
        </div>
      </Section>

      <Section title="轮播编排">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={generateCarousel4Grid}
            className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800"
          >
            生成四宫格轮播图
          </button>
          <button
            type="button"
            onClick={() => void generateSellingImages()}
            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            批量生成前 4 张 AI 图
          </button>
          <button
            type="button"
            onClick={() => void generateSkuImage()}
            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            生成 SKU 图
          </button>
          <button
            type="button"
            onClick={() => void generateSizeImage()}
            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            生成尺寸图
          </button>
          <button
            type="button"
            onClick={loadAssets}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            刷新
          </button>
          </div>
          <button
            type="button"
            onClick={() => void syncVisibleCarouselToTable()}
            className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700 hover:bg-emerald-100"
          >
            保存并同步表格
          </button>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[1.15fr_0.8fr_1.15fr]">
          <div className="grid gap-3">
            {carouselSlots.slice(0, 2).map((slot) => (
              <LayoutCompareCard
                key={slot}
                slot={slot}
                rawImage={getRawReferenceImage(slot)}
                assets={assets[slot] || []}
                selected={selectedTargetSlot === slot}
                dragged={draggedSlot === slot}
                draggedSlot={draggedSlot}
                busyLabel={busySlots[slot] || (assigning ? "同步图片中" : null)}
                onSelectSlot={setSelectedTargetSlot}
                onDragStart={setDraggedSlot}
                onReorder={reorderSlots}
                onChooseOther={focusRawOverview}
                onUploadToSlot={uploadToSlot}
                onGenerateSingle={generateSingle}
                onSetFinal={setFinal}
                onRegenerate={regenerate}
                onDeleteSlot={deleteSlotImage}
                onAssignFromAsset={async (slot, sourceAssetId) => assignCandidateToSlot({ targetSlot: slot, sourceAssetId })}
                onAssignFromUrl={async (slot, sourceUrl) => assignCandidateToSlot({ targetSlot: slot, sourceUrl })}
                onPreview={(src, caption) => setLightbox({ src, alt: caption, caption })}
                onOpenPrompt={() => {
                  const config = getPromptEditorConfig(slot);
                  onOpenPromptEditor(config.label, config.promptTypes);
                }}
              />
            ))}
          </div>

          <FourGridCenterCard
            rawImage={getRawReferenceImage("carousel_1")}
            assets={assets.carousel_4grid || []}
            onPreview={(src, caption) => setLightbox({ src, alt: caption, caption })}
            onGenerate={generateCarousel4Grid}
            busyLabel={busySlots.carousel_4grid || null}
            onOpenPrompt={() => {
              const config = getPromptEditorConfig("carousel_4grid");
              onOpenPromptEditor(config.label, config.promptTypes);
            }}
          />

          <div className="grid gap-3">
            {carouselSlots.slice(2, 4).map((slot) => (
              <LayoutCompareCard
                key={slot}
                slot={slot}
                rawImage={getRawReferenceImage(slot)}
                assets={assets[slot] || []}
                selected={selectedTargetSlot === slot}
                dragged={draggedSlot === slot}
                draggedSlot={draggedSlot}
                busyLabel={busySlots[slot] || (assigning ? "同步图片中" : null)}
                onSelectSlot={setSelectedTargetSlot}
                onDragStart={setDraggedSlot}
                onReorder={reorderSlots}
                onChooseOther={focusRawOverview}
                onUploadToSlot={uploadToSlot}
                onGenerateSingle={generateSingle}
                onSetFinal={setFinal}
                onRegenerate={regenerate}
                onDeleteSlot={deleteSlotImage}
                onAssignFromAsset={async (slot, sourceAssetId) => assignCandidateToSlot({ targetSlot: slot, sourceAssetId })}
                onAssignFromUrl={async (slot, sourceUrl) => assignCandidateToSlot({ targetSlot: slot, sourceUrl })}
                onPreview={(src, caption) => setLightbox({ src, alt: caption, caption })}
                onOpenPrompt={() => {
                  const config = getPromptEditorConfig(slot);
                  onOpenPromptEditor(config.label, config.promptTypes);
                }}
              />
            ))}
          </div>
        </div>

        <div className="mt-4 rounded-[18px] border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">剩余主图轮播图</div>
              <div className="mt-1 text-xs text-slate-500">前 4 张之外的轮播位继续往下排，用于补充展示，不再单独拆“附加轮播图位”。</div>
            </div>
            <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
              导出 {arrangedCarouselExportAssets.length} 张
            </div>
          </div>
          <div className="mt-4 grid gap-3 xl:grid-cols-4">
            {extraCarouselSlots.map((slot) => (
              <LayoutCompareCard
                key={slot}
                slot={slot}
                rawImage={getRawReferenceImage(slot)}
                assets={assets[slot] || []}
                selected={selectedTargetSlot === slot}
                dragged={draggedSlot === slot}
                draggedSlot={draggedSlot}
                busyLabel={busySlots[slot] || (assigning ? "同步图片中" : null)}
                onSelectSlot={setSelectedTargetSlot}
                onDragStart={setDraggedSlot}
                onReorder={reorderSlots}
                onChooseOther={focusRawOverview}
                onUploadToSlot={uploadToSlot}
                onGenerateSingle={generateSingle}
                onSetFinal={setFinal}
                onRegenerate={regenerate}
                onDeleteSlot={deleteSlotImage}
                onAssignFromAsset={async (slot, sourceAssetId) => assignCandidateToSlot({ targetSlot: slot, sourceAssetId })}
                onAssignFromUrl={async (slot, sourceUrl) => assignCandidateToSlot({ targetSlot: slot, sourceUrl })}
                onPreview={(src, caption) => setLightbox({ src, alt: caption, caption })}
                onOpenPrompt={() => {
                  const config = getPromptEditorConfig(slot);
                  onOpenPromptEditor(config.label, config.promptTypes);
                }}
              />
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          {supportSlots.map((slot) => (
            <LayoutCompareCard
              key={slot}
              slot={slot}
              rawImage={getRawReferenceImage(slot)}
              assets={assets[slot] || []}
              selected={selectedTargetSlot === slot}
              dragged={draggedSlot === slot}
              draggedSlot={draggedSlot}
              busyLabel={busySlots[slot] || (assigning ? "同步图片中" : null)}
              onSelectSlot={setSelectedTargetSlot}
              onDragStart={setDraggedSlot}
              onReorder={reorderSlots}
              onChooseOther={focusRawOverview}
              onUploadToSlot={uploadToSlot}
              onGenerateSingle={generateSingle}
              onSetFinal={setFinal}
              onRegenerate={regenerate}
              onDeleteSlot={deleteSlotImage}
              onAssignFromAsset={async (slot, sourceAssetId) => assignCandidateToSlot({ targetSlot: slot, sourceAssetId })}
              onAssignFromUrl={async (slot, sourceUrl) => assignCandidateToSlot({ targetSlot: slot, sourceUrl })}
              onPreview={(src, caption) => setLightbox({ src, alt: caption, caption })}
              onOpenPrompt={() => {
                const config = getPromptEditorConfig(slot);
                onOpenPromptEditor(config.label, config.promptTypes);
              }}
            />
          ))}
        </div>

        <div className="mt-4 rounded-[18px] border border-amber-200 bg-amber-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-amber-950">尺寸图导出位置</div>
              <div className="mt-1 text-xs text-amber-800">
                默认把尺寸图放到轮播第 3 张；导出时只调整导出顺序，不移动上方图片槽位，第 3 张及后面的轮播图会自动后排。
              </div>
              {!sizeChartExportAsset?.public_url ? (
                <div className="mt-2 text-xs text-amber-700">当前还没有已采用的尺寸图，勾选后会在有尺寸图时生效。</div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-white px-3 py-2 text-xs text-amber-900">
                <input
                  type="checkbox"
                  checked={insertSizeChartInCarousel}
                  onChange={(event) => {
                    const next = {
                      insert_size_chart_in_carousel: event.target.checked,
                      size_chart_position: sizeChartPosition,
                    };
                    setInsertSizeChartInCarousel(next.insert_size_chart_in_carousel);
                    void saveExportImageSettings(next);
                  }}
                />
                导出轮播中插入尺寸图
              </label>
              <label className="flex items-center gap-2 text-xs text-amber-900">
                放在第
                <select
                  value={sizeChartPosition}
                  disabled={!insertSizeChartInCarousel}
                  onChange={(event) => {
                    const next = {
                      insert_size_chart_in_carousel: insertSizeChartInCarousel,
                      size_chart_position: Number(event.target.value),
                    };
                    setSizeChartPosition(next.size_chart_position);
                    void saveExportImageSettings(next);
                  }}
                  className="rounded-full border border-amber-300 bg-white px-3 py-2 text-xs text-amber-950 disabled:opacity-60"
                >
                  {Array.from({ length: 10 }, (_, index) => index + 1).map((position) => (
                    <option key={position} value={position}>{position}</option>
                  ))}
                </select>
                张
              </label>
              {imageSettingsSaving ? <span className="text-xs text-amber-700">保存中...</span> : null}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-[18px] border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">SKU 图管理</div>
              <div className="mt-1 text-xs text-slate-500">这里展示采集到的全部 SKU 图，可逐张设为上方 `SKU 图` 槽位。</div>
            </div>
            <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
              {raw?.sku_images?.length || 0} 张
            </div>
          </div>
          {raw?.sku_images?.length ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {raw.sku_images.map((src, index) => (
                <div key={`${task.id}-sku-candidate-${index + 1}`} className="rounded-[14px] border border-slate-200 bg-slate-50 p-2">
                  <button type="button" onClick={() => setLightbox({ src, alt: `SKU 图 ${index + 1}`, caption: `SKU 图 ${index + 1}` })} className="block w-full">
                    <HoverZoomImage src={src} alt={`SKU 图 ${index + 1}`} thumbClassName="h-28 w-full rounded-[10px] bg-white object-contain" />
                  </button>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData("application/x-candidate-url", src);
                        event.dataTransfer.effectAllowed = "copyMove";
                      }}
                      className="cursor-grab rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 active:cursor-grabbing"
                      title="拖到任意卡片替换图片"
                    >
                      拖拽
                    </button>
                    <button
                      type="button"
                      onClick={() => void assignCandidateToSlot({ targetSlot: "sku_image", sourceUrl: src })}
                      className="flex-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                    >
                      设为 SKU 图
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 rounded-[12px] border border-dashed border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
              暂无采集到的 SKU 图
            </div>
          )}
          <div className="mt-4 grid gap-3 xl:grid-cols-2">
            <label className="text-xs text-slate-600">
              平台 SKU
              <input
                value={skuCodeDraft}
                onChange={(event) => setSkuCodeDraft(event.target.value)}
                className="mt-1 w-full rounded-[10px] border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                placeholder="例如：SKU-001 / 颜色款式编码"
              />
            </label>
            <label className="text-xs text-slate-600">
              SKU 文本
              <textarea
                value={skuTextDraft}
                onChange={(event) => setSkuTextDraft(event.target.value)}
                className="mt-1 h-20 w-full rounded-[10px] border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                placeholder="例如：颜色: 银色; 尺寸: 8mm"
              />
            </label>
          </div>
          <div className="mt-4 rounded-[14px] border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">结构化 SKU 规格</div>
                <div className="mt-1 text-xs text-slate-500">这里保存插件识别到的颜色、款式、尺寸等选项，上架补充里的 SKU 行会优先拿它来预填。</div>
              </div>
              <button
                type="button"
                onClick={addSkuPropDraft}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
              >
                添加选项
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {skuPropsDraft.length ? (
                skuPropsDraft.map((item, index) => (
                  <div key={`sku-prop-draft-${index + 1}`} className="grid gap-2 rounded-[12px] border border-slate-200 bg-white p-2 xl:grid-cols-[120px_1fr_1fr_auto]">
                    <input
                      value={item.group_name}
                      onChange={(event) => patchSkuPropDraft(index, { group_name: event.target.value })}
                      className="rounded-[10px] border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                      placeholder="规格组"
                    />
                    <input
                      value={item.option_name}
                      onChange={(event) => patchSkuPropDraft(index, { option_name: event.target.value })}
                      className="rounded-[10px] border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                      placeholder="选项值"
                    />
                    <input
                      value={item.image_url || ""}
                      onChange={(event) => patchSkuPropDraft(index, { image_url: event.target.value || null })}
                      className="rounded-[10px] border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                      placeholder="对应 SKU 图 URL，可留空"
                    />
                    <button
                      type="button"
                      onClick={() => removeSkuPropDraft(index)}
                      className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
                    >
                      删除
                    </button>
                  </div>
                ))
              ) : (
                <div className="rounded-[12px] border border-dashed border-slate-200 bg-white p-3 text-xs text-slate-500">
                  还没有结构化 SKU 规格。可以重新采集，也可以先手动补。
                </div>
              )}
            </div>
          </div>
          <div className="mt-3">
            <button
              type="button"
              onClick={() => void saveSkuAttributes()}
              disabled={skuSaving}
              className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {skuSaving ? "保存中..." : "保存 SKU 属性"}
            </button>
          </div>
        </div>

        <div className="mt-4 rounded-[14px] border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs text-slate-500">导出字段预览值</div>
          <div className="mt-2 break-all text-xs text-slate-700">
            {carouselExportValue || "当前还没有可导出的轮播图 URL"}
          </div>
        </div>
      </Section>

      <Section title="原始采集图片总览">
        <div id="raw-source-overview" className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">当前目标位：{slotLabel(selectedTargetSlot)}</div>
              <div className="mt-1 text-xs text-slate-500">这里是原始采集图片的总览和素材池。选中任意图片后，会直接放到上面的当前目标位。</div>
            </div>
            <label className="inline-flex cursor-pointer items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
              本地上传到当前位
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
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <CandidatePoolSection
            title="原始主图 / 轮播图"
            description="默认从这里同步到轮播编排。适合快速替换某个轮播位的原始底图。"
            items={rawCandidates.filter((item) => item.label.startsWith("原始主图") || item.label.startsWith("原始轮播"))}
            onAssign={(item) => void assignCandidateToSlot({ targetSlot: selectedTargetSlot, sourceUrl: item.src })}
            onPreview={(src, caption) => setLightbox({ src, alt: caption, caption })}
            onDragStateChange={() => {}}
          />
          <CandidatePoolSection
            title="详情 / SKU / 尺寸 / 页面截图"
            description="用于补细节、SKU 差异、尺寸说明或缺失角度，也可以拖到上面的任意位置。"
            items={rawCandidates.filter((item) => !item.label.startsWith("原始主图") && !item.label.startsWith("原始轮播"))}
            onAssign={(item) => void assignCandidateToSlot({ targetSlot: selectedTargetSlot, sourceUrl: item.src })}
            onPreview={(src, caption) => setLightbox({ src, alt: caption, caption })}
            onDragStateChange={() => {}}
          />
        </div>

        <div className="mt-4">
          <CandidatePoolSection
            title="AI 生成素材"
            description="这里收纳已经生成出来的四宫格切图、SKU 图、尺寸图和其他 AI 图，可直接替换到上面的任意位置。"
            items={aiCandidates}
            onAssign={(item) =>
              void assignCandidateToSlot({
                targetSlot: selectedTargetSlot,
                sourceAssetId: item.assetId,
              })
            }
            onPreview={(src, caption) => setLightbox({ src, alt: caption, caption })}
            onDragStateChange={() => {}}
          />
        </div>

        <div className="mt-4 rounded-[18px] border border-slate-200 bg-white p-4">
          <div className="text-sm font-semibold text-slate-900">尺寸识别工作区</div>
          <div className="mt-1 text-xs text-slate-500">从采集尺寸图或已生成尺寸图里挑一张识别，结果会显示在下方。</div>
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
        </div>
      </Section>

      {loading ? (
        <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          正在加载图片资产…
        </div>
      ) : null}

      <ImageLightbox image={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}

function LayoutCompareCard({
  slot,
  rawImage,
  assets,
  selected,
  dragged,
  busyLabel,
  onSelectSlot,
  onDragStart,
  onReorder,
  onChooseOther,
  onUploadToSlot,
  onGenerateSingle,
  onSetFinal,
  onRegenerate,
  onDeleteSlot,
  onAssignFromAsset,
  onAssignFromUrl,
  onPreview,
  onOpenPrompt,
  draggedSlot,
}: {
  slot: string;
  rawImage: string | null;
  assets: ProductAsset[];
  selected: boolean;
  dragged: boolean;
  busyLabel: string | null;
  onSelectSlot: (slot: string) => void;
  onDragStart: (slot: string | null) => void;
  onReorder: (sourceSlot: string, targetSlot: string) => Promise<void>;
  onChooseOther: (slot: string) => void;
  onUploadToSlot: (slot: string, file: File) => Promise<void>;
  onGenerateSingle: (slot: string) => Promise<void>;
  onSetFinal: (assetId: number) => Promise<void>;
  onRegenerate: (slot: string, assetId: number) => Promise<void>;
  onDeleteSlot: (slot: string) => Promise<void>;
  onAssignFromAsset: (slot: string, sourceAssetId: number) => Promise<void>;
  onAssignFromUrl: (slot: string, sourceUrl: string) => Promise<void>;
  onPreview: (src: string, caption: string) => void;
  onOpenPrompt: () => void;
  draggedSlot: string | null;
}) {
  const finalAsset = assets.find((a) => a.selected_for_export) || assets[0] || null;
  function bindSlotDragData(dataTransfer: DataTransfer): void {
    dataTransfer.setData("text/plain", slot);
    dataTransfer.setData("application/x-slot", slot);
    dataTransfer.effectAllowed = "move";
  }
  const isSwapSource = draggedSlot === slot;
  const isSwapTarget = Boolean(draggedSlot && draggedSlot !== slot);

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = Array.from(event.dataTransfer.types).includes("application/x-slot") ? "move" : "copy";
      }}
      onDrop={(event) => {
        event.preventDefault();
        const candidateAssetId = Number((event.dataTransfer.getData("application/x-candidate-asset-id") || "").trim());
        if (Number.isInteger(candidateAssetId) && candidateAssetId > 0) {
          void onAssignFromAsset(slot, candidateAssetId);
          onDragStart(null);
          return;
        }
        const candidateUrl = (event.dataTransfer.getData("application/x-candidate-url") || "").trim();
        if (candidateUrl) {
          void onAssignFromUrl(slot, candidateUrl);
          onDragStart(null);
          return;
        }
        const dropped =
          (event.dataTransfer.getData("application/x-slot") || event.dataTransfer.getData("text/plain") || draggedSlot || slot).trim();
        void onReorder(dropped, slot);
      }}
      className={[
        "rounded-[18px] border p-4 transition",
        isSwapTarget
          ? "border-sky-300 bg-sky-50/70"
          : selected
            ? "border-slate-900 bg-slate-50"
            : "border-slate-200 bg-white",
        dragged ? "opacity-60" : "",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">{slotLabel(slot)}</div>
          <div className="mt-1 text-xs text-slate-500">{finalAsset ? `当前采用 ${finalAsset.source_type} / v${finalAsset.version}` : "默认原始采集图"}</div>
          <div className="mt-1 text-[11px] text-slate-400">可拖拽到其他卡片换位置</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            draggable
            onClick={() => onDragStart(isSwapSource ? null : slot)}
            onDragStart={(event) => {
              bindSlotDragData(event.dataTransfer);
              onDragStart(slot);
            }}
            onDragEnd={() => onDragStart(null)}
            className={[
              "cursor-grab rounded-full border px-2 py-1 text-[11px] active:cursor-grabbing",
              isSwapSource ? "border-sky-300 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-600",
            ].join(" ")}
            title="拖拽此位到其他卡片换位置"
          >
            {isSwapSource ? "取消换位" : "拖拽换位"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (draggedSlot && draggedSlot !== slot) {
                void onReorder(draggedSlot, slot);
                return;
              }
              onSelectSlot(slot);
            }}
            className={[
              "rounded-full px-3 py-1 text-xs",
              isSwapTarget
                ? "bg-sky-700 text-white hover:bg-sky-800"
                : selected
                  ? "bg-slate-900 text-white"
                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
            ].join(" ")}
          >
            {isSwapTarget ? "换到这里" : selected ? "当前目标位" : "设为目标位"}
          </button>
        </div>
      </div>

      <div className="relative mt-3 grid gap-3 md:grid-cols-2">
        {busyLabel ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-[16px] bg-white/85 text-sm font-medium text-slate-700 shadow-inner">
            <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />
            {busyLabel} · {slotLabel(slot)}
          </div>
        ) : null}
        <div className="rounded-[16px] border border-slate-200 bg-white p-2">
          <div className="text-[11px] font-medium text-slate-500">原始图片</div>
          {rawImage ? (
            <button type="button" onClick={() => onPreview(rawImage, `${slotLabel(slot)} · 原始图`)} className="mt-2 block w-full">
              <HoverZoomImage
                src={rawImage}
                alt={`${slotLabel(slot)} 原始图`}
                thumbClassName="h-36 w-full rounded-[12px] bg-slate-50 object-contain"
              />
            </button>
          ) : (
            <div className="mt-2 flex h-36 items-center justify-center rounded-[12px] border border-dashed border-slate-200 bg-slate-50 text-xs text-slate-400">
              暂无原始图
            </div>
          )}
        </div>
        <div className="rounded-[16px] border border-sky-200 bg-sky-50/60 p-2">
          <div className="text-[11px] font-medium text-slate-500">当前采用图</div>
          {finalAsset?.public_url ? (
            <button type="button" onClick={() => onPreview(finalAsset.public_url || "", `${slotLabel(slot)} · 当前采用图`)} className="mt-2 block w-full">
              <HoverZoomImage
                src={finalAsset.public_url}
                alt={`${slotLabel(slot)} 当前采用图`}
                thumbClassName="h-36 w-full rounded-[12px] bg-white object-contain"
              />
            </button>
          ) : rawImage ? (
            <button type="button" onClick={() => onPreview(rawImage, `${slotLabel(slot)} · 当前默认原图`)} className="mt-2 block w-full">
              <HoverZoomImage
                src={rawImage}
                alt={`${slotLabel(slot)} 当前默认原图`}
                thumbClassName="h-36 w-full rounded-[12px] bg-white object-contain"
              />
            </button>
          ) : (
            <div className="mt-2 flex h-36 items-center justify-center rounded-[12px] border border-dashed border-slate-200 bg-white text-xs text-slate-400">
              暂无采用图
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onChooseOther(slot)}
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
        <button
          type="button"
          onClick={() => void onGenerateSingle(slot)}
          disabled={Boolean(busyLabel)}
          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busyLabel ? "生成中..." : "AI 生成"}
        </button>
        <button
          type="button"
          onClick={onOpenPrompt}
          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
        >
          提示词
        </button>
        <button
          type="button"
          onClick={() => void onDeleteSlot(slot)}
          className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs text-rose-700 hover:bg-rose-100"
        >
          删除当前图
        </button>
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
              onClick={() => void onRegenerate(slot, finalAsset.id)}
              disabled={Boolean(busyLabel)}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busyLabel ? "重生成中..." : "重生成"}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function FourGridCenterCard({
  rawImage,
  assets,
  onPreview,
  onGenerate,
  onOpenPrompt,
  busyLabel,
}: {
  rawImage: string | null;
  assets: ProductAsset[];
  onPreview: (src: string, caption: string) => void;
  onGenerate: () => Promise<void>;
  onOpenPrompt: () => void;
  busyLabel: string | null;
}) {
  const asset = assets[0] || null;
  return (
    <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">四宫格母图</div>
          <div className="mt-1 text-xs text-slate-500">中间保留母图，用来核对裁切前后的整体效果。</div>
        </div>
        <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
          {assets.length} 张
        </div>
      </div>
      <div className="relative mt-4 space-y-3">
        {busyLabel ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-[16px] bg-white/85 text-sm font-medium text-slate-700 shadow-inner">
            <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />
            {busyLabel}
          </div>
        ) : null}
        <div className="rounded-[16px] border border-slate-200 bg-white p-2">
          <div className="text-[11px] font-medium text-slate-500">上：原始参考图（主图）</div>
          {rawImage ? (
            <button type="button" onClick={() => onPreview(rawImage, "四宫格参考图")} className="mt-2 block w-full">
              <HoverZoomImage
                src={rawImage}
                alt="四宫格参考图"
                thumbClassName="h-36 w-full rounded-[12px] object-contain bg-slate-50"
              />
            </button>
          ) : (
            <div className="mt-2 flex h-36 items-center justify-center rounded-[12px] border border-dashed border-slate-200 bg-slate-50 text-xs text-slate-400">
              暂无原始参考图
            </div>
          )}
        </div>
        <div className="rounded-[16px] border border-sky-200 bg-white p-2">
          <div className="text-[11px] font-medium text-slate-500">下：四宫格母图</div>
          {asset?.public_url ? (
            <button type="button" onClick={() => onPreview(asset.public_url || "", `四宫格母图 v${asset.version}`)} className="mt-2 block w-full">
              <HoverZoomImage
                src={asset.public_url}
                alt="四宫格母图"
                thumbClassName="h-36 w-full rounded-[12px] object-contain bg-slate-50"
              />
            </button>
          ) : (
            <div className="mt-2 flex h-36 items-center justify-center rounded-[12px] border border-dashed border-slate-200 bg-slate-50 text-xs text-slate-400">
              暂无四宫格母图
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void onGenerate()}
          disabled={Boolean(busyLabel)}
          className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busyLabel ? "生成中..." : "生成/重生成四宫格"}
        </button>
        <button
          type="button"
          onClick={onOpenPrompt}
          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          提示词
        </button>
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
              onDragStart={(event) => {
                onDragStateChange(item);
                if (item.assetId) {
                  event.dataTransfer.setData("application/x-candidate-asset-id", String(item.assetId));
                }
                event.dataTransfer.setData("application/x-candidate-url", item.src);
                event.dataTransfer.setData("text/uri-list", item.src);
                event.dataTransfer.setData("text/plain", item.src);
                event.dataTransfer.effectAllowed = "copyMove";
              }}
              onDragEnd={() => onDragStateChange(null)}
              className="cursor-grab rounded-[16px] border border-slate-200 bg-white p-2 active:cursor-grabbing"
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
          const imageSummaries = getLatestImageJobSummaries(timeline?.events || []);
          const recentEvents = (timeline?.events || [])
            .filter((event) => event.stage !== "image.runtime")
            .slice(-5)
            .reverse()
            .map((event) => displayTimelineEvent(event, timeline?.events || []));
          const blocked = Boolean(
            summary?.last_error_message || summary?.exception_level === "blocking" || summary?.main_status === "failed",
          );
          const headline = summary?.current_step || statusText(item.main_status);
          const modeLabel = getGenerationModeLabel(normalizeGenerationMode(item.generation_mode));
          const titleText = detail?.title || item.title;

          return (
            <button key={item.id} type="button" onClick={() => onOpenDrawer(item.id)} className="text-left">
              <article className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_14px_50px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_20px_70px_rgba(15,23,42,0.08)]">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span>Task #{item.id}</span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-700">
                        {modeLabel}
                      </span>
                    </div>
                    <div className="mt-2 line-clamp-2 text-base font-semibold text-slate-900">
                      {titleText}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                      <span className={["rounded-full border px-2 py-0.5", logEventStatusColor(summary?.main_status || item.main_status)].join(" ")}>
                        {statusText(summary?.main_status || item.main_status)}
                      </span>
                      <span className={["rounded-full border px-2 py-0.5", logEventStatusColor(summary?.image_status || item.image_status)].join(" ")}>
                        图片 {statusText(summary?.image_status || item.image_status)}
                      </span>
                      <span className={["rounded-full border px-2 py-0.5", logEventStatusColor(summary?.export_status || item.export_status)].join(" ")}>
                        导出 {statusText(summary?.export_status || item.export_status)}
                      </span>
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

                <div className="mt-4 rounded-[18px] border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium text-slate-900">当前卡点</div>
                      <div className="mt-1 line-clamp-1 text-[11px] text-slate-500">
                        类目：{statusText(summary?.category_status || item.category_status)} / 标题：{statusText(summary?.title_status || item.title_status)}
                      </div>
                    </div>
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
                              event.status === "success" || event.status === "completed"
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
                              logEventStatusColor(event.status),
                            ].join(" ")}
                          >
                            {event.status === "completed" ? "已完成" : statusText(event.status)}
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

                <div className="mt-3 grid gap-2 text-xs text-slate-600">
                  <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[11px] text-slate-500">图片任务</div>
                      <div className="text-[11px] text-slate-400">创建：{formatDateTime(item.created_at)}</div>
                    </div>
                    <div className="mt-2 space-y-1">
                      {imageSummaries.length ? (
                        imageSummaries.slice(0, 2).map((event, index) => (
                          <div key={`${event.stage}-${event.ts || "na"}-${index}`} className="flex items-center justify-between gap-2">
                            <span className="line-clamp-1">{event.title}</span>
                            <span className={["shrink-0 rounded-full border px-2 py-0.5 text-[10px]", logEventStatusColor(event.status)].join(" ")}>
                              {event.status === "completed" ? "已完成" : statusText(event.status)}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div>未触发图片生成</div>
                      )}
                    </div>
                  </div>
                  <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-3">
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

function actionLoadingText(action: string): string {
  const map: Record<string, string> = {
    "run-ai": "AI 生成中",
    "gen-title": "标题生成中",
    "save-title": "标题保存中",
    "save-category": "类目保存中",
    "gen-4grid": "四宫格生成中",
  };
  return map[action] || "处理中";
}

function InlineLoadingOverlay({ label }: { label: string }) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-[12px] bg-white/85 text-xs font-medium text-slate-700 shadow-inner">
      <span className="mr-2 h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />
      {label}
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
  categoryOptions,
  rowLoading,
  onQuickTitleChange,
  onQuickCategoryChange,
  onPickCandidate,
  onRunAi,
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
  categoryOptions: CategorySearchItem[];
  rowLoading: Record<number, string>;
  onQuickTitleChange: (taskId: number, value: string) => void;
  onQuickCategoryChange: (taskId: number, value: string) => void;
  onPickCandidate: (taskId: number, path: string) => void;
  onRunAi: (taskId: number) => void;
  onGenerateTitles: (taskId: number) => void;
  onSaveTitle: (taskId: number) => void;
  onSaveCategory: (taskId: number) => void;
  onGenerateFourGrid: (taskId: number) => void;
  onOpenDrawer: (taskId: number) => void;
  onDelete: (taskId: number) => void;
  onOpenPromptEditor: (fieldLabel: string, promptTypes: string[]) => void;
}) {
  return (
    <>
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
                label="英文标题"
                onEditPrompt={() => onOpenPromptEditor("英文标题", ["title_en", "title_en_only", "title_package_lite", "title_package", "product_info_from_screenshot"])}
              />
            </th>
            <th className="px-4 py-3 font-medium">
              <PromptableHeader
                label="类目处理"
                onEditPrompt={() => onOpenPromptEditor("类目处理", ["product_info_from_screenshot", "title_package"])}
              />
            </th>
            <th className="px-4 py-3 font-medium">
              <PromptableHeader
                label="SKU 图/字段"
                onEditPrompt={() => onOpenPromptEditor("SKU 图/字段", ["product_info_from_screenshot", "image_prompt_main"])}
              />
            </th>
            <th className="px-4 py-3 font-medium">
              <PromptableHeader
                label="主图 / 四宫格"
                onEditPrompt={() => onOpenPromptEditor("主图 / 四宫格", ["image_prompt_main", "image_prompt_carousel_1", "image_prompt_carousel_2", "image_prompt_carousel_3", "image_prompt_carousel_4", "image_prompt_carousel_4grid"])}
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
              const rowActionLabel = rowAction ? actionLoadingText(rowAction) : "";
              const thumbnail = taskThumbnail(item, meta);
              const fourGridSlotKeys = ["carousel_1", "carousel_2", "carousel_3", "carousel_4"] as const;
              const fourGridImages = fourGridSlotKeys.map((slot) => tableSlotImage(meta?.assets, meta?.raw, slot));
              const fourGridAssetCount =
                (meta?.assets?.carousel_1?.length || 0) +
                (meta?.assets?.carousel_2?.length || 0) +
                (meta?.assets?.carousel_3?.length || 0) +
                (meta?.assets?.carousel_4?.length || 0);
              const fourGridParentCount = meta?.assets?.carousel_4grid?.length || 0;
              const fourGridParent = selectedSlotAsset(meta?.assets, "carousel_4grid");
              const hasFourGrid = fourGridImages.some((image) => image.publicUrl) || Boolean(fourGridParent?.public_url);
              const confirmedFourGridCount = fourGridImages.filter((image) => image.asset?.public_url).length;
              const visibleFourGridCount = fourGridImages.filter((image) => image.publicUrl).length;
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
              const originalEnTitleText = String(meta?.raw?.title || item.title || "").trim() || "暂无原始标题";
              const aiTitleCnText = detail?.ai?.title_cn || (item.main_status === "ai_running" ? "AI 处理中" : "待生成");
              const aiTitleEnText = detail?.ai?.title_en ? detail.ai.title_en : item.main_status === "ai_running" ? "AI 处理中" : "待生成";
              const aiCategoryText = detail?.ai?.category_best_path || item.selected_category_id || "";
              const rawCategoryText = meta?.raw?.category_path || "";
              const quickTitle = quickTitleDrafts[item.id] ?? String(meta?.exportDraft?.fields_json?.product_title_en || detail?.ai?.title_en || "").trim();
              const quickCategory = quickCategoryDrafts[item.id] ?? detail?.selected_category_id ?? detail?.ai?.category_best_path ?? "";
              const preferredCategoryPaths = [
                ...(detail?.ai?.category_top3 || []).map((candidate) => candidate.path),
                ...(((detail?.ai?.category_candidates || []) as { path: string }[]).map((candidate) => candidate.path)),
                detail?.selected_category_id || "",
                detail?.ai?.category_best_path || "",
                meta?.raw?.category_path || "",
              ].filter(Boolean);

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
                    <div className="relative w-[280px] space-y-2">
                      {rowAction === "run-ai" || rowAction === "gen-title" ? (
                        <InlineLoadingOverlay label={rowActionLabel} />
                      ) : null}
                      <div className="rounded-[12px] border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                        <div className="text-[11px] text-slate-500">原英文标题（采集）</div>
                        <HoverTitleText value={originalEnTitleText} />
                        {/* <div className="mt-2 text-[11px] text-slate-500">AI 中文标题</div>
                        <HoverTitleText value={aiTitleCnText} /> */}
                      </div>
                      <div className="rounded-[12px] border border-sky-200 bg-sky-50 p-3 text-xs text-slate-600">
                        <div className="text-[11px] text-slate-500">AI 中文标题</div>
                        <HoverTitleText value={aiTitleCnText} />
                      </div>
                      <input
                        value={quickTitle}
                        onChange={(event) => onQuickTitleChange(item.id, event.target.value)}
                        className="h-10 w-full rounded-[12px] border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                        placeholder="可修改的英文上架标题"
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => onRunAi(item.id)}
                          disabled={rowAction !== ""}
                          className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                        >
                          {rowAction === "run-ai" ? "AI生成中..." : "重新 AI生成"}
                        </button>
                        <button
                          type="button"
                          onClick={() => onGenerateTitles(item.id)}
                          disabled={rowAction !== ""}
                          className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                        >
                          {rowAction === "gen-title" ? "生成中..." : "重生成标题"}
                        </button>
                        <button
                          type="button"
                          onClick={() => onSaveTitle(item.id)}
                          disabled={rowAction !== ""}
                          className="rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-xs text-white hover:bg-slate-800"
                        >
                          {rowAction === "save-title" ? "保存中..." : "保存英文标题"}
                        </button>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="w-[250px] space-y-2">
                      <div className="rounded-[12px] border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
                        AI：{aiCategoryText || statusText(item.category_status)}
                      </div>
                      {rawCategoryText ? (
                        <div className="rounded-[12px] border border-slate-300 bg-slate-100 p-2 text-xs text-slate-500">
                          原：{rawCategoryText}
                        </div>
                      ) : null}
                      <SearchableCategoryInput
                        value={quickCategory}
                        onChange={(value) => onQuickCategoryChange(item.id, value)}
                        onSelect={(path) => onQuickCategoryChange(item.id, path)}
                        allOptions={categoryOptions}
                        preferredPaths={preferredCategoryPaths}
                        className="w-full"
                        minHeight={40}
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
                        <TableFourGridCell
                          parentAsset={fourGridParent}
                          slotImages={fourGridImages}
                          busyLabel={rowAction === "gen-4grid" ? rowActionLabel : item.image_status === "running" || item.main_status === "image_running" ? "图片生成中" : null}
                        />
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] text-slate-600">
                            前 4 位 {visibleFourGridCount}/4
                          </span>
                          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] text-slate-600">
                            已确认 {confirmedFourGridCount}/4
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
                            disabled={rowAction !== ""}
                            className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {rowAction === "gen-4grid" ? "生成中..." : "重生成"}
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
                          disabled={rowAction !== ""}
                          className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {rowAction === "gen-4grid" ? "生成中..." : "生成四宫格"}
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <TableCarouselFieldCell
                      assets={meta?.assets}
                      raw={meta?.raw || null}
                      busyLabel={rowAction === "gen-4grid" ? rowActionLabel : item.image_status === "running" || item.main_status === "image_running" ? "图片生成中" : null}
                    />
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
                        onClick={() => onRunAi(item.id)}
                        disabled={rowAction !== ""}
                        className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                      >
                        {rowAction === "run-ai" ? "AI生成中..." : "重新AI生成"}
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
                      {rowAction ? (
                        <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
                          处理中：{rowAction}
                        </span>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
        </table>
      </div>
    </>
  );
}

function TableFourGridCell({
  parentAsset,
  slotImages,
  busyLabel,
}: {
  parentAsset: ProductAsset | null;
  slotImages: TableSlotImage[];
  busyLabel?: string | null;
}) {
  return (
    <div className="relative w-[180px] space-y-2">
      {busyLabel ? <InlineLoadingOverlay label={busyLabel} /> : null}
      <div className="rounded-[12px] border border-amber-200 bg-amber-50 p-2">
        <div className="mb-1 text-center text-[10px] text-amber-700">四宫格母图</div>
        <div className="flex justify-center">
          <TableMiniImage asset={parentAsset} fallback="母图" highlight />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {slotImages.map((image, index) => (
          <div key={image.slot} className="space-y-1">
            <div className="text-center text-[10px] text-slate-400">{index + 1}</div>
            <TableMiniImage asset={image.asset} rawUrl={image.rawUrl} fallback={String(index + 1)} />
          </div>
        ))}
      </div>
    </div>
  );
}

function TableCarouselFieldCell({
  assets,
  raw,
  busyLabel,
}: {
  assets: AssetsBySlotResponse | undefined;
  raw: RawProductDetail | null;
  busyLabel?: string | null;
}) {
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
  const slotImages = carouselSlots.map((slot) => tableSlotImage(assets, raw, slot));
  const confirmedCount = slotImages.filter((item) => item.asset?.public_url).length;
  const visibleCount = slotImages.filter((item) => item.publicUrl).length;

  return (
    <div className="relative w-[180px] space-y-2">
      {busyLabel ? <InlineLoadingOverlay label={busyLabel} /> : null}
      <div className="grid grid-cols-4 gap-1">
        {slotImages.map((image, index) => (
          <div key={image.slot} className="space-y-1">
            <div className="text-center text-[10px] text-slate-400">{index + 1}</div>
            <TableMiniImage asset={image.asset} rawUrl={image.rawUrl} fallback={String(index + 1)} />
          </div>
        ))}
      </div>
      <div className="text-[11px] text-slate-500">
        当前显示 {visibleCount} 张；已确认 {confirmedCount} 张。无手选/AI 图时回显采集轮播图。
      </div>
    </div>
  );
}

function TableMiniImage({
  asset,
  rawUrl,
  fallback,
  highlight = false,
}: {
  asset: ProductAsset | null;
  rawUrl?: string | null;
  fallback: string;
  highlight?: boolean;
}) {
  const src = asset?.public_url || rawUrl || null;
  if (!src) {
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
      src={src}
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
    return <InfoTab task={task} raw={raw} timeline={timeline} onRefresh={onRefresh} isLogsRoute={isLogsRoute} />;
  }

  if (tab === "trace") {
    return <TraceTab task={task} raw={raw} timeline={timeline} isLogsRoute={isLogsRoute} />;
  }

  if (isLogsRoute) {
    return <InfoTab task={task} raw={raw} timeline={timeline} onRefresh={onRefresh} isLogsRoute={isLogsRoute} />;
  }

  if (tab === "images") {
    return <ImagesTab task={task} raw={raw} onRefresh={onRefresh} onOpenPromptEditor={onOpenPromptEditor} />;
  }

  if (tab === "defaults") {
    return <DefaultsTab task={task} raw={raw} />;
  }

  return <RawDataTab task={task} raw={raw} />;
}

function CompareCard({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "raw" | "ai" | "final" | "neutral";
  items: { label: string; value: string }[];
}) {
  const toneClass =
    tone === "raw"
      ? "border-slate-200 bg-slate-50"
      : tone === "ai"
        ? "border-sky-200 bg-sky-50"
        : tone === "neutral"
          ? "border-slate-300 bg-slate-100"
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
  const allEvents = timeline?.events || [];
  const aiEvents = dedupeCompatAiEvents(allEvents.filter((event) => String(event.stage).startsWith("ai.")));
  const modelEvents = aiEvents.filter(isModelCallEvent);
  const codeStepEvents = aiEvents.filter((event) => !isModelCallEvent(event));
  const backendEvents = allEvents.filter((event) => !String(event.stage).startsWith("ai."));
  const normMode = normalizeGenerationMode(task.generation_mode);
  const categoryEvent = aiEvents.find((event) => event.stage === "ai.category_match") || null;
  const categoryOutput = ((categoryEvent?.meta?.output as Record<string, unknown> | undefined) || {});
  const categoryInput = ((categoryEvent?.meta?.input as Record<string, unknown> | undefined) || {});
  const categoryQueries = (((categoryInput.queries as Record<string, unknown> | undefined)?.queries as unknown[]) || [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  const categoryQuerySources = (((categoryInput.queries as Record<string, unknown> | undefined)?.query_sources as unknown[]) || [])
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  const categoryCandidates = ((categoryOutput.candidates as unknown[]) || [])
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  const categoryKeywords = ((categoryOutput.category_search_keywords as unknown[]) || [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  const runtimeFromEvents =
    ((aiEvents.find((event) => event.meta?.runtime)?.meta?.runtime as Record<string, unknown> | undefined) || {});
  const timelineEventsForDisplay = allEvents;
  const expectedModelStages = (() => {
    const normMode = normalizeGenerationMode(task.generation_mode);
    if (normMode === "title_only") {
      return task.include_product_info
        ? ["ai.product_info", "ai.title_package"]
        : ["ai.title_package"];
    }
    if (normMode === "title_and_4grid") {
      return task.include_product_info
        ? ["ai.product_info", "ai.title_package"]
        : ["ai.title_package"];
    }
    return [];
  })();
  const flowPlan = (() => {
    const normMode = normalizeGenerationMode(task.generation_mode);
    if (normMode === "title_only") {
      return [
        { label: "商品理解", value: task.include_product_info ? "product_info_from_screenshot -> 先生成商品摘要，补充标题上下文" : "已关闭，标题只使用原始采集字段" },
        { label: "标题生成", value: "title_package -> 生成中英文标题 + 类目检索关键词" },
        { label: "类目处理", value: "category_match -> 基于 AI 检索词和原始字段做代码字典召回，默认采用第 1 候选" },
      ];
    }
    if (normMode === "title_and_4grid") {
      return [
        { label: "商品理解", value: task.include_product_info ? "product_info_from_screenshot -> 输出商品摘要和四宫格元素" : "已关闭，四宫格使用原始采集字段补上下文" },
        { label: "标题生成", value: "title_package -> 生成中英文标题 + 类目检索关键词" },
        { label: "类目处理", value: "category_match -> 结合标题关键词和原始字段做代码字典检索" },
        { label: "图片提示词上下文", value: "image_prompt_package -> 代码拼装精简上下文，不调模型；真正耗 token 的是后续图片模型出图" },
        { label: "四宫格出图", value: "bootstrap -> image_prompt_carousel_4grid -> 自动生成母图并裁切 carousel_1~4" },
      ];
    }
    return [{ label: "当前模式", value: "task_only，不触发 AI，只保留原始采集和人工处理。" }];
  })();
  const totalPromptTokens = modelEvents.reduce((sum, event) => sum + Number((event.meta?.usage as Record<string, unknown> | undefined)?.prompt_tokens || 0), 0);
  const totalCompletionTokens = modelEvents.reduce((sum, event) => sum + Number((event.meta?.usage as Record<string, unknown> | undefined)?.completion_tokens || 0), 0);
  const totalTokens = modelEvents.reduce((sum, event) => sum + Number((event.meta?.usage as Record<string, unknown> | undefined)?.total_tokens || 0), 0);
  const totalEstimatedCost = modelEvents.reduce((sum, event) => {
    const cost = Number((event.meta?.cost as Record<string, unknown> | undefined)?.estimated_cost);
    return sum + (Number.isFinite(cost) ? cost : 0);
  }, 0);
  const costCurrency = String(
    ((modelEvents.find((event) => (event.meta?.cost as Record<string, unknown> | undefined)?.currency)?.meta?.cost as Record<string, unknown> | undefined)?.currency ||
      (runtimeFromEvents.pricing as Record<string, unknown> | undefined)?.currency ||
      "USD"),
  );
  const aiStepRows = modelEvents.map((event) => {
    const runtime = (event.meta?.runtime as Record<string, unknown> | undefined) || {};
    const promptTemplate = (event.meta?.prompt_template as Record<string, unknown> | undefined) || {};
    const usage = (event.meta?.usage as Record<string, unknown> | undefined) || {};
    const cost = (event.meta?.cost as Record<string, unknown> | undefined) || {};
    const provider = (event.meta?.provider as Record<string, unknown> | undefined) || {};
    return {
      step: event.title,
      stage: event.stage,
      status: event.status,
      promptType: String(event.meta?.prompt_type || "-"),
      provider: String(provider.provider_display_name || runtime.provider_display_name || provider.provider_name || runtime.provider_name || "-"),
      providerSource: String(provider.provider_source || runtime.provider_source || "-"),
      model: String(event.meta?.model || runtime.model || "-"),
      templateId: String(promptTemplate.template_id || "-"),
      templateVersion: String(promptTemplate.version || "-"),
      scope: String(promptTemplate.scope || "-"),
      durationMs: String(event.meta?.duration_ms || 0),
      promptTokens: Number(usage.prompt_tokens || 0),
      completionTokens: Number(usage.completion_tokens || 0),
      totalTokens: Number(usage.total_tokens || 0),
      estimatedCost: Number(cost.estimated_cost),
      currency: String(cost.currency || costCurrency),
    };
  });
  const processChecks = [
    {
      key: "task_created",
      label: "任务创建",
      hint: "是否已经从 raw_product 生成 product_task。",
      done: allEvents.some((event) => event.stage === "task.created"),
      status: "success",
    },
    {
      key: "product_info",
      label: "商品理解",
      hint: task.include_product_info ? "是否跑过商品理解 / 截图理解。" : "创建任务时已关闭商品理解。",
      done: aiEvents.some((event) => event.stage === "ai.product_info" && event.status === "success"),
      status:
        !task.include_product_info || normMode === "task_only"
          ? "skipped"
          : task.main_status === "failed" && task.title_status === "failed"
            ? "failed"
            : task.main_status === "ai_running"
              ? "running"
              : "pending",
    },
    {
      key: "category_match",
      label: "类目处理",
      hint: "是否基于标题检索关键词和原始字段产出候选类目。",
      done: aiEvents.some((event) => event.stage === "ai.category_match" && event.status === "success") || Boolean(task.selected_category_id),
      status: task.category_status,
    },
    {
      key: "title_package",
      label: "标题包",
      hint: normMode === "title_only" ? "应只调用一次标题 AI，直接返回中英标题。" : "是否生成标题包并回写任务标题。",
      done: aiEvents.some((event) => event.stage === "ai.title_package" && event.status === "success") || Boolean(task.ai?.title_package),
      status: task.title_status,
    },
    {
      key: "image_prompt_package",
      label: "图片提示词上下文",
      hint:
        normMode === "title_only"
          ? "当前模式应跳过该步骤。"
          : "是否已基于商品理解、标题包和类目结果生成动态图片提示词上下文（不调 AI）。",
      done: aiEvents.some((event) => event.stage === "ai.image_prompt_package" && event.status === "success") || Boolean(task.ai?.image_prompt_package),
      status: normMode === "title_only" ? "skipped" : task.image_prompt_status,
    },
    {
      key: "image_jobs",
      label: "图片任务",
      hint: "是否创建过 image_generation_jobs。",
      done: backendEvents.some((event) => String(event.stage).startsWith("image.")),
      status: task.image_status,
    },
    {
      key: "export_draft",
      label: "导出草稿",
      hint: "是否生成过 export_field_drafts。",
      done: backendEvents.some((event) => String(event.stage).startsWith("export.")),
      status: task.export_status,
    },
  ];
  const defaultChainChecks = (() => {
    if (normMode === "title_only") {
      return [
        processChecks[0],
        {
          key: "material_sync",
          label: "素材回显",
          hint: "原始主图、轮播图、SKU 图等素材应同步到上架台，供后续按需生成图片。",
          done: Boolean(raw) || Boolean(task.screenshot_url) || Boolean(task.source_url),
          status: "success",
        },
        processChecks[3],
        processChecks[2],
        {
          key: "manual_review",
          label: "人工待确认",
          hint: "默认第 1 候选类目和 AI 标题都需要人工确认后再继续图片或导出动作。",
          done: task.main_status === "review_ready" || task.main_status === "export_ready" || task.main_status === "exported",
          status: task.main_status === "failed" ? "failed" : task.main_status === "ai_running" ? "running" : "pending",
        },
      ];
    }
    return processChecks.slice(0, 5);
  })();
  const followupChecks = [
    {
      key: "image_jobs_followup",
      label: "图片任务",
      hint: "主图、SKU 图、四宫格、轮播图都属于创建任务后的主动触发动作。",
      done: backendEvents.some((event) => String(event.stage).startsWith("image.")),
      status: task.image_status,
    },
    {
      key: "export_draft_followup",
      label: "导出草稿",
      hint: "导出草稿不属于创建任务默认链路，通常在预览、导出或应用规则时生成。",
      done: backendEvents.some((event) => String(event.stage).startsWith("export.")),
      status: task.export_status,
    },
  ];
  const compactImageSummaries = getLatestImageJobSummaries(allEvents);
  const compactTimelineEvents = timelineEventsForDisplay
    .map((event) => displayTimelineEvent(event, allEvents));

  if (isLogsRoute) {
    return (
      <div className="space-y-4">
        <section className="rounded-[22px] border border-slate-200 bg-slate-950 p-5 text-white">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs text-slate-300">Task #{task.id} / Raw #{task.raw_product_id}</div>
              <div className="mt-2 line-clamp-2 text-xl font-semibold">{task.title}</div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1">
                  {getGenerationModeLabel(normMode)}
                </span>
                <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1">
                  当前：{timeline?.summary.current_step || statusText(task.main_status)}
                </span>
                <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1">
                  创建：{formatDateTime(task.created_at)}
                </span>
              </div>
            </div>
            <div className="grid min-w-[260px] gap-2 text-xs sm:grid-cols-2">
              {[
                ["主状态", statusText(task.main_status)],
                ["类目", statusText(task.category_status)],
                ["标题", statusText(task.title_status)],
                ["图片", statusText(task.image_status)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-[14px] border border-white/10 bg-white/10 px-3 py-2">
                  <div className="text-slate-300">{label}</div>
                  <div className="mt-1 font-medium text-white">{value}</div>
                </div>
              ))}
            </div>
          </div>
          {task.last_error_message ? (
            <div className="mt-4 rounded-[16px] border border-rose-300/30 bg-rose-500/15 p-3 text-sm text-rose-100">
              最后报错：{task.last_error_message}
            </div>
          ) : null}
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[22px] border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">默认链路</div>
                <div className="mt-1 text-xs text-slate-500">只看创建任务后默认会跑的步骤，按当前模式判断跳过项。</div>
              </div>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
                {normMode}
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {defaultChainChecks.map((item, index) => (
                <div key={item.key} className="grid grid-cols-[28px_1fr_auto] gap-3 rounded-[16px] border border-slate-200 bg-slate-50 p-3">
                  <div className={["flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold", item.done ? "bg-emerald-100 text-emerald-700" : String(item.status) === "failed" ? "bg-rose-100 text-rose-700" : String(item.status) === "running" ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-500"].join(" ")}>
                    {index + 1}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-slate-900">{item.label}</div>
                    <div className="mt-1 text-xs leading-5 text-slate-500">{item.hint}</div>
                  </div>
                  <span className={["h-fit rounded-full border px-2 py-0.5 text-[11px]", item.done ? "border-emerald-200 bg-white text-emerald-700" : logEventStatusColor(String(item.status))].join(" ")}>
                    {String(item.status) === "skipped" ? "按模式跳过" : item.done ? "已完成" : statusText(String(item.status))}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[22px] border border-slate-200 bg-white p-5">
            <div className="text-sm font-semibold text-slate-900">主动触发项</div>
            <div className="mt-1 text-xs text-slate-500">图片生成和导出草稿不是所有模式都会自动执行，优先按这里判断是否真的触发过。</div>
            <div className="mt-4 space-y-3">
              {followupChecks.map((item) => (
                <div key={item.key} className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-slate-900">{item.label}</div>
                    <span className={["rounded-full border px-2 py-0.5 text-[11px]", item.done ? "border-emerald-200 bg-white text-emerald-700" : logEventStatusColor(String(item.status))].join(" ")}>
                      {item.done ? "已触发" : "未触发"}
                    </span>
                  </div>
                  <div className="mt-2 text-xs leading-5 text-slate-600">{item.hint}</div>
                </div>
              ))}
              <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-medium text-slate-900">图片任务结果</div>
                <div className="mt-3 space-y-2">
                  {compactImageSummaries.length ? (
                    compactImageSummaries.map((event, index) => (
                      <div key={`${event.stage}-${event.ts || "na"}-${index}`} className="rounded-[14px] border border-slate-200 bg-white p-3 text-xs">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-medium text-slate-800">{event.title}</div>
                            <div className="mt-1 line-clamp-1 text-slate-500">{event.message}</div>
                            <div className="mt-1 text-slate-500">
                              {String(event.meta?.provider || "-")} / {String(event.meta?.model_name || "-")}
                              {event.meta?.estimated_cost != null
                                ? ` · 预估 ${formatMoney(event.meta.estimated_cost, String(event.meta.currency || "USD"))}`
                                : ""}
                            </div>
                          </div>
                          <span className={["shrink-0 rounded-full border px-2 py-0.5 text-[11px]", logEventStatusColor(event.status)].join(" ")}>
                            {event.status === "completed" ? "已完成" : statusText(event.status)}
                          </span>
                        </div>
                        <details className="mt-2 rounded-[12px] border border-slate-200 bg-slate-50">
                          <summary className="cursor-pointer list-none px-3 py-2 text-[11px] text-slate-600">
                            查看四宫格返回 / Prompt
                          </summary>
                          <div className="border-t border-slate-200 p-3">
                            <div className="text-[11px] font-medium text-slate-500">输出资产</div>
                            <pre className="mt-1 max-h-[120px] overflow-auto rounded-[10px] bg-white p-2 text-[11px] text-slate-700">
                              {formatJson({
                                parent_asset_id: event.meta?.parent_asset_id,
                                output_asset_ids: event.meta?.output_asset_ids,
                                error_message: event.meta?.error_message,
                              })}
                            </pre>
                            <div className="mt-3 text-[11px] font-medium text-slate-500">最终生图 Prompt</div>
                            <pre className="mt-1 max-h-[220px] overflow-auto rounded-[10px] bg-white p-2 text-[11px] text-slate-700">
                              {String(event.meta?.final_prompt || "-")}
                            </pre>
                          </div>
                        </details>
                      </div>
                    ))
                  ) : (
                    <div className="text-xs text-slate-500">暂无图片任务记录。</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        <Section title="全流程时间线">
          {compactTimelineEvents.length ? (
            <div className="space-y-3">
              {compactTimelineEvents.map((event, index) => (
                <div key={`${event.stage}-${event.ts || "na"}-${index}`} className="rounded-[16px] border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500">
                          #{index + 1}
                        </span>
                        <span className="text-sm font-medium text-slate-900">{event.title}</span>
                        <span className={["rounded-full border px-2 py-0.5 text-[11px]", logEventStatusColor(event.status)].join(" ")}>
                          {event.status === "completed" ? "已完成" : statusText(event.status)}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {formatDateTime(event.ts)} · {event.stage}
                      </div>
                      <div className="mt-2 whitespace-pre-wrap break-all text-sm text-slate-700">{event.message}</div>
                      {isModelCallEvent(event) ? (
                        <div className="mt-2 rounded-[12px] border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
                          {modelCallSummary(event, costCurrency)}
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => void copyTraceEvent(event)}
                      className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                    >
                      复制事件
                    </button>
                  </div>
                  <details className="mt-3 rounded-[14px] border border-slate-200 bg-slate-50">
                    <summary className="cursor-pointer list-none px-3 py-2 text-xs text-slate-600">
                      查看元数据
                    </summary>
                    <pre className="overflow-auto border-t border-slate-200 p-3 text-xs text-slate-700">
                      {formatJson(event.meta)}
                    </pre>
                  </details>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-slate-600">暂无时间线事件</div>
          )}
        </Section>

        <Section title="模型调用明细">
          <div className="mb-3 grid gap-3 md:grid-cols-3">
            <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs text-slate-500">本次模型调用</div>
              <div className="mt-1 text-lg font-semibold text-slate-900">{modelEvents.length} 次</div>
            </div>
            <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs text-slate-500">Tokens</div>
              <div className="mt-1 text-lg font-semibold text-slate-900">
                {totalTokens ? `${formatInteger(totalTokens)}（in ${formatInteger(totalPromptTokens)} / out ${formatInteger(totalCompletionTokens)}）` : "-"}
              </div>
            </div>
            <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs text-slate-500">预估费用</div>
              <div className="mt-1 text-lg font-semibold text-slate-900">
                {totalEstimatedCost ? formatMoney(totalEstimatedCost, costCurrency) : "-"}
              </div>
            </div>
          </div>
          {modelEvents.length ? (
            <div className="space-y-3">
              {modelEvents.map((event, index) => (
                <details key={`${event.stage}-${event.ts || "na"}-${index}`} className="rounded-[16px] border border-slate-200 bg-white">
                  <summary className="cursor-pointer list-none px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-slate-900">{event.title}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {formatDateTime(event.ts)} · {event.stage} · {String(event.meta?.prompt_type || "-")}
                        </div>
                        <div className="mt-1 text-xs text-slate-700">
                          {modelCallSummary(event, costCurrency)}
                        </div>
                      </div>
                      <span className={["rounded-full border px-2 py-0.5 text-[11px]", logEventStatusColor(event.status)].join(" ")}>
                        {statusText(event.status)}
                      </span>
                    </div>
                  </summary>
                  <div className="grid gap-3 border-t border-slate-200 p-4 xl:grid-cols-3">
                    <pre className="max-h-[360px] overflow-auto rounded-[14px] border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                      {formatJson(event.meta?.input)}
                    </pre>
                    <pre className="max-h-[360px] overflow-auto rounded-[14px] border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                      {typeof event.meta?.prompt === "string" && event.meta.prompt ? event.meta.prompt : "-"}
                    </pre>
                    <pre className="max-h-[360px] overflow-auto rounded-[14px] border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                      {formatJson(event.meta?.output)}
                    </pre>
                  </div>
                </details>
              ))}
            </div>
          ) : (
            <div className="text-sm text-slate-600">暂无真实模型调用记录。代码召回、动态图片提示词上下文不会计入这里。</div>
          )}
        </Section>

        <Section title="代码处理步骤">
          {codeStepEvents.length ? (
            <div className="space-y-3">
              {codeStepEvents.map((event, index) => (
                <div key={`${event.stage}-${event.ts || "na"}-${index}`} className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-slate-900">{event.title}</div>
                      <div className="mt-1 text-xs text-slate-500">{formatDateTime(event.ts)} · {event.stage}</div>
                      <div className="mt-2 text-sm text-slate-700">{event.message}</div>
                    </div>
                    <span className={["rounded-full border px-2 py-0.5 text-[11px]", logEventStatusColor(event.status)].join(" ")}>
                      {statusText(event.status)}
                    </span>
                  </div>
                  <details className="mt-3 rounded-[14px] border border-slate-200 bg-white">
                    <summary className="cursor-pointer list-none px-3 py-2 text-xs text-slate-600">
                      查看代码步骤输出
                    </summary>
                    <pre className="max-h-[360px] overflow-auto border-t border-slate-200 p-3 text-xs text-slate-700">
                      {formatJson(event.meta?.output)}
                    </pre>
                  </details>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-slate-600">暂无代码处理步骤。</div>
          )}
        </Section>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Section title="排查总览">
        <div className="grid gap-4 xl:grid-cols-4">
          <CompareCard
            title="任务定位"
            tone="final"
            items={[
              { label: "任务 ID", value: String(task.id) },
              { label: "原始采集 ID", value: String(task.raw_product_id) },
              { label: "生成模式", value: task.generation_mode },
              { label: "当前步骤", value: timeline?.summary.current_step || statusText(task.main_status) },
            ]}
          />
          <CompareCard
            title="当前状态"
            tone="ai"
            items={[
              { label: "主状态", value: statusText(task.main_status) },
              { label: "类目状态", value: statusText(task.category_status) },
              { label: "标题状态", value: statusText(task.title_status) },
              { label: "图片提示词", value: statusText(task.image_prompt_status) },
            ]}
          />
          <CompareCard
            title="流程结果"
            tone="final"
            items={[
              { label: "图片状态", value: statusText(task.image_status) },
              { label: "导出状态", value: statusText(task.export_status) },
              { label: "选中类目", value: task.selected_category_id || task.ai?.category_best_path || "-" },
              { label: "当前标题", value: task.title || "-" },
            ]}
          />
          <CompareCard
            title="异常与时间"
            tone="raw"
            items={[
              { label: "异常等级", value: task.exception_level || "-" },
              { label: "异常状态", value: task.exception_status || "-" },
              { label: "最后报错", value: task.last_error_message || "-" },
              { label: "创建时间", value: formatDateTime(task.created_at) },
            ]}
          />
        </div>
      </Section>

      <Section title="模式说明">
        <div className="grid gap-4 xl:grid-cols-3">
          <CompareCard
            title="默认链路"
            tone="final"
            items={
              normMode === "title_only"
                ? [
                    { label: "模式定义", value: task.include_product_info ? "商品理解 + 中英文标题 + 代码类目召回" : "中英文标题 + 代码类目召回" },
                    { label: "默认 AI 次数", value: task.include_product_info ? "2 次" : "1 次" },
                    { label: "默认图片生成", value: "0 次" },
                    { label: "默认结果", value: "标题、类目检索字段、默认第 1 候选类目" },
                  ]
                : flowPlan
            }
          />
          <CompareCard
            title="字段来源"
            tone="raw"
            items={[
              { label: "轮播图 / SKU 图", value: "原始回显" },
              { label: "标题", value: normMode === "task_only" ? "原始回显" : "AI 生成" },
              { label: "类目检索词", value: normMode === "task_only" ? "-" : "AI 生成" },
              { label: "默认候选类目", value: normMode === "task_only" ? "人工搜索" : "代码召回" },
            ]}
          />
          <CompareCard
            title="后续动作"
            tone="ai"
            items={[
              { label: "主图 / SKU 图", value: "用户主动生成" },
              { label: "四宫格 / 轮播图", value: "用户主动生成" },
              { label: "导出草稿", value: "预览或导出时触发" },
              { label: "导出执行", value: "人工确认后触发" },
            ]}
          />
        </div>
      </Section>

      <Section title="类目处理">
        <div className="grid gap-4 xl:grid-cols-4">
          <CompareCard
            title="原始采集类目"
            tone="neutral"
            items={[
              { label: "采集时抓取的类目", value: raw?.category_path || "-" },
            ]}
          />
          <CompareCard
            title="类目定位"
            tone="final"
            items={[
              { label: "默认第 1 候选", value: String(categoryOutput.selected_category || categoryOutput.best_path || task.selected_category_id || "-") },
              { label: "候选数量", value: String(categoryCandidates.length || 0) },
              { label: "人工选中类目", value: task.selected_category_id || "-" },
            ]}
          />
          <CompareCard
            title="AI 检索字段"
            tone="ai"
            items={[
              { label: "检索关键词", value: categoryKeywords.length ? categoryKeywords.join(" / ") : "-" },
              { label: "类目置信度", value: categoryOutput.confidence != null ? String(categoryOutput.confidence) : "-" },
            ]}
          />
          <CompareCard
            title="代码召回"
            tone="raw"
            items={[
              { label: "实际 query", value: categoryQueries.length ? categoryQueries.join(" / ") : "-" },
              { label: "低置信度", value: task.category_status === "low_confidence" ? "是" : "否" },
              { label: "状态", value: statusText(task.category_status) },
              { label: "说明", value: categoryCandidates.length ? "AI 只提供检索字段，最终候选由代码字典召回。" : "暂无类目召回结果" },
            ]}
          />
        </div>

        {categoryQuerySources.length ? (
          <div className="mt-4 rounded-[18px] border border-slate-200 bg-white p-4">
            <div className="text-sm font-medium text-slate-900">Query 来源</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {categoryQuerySources.map((item, index) => (
                <span key={`${String(item.source || "na")}-${String(item.field || "na")}-${index}`} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700">
                  {String(item.source || "-")} / {String(item.field || "-")}: {String(item.value || "-")}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-4 overflow-x-auto rounded-[18px] border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 bg-white text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">排名</th>
                <th className="px-4 py-3 font-medium">类目路径</th>
                <th className="px-4 py-3 font-medium">分数</th>
                <th className="px-4 py-3 font-medium">命中词</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {categoryCandidates.length ? (
                categoryCandidates.slice(0, 8).map((item, index) => (
                  <tr key={`${String(item.path || "na")}-${index}`}>
                    <td className="px-4 py-3 text-xs text-slate-700">{index + 1}</td>
                    <td className="px-4 py-3">
                      <div className="text-slate-900">{String(item.path || "-")}</div>
                      {index === 0 ? (
                        <div className="mt-1 text-xs text-emerald-700">默认第 1 候选</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">{String(item.score ?? "-")}</td>
                    <td className="px-4 py-3 text-xs text-slate-700">
                      {Array.isArray(item.matched_terms) && item.matched_terms.length
                        ? item.matched_terms.map((term) => String(term || "").trim()).filter(Boolean).join(" / ")
                        : "-"}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-500">
                    暂无类目候选记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="AI 配置与步骤调用">
        <div className="grid gap-4 xl:grid-cols-3">
          <CompareCard
            title="本次 AI 运行配置"
            tone="ai"
            items={[
              { label: "配置来源", value: String(runtimeFromEvents.provider_source || "-") },
              { label: "Provider", value: String(runtimeFromEvents.provider_display_name || runtimeFromEvents.provider_name || "-") },
              { label: "默认模型", value: String(runtimeFromEvents.model || "-") },
              { label: "输入 / 输出", value: totalTokens ? `${formatInteger(totalPromptTokens)} / ${formatInteger(totalCompletionTokens)}` : "-" },
              { label: "总 Tokens", value: totalTokens ? formatInteger(totalTokens) : "-" },
              { label: "解析时间", value: runtimeFromEvents.resolved_at ? formatDateTime(String(runtimeFromEvents.resolved_at)) : "-" },
            ]}
          />
          <CompareCard
            title="文本链路说明"
            tone="final"
            items={flowPlan}
          />
          <CompareCard
            title="当前排查重点"
            tone="raw"
            items={[
              { label: "模型 / 代码步骤", value: `${modelEvents.length} / ${codeStepEvents.length}` },
              { label: "后端动作数", value: String(backendEvents.length) },
              { label: "预估费用", value: totalEstimatedCost ? formatMoney(totalEstimatedCost, costCurrency) : "-" },
              { label: "最后报错", value: task.last_error_message || "-" },
            ]}
          />
        </div>

        <div className="mt-4 overflow-x-auto rounded-[18px] border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 bg-white text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">步骤</th>
                <th className="px-4 py-3 font-medium">prompt_type</th>
                <th className="px-4 py-3 font-medium">provider</th>
                <th className="px-4 py-3 font-medium">model</th>
                <th className="px-4 py-3 font-medium">模板</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">耗时</th>
                <th className="px-4 py-3 font-medium">Tokens</th>
                <th className="px-4 py-3 font-medium">预估费用</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {aiStepRows.length ? (
                aiStepRows.map((row) => (
                  <tr key={`${row.stage}-${row.promptType}-${row.model}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{row.step}</div>
                      <div className="mt-1 text-xs text-slate-500">{row.stage}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">{row.promptType}</td>
                    <td className="px-4 py-3">
                      <div className="text-slate-800">{row.provider}</div>
                      <div className="mt-1 text-xs text-slate-500">source: {row.providerSource}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">{row.model}</td>
                    <td className="px-4 py-3 text-xs text-slate-700">
                      <div>#{row.templateId}</div>
                      <div className="mt-1 text-slate-500">{row.templateVersion} / {row.scope}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={["rounded-full border px-2 py-1 text-xs", statusBadgeColor(row.status)].join(" ")}>
                        {statusText(row.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">{row.durationMs} ms</td>
                    <td className="px-4 py-3 text-xs text-slate-700">
                      {row.totalTokens ? (
                        <div>
                          <div>总计 {formatInteger(row.totalTokens)}</div>
                          <div className="mt-1 text-slate-500">
                            in {formatInteger(row.promptTokens)} / out {formatInteger(row.completionTokens)}
                          </div>
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">
                      {Number.isFinite(row.estimatedCost) ? formatMoney(row.estimatedCost, row.currency) : "-"}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-sm text-slate-500">
                    暂无 AI 步骤记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="默认链路检查">
        <div className="grid gap-3 xl:grid-cols-2">
          {defaultChainChecks.map((item) => {
            const tone = item.done
              ? "border-emerald-200 bg-emerald-50"
              : item.status === "failed"
                ? "border-rose-200 bg-rose-50"
                : item.status === "running"
                  ? "border-amber-200 bg-amber-50"
                  : "border-slate-200 bg-slate-50";
            return (
              <div key={item.key} className={["rounded-[16px] border p-4", tone].join(" ")}>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-slate-900">{item.label}</div>
                  <span className={["rounded-full border px-2 py-0.5 text-[11px]", item.done ? "border-emerald-200 bg-white text-emerald-700" : statusBadgeColor(String(item.status))].join(" ")}>
                    {String(item.status) === "skipped" ? "按模式跳过" : item.done ? "已发生" : `未完成 / ${statusText(String(item.status))}`}
                  </span>
                </div>
                <div className="mt-2 text-xs leading-5 text-slate-600">{item.hint}</div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="后续主动触发">
        <div className="grid gap-3 xl:grid-cols-2">
          {followupChecks.map((item) => {
            const tone = item.done
              ? "border-emerald-200 bg-emerald-50"
              : item.status === "failed"
                ? "border-rose-200 bg-rose-50"
                : item.status === "running"
                  ? "border-amber-200 bg-amber-50"
                  : "border-slate-200 bg-slate-50";
            return (
              <div key={item.key} className={["rounded-[16px] border p-4", tone].join(" ")}>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-slate-900">{item.label}</div>
                  <span className={["rounded-full border px-2 py-0.5 text-[11px]", item.done ? "border-emerald-200 bg-white text-emerald-700" : statusBadgeColor(String(item.status))].join(" ")}>
                    {item.done ? "已发生" : `未触发 / ${statusText(String(item.status))}`}
                  </span>
                </div>
                <div className="mt-2 text-xs leading-5 text-slate-600">{item.hint}</div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="原始输入摘要">
        <div className="grid gap-4 xl:grid-cols-2">
          <CompareCard
            title="原始采集"
            tone="raw"
            items={[
              { label: "原标题", value: raw?.title || task.title || "-" },
              { label: "平台", value: raw?.platform || task.product_platform || "-" },
              { label: "来源链接", value: raw?.url || task.source_url || "-" },
              { label: "平台 SKU", value: raw?.platform_sku || task.platform_sku || "-" },
            ]}
          />
          <CompareCard
            title="素材证据"
            tone="ai"
            items={[
              { label: "截图", value: raw?.screenshot_url || task.screenshot_url || "-" },
              { label: "主图张数", value: String((raw?.carousel_images?.length || 0) + (raw?.main_image ? 1 : 0)) },
              { label: "详情图张数", value: String(raw?.detail_images?.length || 0) },
              { label: "尺寸图张数", value: String(raw?.size_chart_images?.length || 0) },
            ]}
          />
        </div>
      </Section>

      <Section title={normMode === "title_only" ? "关键时间线" : "全量时间线"}>
        {timelineEventsForDisplay.length ? (
          <div className="space-y-3">
            {timelineEventsForDisplay.map((event, index) => (
              <div key={`${event.stage}-${event.ts || "na"}-${index}`} className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-500">
                        #{index + 1}
                      </span>
                      <span className="text-sm font-medium text-slate-900">{event.title}</span>
                      <span className={["rounded-full border px-2 py-0.5 text-[11px]", statusBadgeColor(event.status)].join(" ")}>
                        {statusText(event.status)}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {formatDateTime(event.ts)} · {event.stage} · {event.source}
                    </div>
                    <div className="mt-2 whitespace-pre-wrap break-all text-sm text-slate-700">{event.message}</div>
                    {String(event.stage).startsWith("ai.") ? (
                      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-600">
                        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                          prompt_type: {String(event.meta?.prompt_type || "-")}
                        </span>
                        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                          model: {String(event.meta?.model || "-")}
                        </span>
                        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                          tokens: {Number((event.meta?.usage as Record<string, unknown> | undefined)?.total_tokens || 0) ? formatInteger(Number((event.meta?.usage as Record<string, unknown> | undefined)?.total_tokens || 0)) : "-"}
                        </span>
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => void copyTraceEvent(event)}
                    className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    复制事件
                  </button>
                </div>
                {Object.keys((event.meta as Record<string, unknown>) || {}).length ? (
                  <details className="mt-3 rounded-[14px] border border-slate-200 bg-white">
                    <summary className="cursor-pointer list-none px-3 py-2 text-xs text-slate-600">
                      查看事件元数据
                    </summary>
                    <pre className="overflow-auto border-t border-slate-200 p-3 text-xs text-slate-700">
                      {formatJson(event.meta)}
                    </pre>
                  </details>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-slate-600">暂无时间线事件</div>
        )}
      </Section>

      <Section title="模型调用明细">
        {modelEvents.length ? (
          <div className="space-y-4">
            {modelEvents.map((event, index) => {
              const runtime = (event.meta?.runtime as Record<string, unknown> | undefined) || {};
              const promptTemplate = (event.meta?.prompt_template as Record<string, unknown> | undefined) || {};
              const usage = (event.meta?.usage as Record<string, unknown> | undefined) || {};
              const cost = (event.meta?.cost as Record<string, unknown> | undefined) || {};
              const provider = (event.meta?.provider as Record<string, unknown> | undefined) || {};
              return (
                <div key={`${event.stage}-${event.ts || "na"}-${index}`} className="rounded-[16px] border border-sky-200 bg-sky-50/40 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-medium text-slate-900">{event.title}</div>
                        <span className={["rounded-full border px-2 py-0.5 text-[11px]", statusBadgeColor(event.status)].join(" ")}>
                          {statusText(event.status)}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {formatDateTime(event.ts)} · {event.stage}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void copyTraceEvent(event)}
                      className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                    >
                      复制本步骤
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-600">
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                      prompt_type: {String(event.meta?.prompt_type || "-")}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                      model: {String(event.meta?.model || runtime.model || "-")}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                      provider: {String(provider.provider_display_name || runtime.provider_display_name || provider.provider_name || runtime.provider_name || "-")}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                      耗时: {String(event.meta?.duration_ms || 0)}ms
                    </span>
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                      tokens: {usage.total_tokens ? formatInteger(usage.total_tokens) : "-"}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                      费用: {cost.estimated_cost != null ? formatMoney(cost.estimated_cost, String(cost.currency || costCurrency)) : "-"}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                      模板: #{String(promptTemplate.template_id || "-")} / {String(promptTemplate.version || "-")}
                    </span>
                  </div>

                  <div className="mt-3 grid gap-3 xl:grid-cols-4">
                    <CompareCard
                      title="本步模型"
                      tone="ai"
                      items={[
                        { label: "步骤", value: event.stage },
                        { label: "prompt_type", value: String(event.meta?.prompt_type || "-") },
                        { label: "模型", value: String(event.meta?.model || runtime.model || "-") },
                        { label: "Provider", value: String(provider.provider_display_name || runtime.provider_display_name || provider.provider_name || runtime.provider_name || "-") },
                      ]}
                    />
                    <CompareCard
                      title="Token 用量"
                      tone="raw"
                      items={[
                        { label: "输入", value: usage.prompt_tokens ? formatInteger(usage.prompt_tokens) : "-" },
                        { label: "输出", value: usage.completion_tokens ? formatInteger(usage.completion_tokens) : "-" },
                        { label: "总计", value: usage.total_tokens ? formatInteger(usage.total_tokens) : "-" },
                        { label: "费用", value: cost.estimated_cost != null ? formatMoney(cost.estimated_cost, String(cost.currency || costCurrency)) : "-" },
                      ]}
                    />
                    <CompareCard
                      title="模板信息"
                      tone="final"
                      items={[
                        { label: "模板 ID", value: String(promptTemplate.template_id || "-") },
                        { label: "版本", value: String(promptTemplate.version || "-") },
                        { label: "作用域", value: String(promptTemplate.scope || "-") },
                        { label: "耗时", value: `${String(event.meta?.duration_ms || 0)}ms` },
                      ]}
                    />
                    <CompareCard
                      title="执行判断"
                      tone="ai"
                      items={[
                        { label: "状态", value: statusText(event.status) },
                        { label: "模式应执行", value: expectedModelStages.includes(event.stage) ? "是" : "否" },
                        { label: "时间", value: formatDateTime(event.ts) },
                        { label: "错误", value: event.meta?.error ? String(event.meta.error) : "-" },
                      ]}
                    />
                  </div>

                  {event.meta?.error ? (
                    <div className="mt-3 rounded-[12px] border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                      {String(event.meta.error)}
                    </div>
                  ) : null}

                  <div className="mt-3 space-y-3">
                    <details className="rounded-[14px] border border-slate-200 bg-white">
                      <summary className="cursor-pointer list-none px-3 py-2 text-xs text-slate-600">
                        查看 AI 输入
                      </summary>
                      <pre className="overflow-auto border-t border-slate-200 p-3 text-xs text-slate-700">
                        {formatJson(event.meta?.input)}
                      </pre>
                    </details>
                    <details className="rounded-[14px] border border-slate-200 bg-white">
                      <summary className="cursor-pointer list-none px-3 py-2 text-xs text-slate-600">
                        查看实际提示词
                      </summary>
                      <pre className="overflow-auto border-t border-slate-200 p-3 text-xs text-slate-700">
                        {typeof event.meta?.prompt === "string" && event.meta.prompt ? event.meta.prompt : "-"}
                      </pre>
                    </details>
                    <details className="rounded-[14px] border border-slate-200 bg-white">
                      <summary className="cursor-pointer list-none px-3 py-2 text-xs text-slate-600">
                        查看 AI 输出
                      </summary>
                      <pre className="overflow-auto border-t border-slate-200 p-3 text-xs text-slate-700">
                        {formatJson(event.meta?.output)}
                      </pre>
                    </details>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-sm text-slate-600">暂无模型调用记录</div>
        )}
      </Section>

      <Section title="后端动作明细">
        {backendEvents.length ? (
          <div className="space-y-4">
            {backendEvents.map((event, index) => (
              <div key={`${event.stage}-${event.ts || "na"}-${index}`} className="rounded-[16px] border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-medium text-slate-900">{event.title}</div>
                      <span className={["rounded-full border px-2 py-0.5 text-[11px]", statusBadgeColor(event.status)].join(" ")}>
                        {statusText(event.status)}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {formatDateTime(event.ts)} · {event.stage} · {event.source}
                    </div>
                    <div className="mt-2 whitespace-pre-wrap break-all text-sm text-slate-700">{event.message}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void copyTraceEvent(event)}
                    className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    复制本步骤
                  </button>
                </div>
                {Object.keys((event.meta as Record<string, unknown>) || {}).length ? (
                  <details className="mt-3 rounded-[14px] border border-slate-200 bg-slate-50">
                    <summary className="cursor-pointer list-none px-3 py-2 text-xs text-slate-600">
                      查看后端动作元数据
                    </summary>
                    <pre className="overflow-auto border-t border-slate-200 p-3 text-xs text-slate-700">
                      {formatJson(event.meta)}
                    </pre>
                  </details>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-slate-600">暂无后端动作记录</div>
        )}
      </Section>
    </div>
  );
}

function InfoTab({
  task,
  raw,
  timeline,
  onRefresh,
  isLogsRoute,
}: {
  task: ProductTaskDetail;
  raw: RawProductDetail | null;
  timeline: ProductTaskTimelineResponse | null;
  onRefresh?: (() => Promise<void>) | undefined;
  isLogsRoute: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualTitle, setManualTitle] = useState(task.ai?.title_en || "");
  const [manualCategory, setManualCategory] = useState(task.selected_category_id || task.ai?.category_best_path || "");
  const [categoryOptions, setCategoryOptions] = useState<CategorySearchItem[]>([]);

  useEffect(() => {
    setManualTitle(task.ai?.title_en || "");
    setManualCategory(task.selected_category_id || task.ai?.category_best_path || "");
  }, [task.id, task.title, task.selected_category_id, task.ai?.category_best_path, task.ai?.title_en]);

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
        // ignore
      }
    }
    void loadCategoryOptions();
    return () => {
      cancelled = true;
    };
  }, []);

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
        headers: buildAiRequestHeaders(false, ["title_package_lite", "title"]),
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

  const titlePackageSummary = task.ai?.title_package as
    | {
        category_search_keywords?: unknown[];
      }
    | null
    | undefined;
  const titleCategoryKeywords = ((titlePackageSummary?.category_search_keywords as unknown[]) || [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  const categoryCandidates =
    task.ai?.category_candidates?.length ? task.ai.category_candidates : ((task.category_candidates_json as { path: string; score?: number | null }[]) || []);
  const preferredCategoryPaths = [
    ...(task.ai?.category_top3 || []).map((candidate) => candidate.path),
    ...categoryCandidates.map((candidate) => candidate.path),
    task.selected_category_id || "",
    task.ai?.category_best_path || "",
  ].filter(Boolean);

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
              { label: "中文标题", value: raw?.title || task.title || "-" },
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
                  titleCategoryKeywords.join("\n") ||
                  categoryCandidates.map((item) => item.path).join("\n") ||
                  "-",
              },
            ]}
          />
          <CompareCard
            title="当前采用"
            tone="final"
            items={[
              { label: "中文标题", value: raw?.title || task.title || "-" },
              {
                label: "英文标题",
                value:
                  String((task.ai?.title_package as Record<string, unknown> | null)?.title_en || task.ai?.title_en || "-"),
              },
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
          <SearchableCategoryInput
            value={manualCategory}
            onChange={setManualCategory}
            onSelect={setManualCategory}
            allOptions={categoryOptions}
            preferredPaths={preferredCategoryPaths}
            className="mt-2"
            minHeight={44}
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
            <div className="text-xs text-slate-500">原英文标题（采集）</div>
            <div className="mt-1 text-sm text-slate-900">{raw?.title || task.title || "-"}</div>
            <div className="mt-3 text-xs text-slate-500">AI 中文标题（只读）</div>
            <div className="mt-1 text-sm text-slate-900">{task.ai?.title_cn || "-"}</div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void regenerateTitles()}
                disabled={loading}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                重生成标题
              </button>
            </div>
          </div>

          <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs text-slate-500">AI 英文标题（可修改）</div>
            <div className="mt-1 text-sm text-slate-900">{task.ai?.title_en || "-"}</div>
            <input
              value={manualTitle}
              onChange={(event) => setManualTitle(event.target.value)}
              className="mt-2 h-11 w-full rounded-[14px] border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
              placeholder={task.ai?.title_en || "输入最终英文标题"}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void applyFieldChoice("product_title_en", "ai")}
                disabled={loading || !task.ai?.title_en}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                采用 AI 英文标题
              </button>
              <button
                type="button"
                onClick={() => void applyFieldChoice("product_title_en", "manual", manualTitle)}
                disabled={loading || !manualTitle.trim()}
                className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
              >
                保存英文标题
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
            <div className="mt-1">{getGenerationModeLabel(task.generation_mode)}</div>
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
          </div>
        ) : (
          <div className="text-sm text-slate-600">暂无 AI 结果</div>
        )}
      </Section>

      {isLogsRoute ? (
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
      ) : null}
    </div>
  );
}

type DynamicPair = {
  id: string;
  key: string;
  value: string;
};

type SkuDraftRow = {
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

type SensitiveDraftRow = {
  id: string;
  type: string;
  value: string;
  remark: string;
};

function makeDraftId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function buildSkuRowsFromRawSkuProps(task: ProductTaskDetail, raw: RawProductDetail | null): SkuDraftRow[] {
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

function readJsonArrayField<T>(fields: Record<string, unknown>, key: string): T[] {
  const raw = fields[key];
  if (Array.isArray(raw)) return raw as T[];
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function nonEmptyPairs(rows: DynamicPair[]): DynamicPair[] {
  return rows
    .map((row) => ({ ...row, key: row.key.trim(), value: row.value.trim() }))
    .filter((row) => row.key || row.value);
}

function nonEmptySkuRows(rows: SkuDraftRow[]): SkuDraftRow[] {
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

function nonEmptySensitiveRows(rows: SensitiveDraftRow[]): SensitiveDraftRow[] {
  return rows
    .map((row) => ({ ...row, type: row.type.trim(), value: row.value.trim(), remark: row.remark.trim() }))
    .filter((row) => row.type || row.value || row.remark);
}

function DefaultSummaryCard({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <div className="rounded-[14px] border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-950">{value}</div>
      <div className="mt-1 truncate text-[11px] text-slate-500">{hint}</div>
    </div>
  );
}

function DefaultsTab({ task, raw }: { task: ProductTaskDetail; raw: RawProductDetail | null }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [draft, setDraft] = useState<ExportFieldDraft | null>(null);
  const [site, setSite] = useState("美国站");
  const [warehouse, setWarehouse] = useState("美国-饰品");
  const [leadTime, setLeadTime] = useState("7个工作日内发货");
  const [originCountry, setOriginCountry] = useState("中国");
  const [originProvince, setOriginProvince] = useState("广东省");
  const [declaredPrice, setDeclaredPrice] = useState("");
  const [suggestedPrice, setSuggestedPrice] = useState("");
  const [specType, setSpecType] = useState("款式/颜色");
  const [skuClass, setSkuClass] = useState("单品");
  const [independentPackage, setIndependentPackage] = useState("是");
  const [packageLength, setPackageLength] = useState("10");
  const [packageWidth, setPackageWidth] = useState("8");
  const [packageHeight, setPackageHeight] = useState("2");
  const [packageWeight, setPackageWeight] = useState("30");
  const [attributes, setAttributes] = useState<DynamicPair[]>([
    { id: makeDraftId("attr"), key: "主体材质", value: "" },
    { id: makeDraftId("attr"), key: "颜色", value: "" },
  ]);
  const [skuRows, setSkuRows] = useState<SkuDraftRow[]>([
    {
      id: makeDraftId("sku"),
      skuCode: "",
      spec1: "",
      spec2: "",
      quantity: "1",
      unit: "件",
      price: "",
      stock: "",
      weight: "",
      length: "",
      width: "",
      height: "",
    },
  ]);
  const [sensitiveRows, setSensitiveRows] = useState<SensitiveDraftRow[]>([
    { id: makeDraftId("sensitive"), type: "", value: "", remark: "" },
  ]);

  async function loadDefaults(): Promise<void> {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/product-tasks/${task.id}/export-fields/preview`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { draft: ExportFieldDraft | null };
      const fields = data.draft?.fields_json || {};
      setDraft(data.draft || null);

      if (fields["经营站点"]) setSite(String(fields["经营站点"]));
      if (fields["发货仓"]) setWarehouse(String(fields["发货仓"]));
      if (fields["承诺发货时效"]) setLeadTime(String(fields["承诺发货时效"]));
      if (fields["商品产地"]) setOriginCountry(String(fields["商品产地"]));
      if (fields["产地省份"]) setOriginProvince(String(fields["产地省份"]));
      if (fields["申报价CNY"]) setDeclaredPrice(String(fields["申报价CNY"]));
      if (fields["建议售价CNY"]) setSuggestedPrice(String(fields["建议售价CNY"]));
      if (fields["默认规格类型"]) setSpecType(String(fields["默认规格类型"]));
      else {
        const inferredSpecType = buildSpecTypeFromRawSkuProps(raw?.sku_props);
        if (inferredSpecType) setSpecType(inferredSpecType);
      }
      if (fields["SKU分类"]) setSkuClass(String(fields["SKU分类"]));
      if (fields["是否独立包装"]) setIndependentPackage(String(fields["是否独立包装"]));
      if (fields["最长边（cm）"]) setPackageLength(String(fields["最长边（cm）"]));
      if (fields["次长边（cm）"]) setPackageWidth(String(fields["次长边（cm）"]));
      if (fields["最短边（cm）"]) setPackageHeight(String(fields["最短边（cm）"]));
      if (fields["重量（g）"]) setPackageWeight(String(fields["重量（g）"]));

      const savedAttributes = readJsonArrayField<DynamicPair>(fields, "商品属性明细");
      if (savedAttributes.length) {
        setAttributes(savedAttributes.map((row) => ({ id: row.id || makeDraftId("attr"), key: String(row.key || ""), value: String(row.value || "") })));
      } else {
        const seededAttributes = ["主体材质", "颜色", "适用场景", "风格"]
          .filter((key) => fields[key] !== undefined && fields[key] !== null && String(fields[key]).trim())
          .map((key) => ({ id: makeDraftId("attr"), key, value: String(fields[key] || "") }));
        setAttributes(seededAttributes.length ? seededAttributes : [
          { id: makeDraftId("attr"), key: "主体材质", value: String(fields["主体材质"] || "") },
          { id: makeDraftId("attr"), key: "颜色", value: String(fields["颜色"] || "") },
        ]);
      }

      const savedSkuRows = readJsonArrayField<SkuDraftRow>(fields, "SKU信息明细");
      if (savedSkuRows.length) {
        setSkuRows(savedSkuRows.map((row) => ({
          id: row.id || makeDraftId("sku"),
          skuCode: String(row.skuCode || ""),
          spec1: String(row.spec1 || ""),
          spec2: String(row.spec2 || ""),
          quantity: String(row.quantity || ""),
          unit: String(row.unit || "件"),
          price: String(row.price || ""),
          stock: String(row.stock || ""),
          weight: String(row.weight || ""),
          length: String(row.length || ""),
          width: String(row.width || ""),
          height: String(row.height || ""),
        })));
      } else {
        const seededSkuRows = buildSkuRowsFromRawSkuProps(task, raw);
        if (seededSkuRows.length) {
          setSkuRows(seededSkuRows.map((row) => ({
            ...row,
            quantity: String(fields["SKU数量"] || row.quantity || "1"),
            unit: String(fields["SKU数量单位"] || row.unit || "件"),
            price: String(fields["建议售价CNY"] || row.price || ""),
            stock: String(fields["库存"] || row.stock || ""),
            weight: String(fields["重量（g）"] || row.weight || ""),
            length: String(fields["最长边（cm）"] || row.length || ""),
            width: String(fields["次长边（cm）"] || row.width || ""),
            height: String(fields["最短边（cm）"] || row.height || ""),
          })));
        } else {
          setSkuRows([{
            id: makeDraftId("sku"),
            skuCode: String(fields["SKU货号"] || task.platform_sku || task.source_id || ""),
            spec1: String(fields["规格1内容"] || ""),
            spec2: String(fields["规格2内容"] || ""),
            quantity: String(fields["SKU数量"] || "1"),
            unit: String(fields["SKU数量单位"] || "件"),
            price: String(fields["建议售价CNY"] || ""),
            stock: String(fields["库存"] || ""),
            weight: String(fields["重量（g）"] || ""),
            length: String(fields["最长边（cm）"] || ""),
            width: String(fields["次长边（cm）"] || ""),
            height: String(fields["最短边（cm）"] || ""),
          }]);
        }
      }

      const savedSensitiveRows = readJsonArrayField<SensitiveDraftRow>(fields, "敏感属性明细");
      if (savedSensitiveRows.length) {
        setSensitiveRows(savedSensitiveRows.map((row) => ({
          id: row.id || makeDraftId("sensitive"),
          type: String(row.type || ""),
          value: String(row.value || ""),
          remark: String(row.remark || ""),
        })));
      } else {
        const rows = ["敏感词属性1", "敏感词属性2", "敏感词属性3"]
          .map((key) => String(fields[key] || "").trim())
          .filter(Boolean)
          .map((type) => ({ id: makeDraftId("sensitive"), type, value: "", remark: "" }));
        setSensitiveRows(rows.length ? rows : [{ id: makeDraftId("sensitive"), type: "", value: "", remark: "" }]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDefaults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  async function saveDefaults(): Promise<void> {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const cleanAttributes = nonEmptyPairs(attributes);
      const cleanSkuRows = nonEmptySkuRows(skuRows);
      const cleanSensitiveRows = nonEmptySensitiveRows(sensitiveRows);
      const fields: Record<string, string> = {
        "经营站点": site,
        "发货仓": warehouse,
        "承诺发货时效": leadTime,
        "商品产地": originCountry,
        "产地省份": originProvince,
        "默认规格类型": specType,
        "SKU分类": skuClass,
        "是否独立包装": independentPackage,
        "最长边（cm）": packageLength,
        "次长边（cm）": packageWidth,
        "最短边（cm）": packageHeight,
        "重量（g）": packageWeight,
        "商品属性明细": JSON.stringify(cleanAttributes),
        "SKU信息明细": JSON.stringify(cleanSkuRows),
        "敏感属性明细": JSON.stringify(cleanSensitiveRows),
      };
      if (declaredPrice) fields["申报价CNY"] = declaredPrice;
      if (suggestedPrice) fields["建议售价CNY"] = suggestedPrice;

      cleanAttributes.forEach((row) => {
        fields[row.key] = row.value;
      });

      const firstSku = cleanSkuRows[0];
      if (firstSku) {
        fields["SKU货号"] = firstSku.skuCode;
        fields["规格1内容"] = firstSku.spec1;
        fields["规格2内容"] = firstSku.spec2;
        fields["SKU数量"] = firstSku.quantity;
        fields["SKU数量单位"] = firstSku.unit;
        if (firstSku.price) fields["建议售价CNY"] = firstSku.price;
        if (firstSku.stock) fields["库存"] = firstSku.stock;
      }

      cleanSensitiveRows.slice(0, 3).forEach((row, index) => {
        fields[`敏感词属性${index + 1}`] = row.type;
        if (row.value) fields[`敏感属性${index + 1}数值`] = row.value;
        if (row.remark) fields[`敏感属性${index + 1}备注`] = row.remark;
      });

      const res = await fetch(`${apiBaseUrl}/api/product-tasks/${task.id}/export-fields`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fields }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSuccess("保存成功");
      await loadDefaults();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  function patchAttribute(id: string, patch: Partial<DynamicPair>): void {
    setAttributes((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  function patchSkuRow(id: string, patch: Partial<SkuDraftRow>): void {
    setSkuRows((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  function patchSensitiveRow(id: string, patch: Partial<SensitiveDraftRow>): void {
    setSensitiveRows((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  const draftFields = draft?.fields_json || {};
  const filledAttributeCount = nonEmptyPairs(attributes).length;
  const filledSkuCount = nonEmptySkuRows(skuRows).length;
  const filledSensitiveCount = nonEmptySensitiveRows(sensitiveRows).length;
  const sensitiveOptions = ["", "纯电", "内电", "液体", "粉末", "膏体", "刀具", "磁性", "气雾剂", "易碎", "其他"];

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-[18px] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
      )}
      {success && (
        <div className="rounded-[18px] border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{success}</div>
      )}

      <Section title="本商品上架补充">
        <div className="grid gap-3 md:grid-cols-4">
          <DefaultSummaryCard label="商品属性" value={filledAttributeCount} hint="动态字段" />
          <DefaultSummaryCard label="SKU 行" value={filledSkuCount} hint="多规格" />
          <DefaultSummaryCard label="敏感属性" value={filledSensitiveCount} hint="可多项" />
          <DefaultSummaryCard label="导出草稿" value={draft ? "已生成" : "未生成"} hint={draft?.updated_at || "保存后写入草稿"} />
        </div>
        <div className="mt-4 rounded-[14px] border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
          通用站点、仓库、币种、默认库存等仍由“上架默认值规则”统一控制；这里保存的是当前商品需要人工覆盖或补充的字段。
        </div>
      </Section>

      <Section title="少量通用覆盖">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <FormSelect label="经营站点" value={site} onChange={setSite} options={["美国站", "英国站", "德国站", "法国站", "意大利站", "西班牙站", "日本站", "澳大利亚站"]} />
          <FormSelect label="发货仓" value={warehouse} onChange={setWarehouse} options={["美国-饰品", "美国-普货", "英国-饰品", "英国-普货", "德国-饰品", "德国-普货"]} />
          <FormSelect label="承诺发货时效" value={leadTime} onChange={setLeadTime} options={["2个工作日内发货", "3个工作日内发货", "5个工作日内发货", "7个工作日内发货"]} />
          <FormSelect label="是否独立包装" value={independentPackage} onChange={setIndependentPackage} options={["是", "否"]} />
          <FormInput label="商品产地" value={originCountry} onChange={setOriginCountry} placeholder="中国" />
          <FormInput label="产地省份" value={originProvince} onChange={setOriginProvince} placeholder="广东省" />
          <FormInput label="申报价 CNY" value={declaredPrice} onChange={setDeclaredPrice} type="number" placeholder="可留空" />
          <FormInput label="建议售价 CNY" value={suggestedPrice} onChange={setSuggestedPrice} type="number" placeholder="可留空" />
        </div>
      </Section>

      <Section title="商品属性">
        <div className="space-y-2">
          {attributes.map((row, index) => (
            <div key={row.id} className="grid gap-2 md:grid-cols-[220px_1fr_auto]">
              <FormInput label={index === 0 ? "属性名" : ""} value={row.key} onChange={(value) => patchAttribute(row.id, { key: value })} placeholder="如：主体材质 / 风格 / 适用人群" />
              <FormInput label={index === 0 ? "属性值" : ""} value={row.value} onChange={(value) => patchAttribute(row.id, { value })} placeholder="如：合金 / 复古 / 女士" />
              <button
                type="button"
                onClick={() => setAttributes((rows) => rows.length > 1 ? rows.filter((item) => item.id !== row.id) : rows)}
                className="mt-auto h-10 rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                disabled={attributes.length <= 1}
              >
                删除
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setAttributes((rows) => [...rows, { id: makeDraftId("attr"), key: "", value: "" }])}
          className="mt-3 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          添加属性
        </button>
      </Section>

      <Section title="商品规格与 SKU">
        <div className="grid gap-4 md:grid-cols-3">
          <FormSelect label="默认规格类型" value={specType} onChange={setSpecType} options={["款式/颜色", "颜色/尺寸", "尺寸/颜色", "款式", "颜色", "自定义"]} />
          <FormSelect label="SKU分类" value={skuClass} onChange={setSkuClass} options={["单品", "同款多件装", "混合套装"]} />
          <div className="rounded-[14px] border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
            多 SKU 会保存为明细，同时第 1 行会同步到 Temu 常用的规格字段，便于现有导出逻辑继续使用。
          </div>
        </div>
        <div className="mt-4 space-y-3">
          {skuRows.map((row, index) => (
            <div key={row.id} className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-slate-900">SKU {index + 1}</div>
                <button
                  type="button"
                  onClick={() => setSkuRows((rows) => rows.length > 1 ? rows.filter((item) => item.id !== row.id) : rows)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  disabled={skuRows.length <= 1}
                >
                  删除
                </button>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <FormInput label="SKU 编码" value={row.skuCode} onChange={(value) => patchSkuRow(row.id, { skuCode: value })} placeholder="平台 SKU / 货号" />
                <FormInput label="规格 1" value={row.spec1} onChange={(value) => patchSkuRow(row.id, { spec1: value })} placeholder="如：黑色" />
                <FormInput label="规格 2" value={row.spec2} onChange={(value) => patchSkuRow(row.id, { spec2: value })} placeholder="如：S / 1件装" />
                <div className="grid grid-cols-2 gap-2">
                  <FormInput label="数量" value={row.quantity} onChange={(value) => patchSkuRow(row.id, { quantity: value })} type="number" placeholder="1" />
                  <FormSelect label="单位" value={row.unit} onChange={(value) => patchSkuRow(row.id, { unit: value })} options={["件", "套", "对", "个", "组", "盒", "袋"]} />
                </div>
                <FormInput label="售价 CNY" value={row.price} onChange={(value) => patchSkuRow(row.id, { price: value })} type="number" placeholder="可留空" />
                <FormInput label="库存" value={row.stock} onChange={(value) => patchSkuRow(row.id, { stock: value })} type="number" placeholder="可留空" />
                <FormInput label="SKU 重量(g)" value={row.weight} onChange={(value) => patchSkuRow(row.id, { weight: value })} type="number" placeholder="默认用包裹重量" />
                <div className="grid grid-cols-3 gap-2">
                  <FormInput label="长(cm)" value={row.length} onChange={(value) => patchSkuRow(row.id, { length: value })} type="number" />
                  <FormInput label="宽(cm)" value={row.width} onChange={(value) => patchSkuRow(row.id, { width: value })} type="number" />
                  <FormInput label="高(cm)" value={row.height} onChange={(value) => patchSkuRow(row.id, { height: value })} type="number" />
                </div>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setSkuRows((rows) => [...rows, {
            id: makeDraftId("sku"),
            skuCode: "",
            spec1: "",
            spec2: "",
            quantity: "1",
            unit: "件",
            price: "",
            stock: "",
            weight: "",
            length: "",
            width: "",
            height: "",
          }])}
          className="mt-3 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          添加 SKU
        </button>
      </Section>

      <Section title="敏感属性">
        <div className="space-y-2">
          {sensitiveRows.map((row, index) => (
            <div key={row.id} className="grid gap-2 md:grid-cols-[180px_180px_1fr_auto]">
              <FormSelect label={index === 0 ? "类型" : ""} value={row.type} onChange={(value) => patchSensitiveRow(row.id, { type: value })} options={sensitiveOptions} />
              <FormInput label={index === 0 ? "数值" : ""} value={row.value} onChange={(value) => patchSensitiveRow(row.id, { value })} placeholder="容量/长度/Wh 等" />
              <FormInput label={index === 0 ? "备注" : ""} value={row.remark} onChange={(value) => patchSensitiveRow(row.id, { remark: value })} placeholder="如：内置纽扣电池 / 液体 100ml" />
              <button
                type="button"
                onClick={() => setSensitiveRows((rows) => rows.length > 1 ? rows.filter((item) => item.id !== row.id) : rows)}
                className="mt-auto h-10 rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                disabled={sensitiveRows.length <= 1}
              >
                删除
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setSensitiveRows((rows) => [...rows, { id: makeDraftId("sensitive"), type: "", value: "", remark: "" }])}
          className="mt-3 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          添加敏感属性
        </button>
      </Section>

      <Section title="体积重量">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <FormInput label="最长边（cm）" value={packageLength} onChange={setPackageLength} placeholder="10" type="number" />
          <FormInput label="次长边（cm）" value={packageWidth} onChange={setPackageWidth} placeholder="8" type="number" />
          <FormInput label="最短边（cm）" value={packageHeight} onChange={setPackageHeight} placeholder="2" type="number" />
          <FormInput label="重量（g）" value={packageWeight} onChange={setPackageWeight} placeholder="30" type="number" />
        </div>
      </Section>

      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500">
          {draft ? `草稿状态: ${draft.status} · 已有字段 ${Object.keys(draftFields).length} 个` : "暂无草稿"}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void loadDefaults()}
            className="h-11 rounded-full border border-slate-200 bg-white px-5 text-sm text-slate-700 hover:bg-slate-50"
            disabled={loading}
          >
            {loading ? "加载中..." : "重置"}
          </button>
          <button
            type="button"
            onClick={() => void saveDefaults()}
            className="h-11 rounded-full bg-slate-900 px-5 text-sm font-medium text-white hover:bg-slate-800"
            disabled={saving}
          >
            {saving ? "保存中..." : "保存全部"}
          </button>
        </div>
      </div>
    </div>
  );
}

// 表单组件：输入框
function FormInput({
  label, value, onChange, placeholder, type = "text"
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
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
    </div>
  );
}

// 表单组件：下拉选择
function FormSelect({
  label, value, onChange, options
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
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
          headers: buildAiRequestHeaders(true, mapPromptTypesToPurposes([selectedType])),
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
