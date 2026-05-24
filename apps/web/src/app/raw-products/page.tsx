"use client";

import { useEffect, useMemo, useState } from "react";

import { HoverZoomImage } from "@/components/hover-zoom-image";
import { apiBaseUrl } from "@/lib/api";
import { AiPurpose, resolveLocalImageRuntime, resolveLocalTextRuntime } from "@/lib/local-settings";

type RawProductListItem = {
  id: number;
  platform: string | null;
  title: string;
  price: string | null;
  platform_sku: string | null;
  source_id: string | null;
  collector: string | null;
  screenshot_url: string | null;
  main_image: string | null;
  carousel_images: string[];
  sku_images: string[];
  detail_images: string[];
  size_chart_images: string[];
  image_count: number;
  sku_count: number;
  task_id: number | null;
  task_created: boolean;
  created_at: string;
};

type RawProductListResponse = {
  items: RawProductListItem[];
  total: number;
  limit: number;
  offset: number;
};

type RawProductDetail = {
  id: number;
  platform: string | null;
  url: string;
  title: string;
  price: string | null;
  original_price: string | null;
  currency: string | null;
  source_id: string | null;
  platform_sku: string | null;
  category_path: string | null;
  shop_name: string | null;
  attributes_text: string | null;
  sku_text: string | null;
  sku_props: RawSkuPropItem[];
  stock: string | null;
  collector: string | null;
  main_image: string | null;
  screenshot_url: string | null;
  video_url: string | null;
  main_images: string[];
  carousel_images: string[];
  sku_images: string[];
  detail_images: string[];
  size_chart_images: string[];
  task_id: number | null;
  task_created: boolean;
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

type ProductAsset = {
  id: number;
  slot: string;
  public_url: string | null;
  selected_for_export: boolean;
  version: number;
  crop_index: number | null;
  source_type: string;
};

type ProductAssetsResponse = Record<string, ProductAsset[]>;

type GenerationMode = "task_only" | "title_only" | "title_and_4grid";

type ImageGroupKey = "main_images" | "carousel_images" | "sku_images" | "detail_images" | "size_chart_images";
type RawDragPayload =
  | { kind: "pool"; url: string }
  | { kind: "group"; url: string; group: ImageGroupKey; index: number };

const IMAGE_GROUP_META: Record<ImageGroupKey, { title: string; shortTitle: string; description: string }> = {
  main_images: {
    title: "采集主图/轮播原始序列",
    shortTitle: "原始序列",
    description: "插件抓到的商品主视觉顺序，先在这里确认原始图有没有漏抓、错抓。",
  },
  carousel_images: {
    title: "主图轮播图",
    shortTitle: "轮播图",
    description: "不管多少张都可以排序、换图；task_only 和 title_only 默认直接吃采集主图序列。",
  },
  sku_images: {
    title: "SKU 图",
    shortTitle: "SKU",
    description: "放颜色、款式、规格差异图，供 SKU 图和商品理解参考。",
  },
  detail_images: {
    title: "详情/卖点参考图",
    shortTitle: "详情",
    description: "放局部特写、细节和卖点参考图，影响细节图、卖点图、四宫格提示词。",
  },
  size_chart_images: {
    title: "尺寸图",
    shortTitle: "尺寸",
    description: "只放尺寸表或尺寸示意图，供尺寸图提取和后续手动确认。",
  },
};

function formatDate(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function resolveThumbnail(item: RawProductListItem): string | null {
  return item.main_image || item.carousel_images[0] || item.screenshot_url || null;
}

function normalizeInput(value: string): string | null {
  const next = value.trim();
  return next.length ? next : null;
}

function uniqueImages(urls: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const url = (raw || "").trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

function makeEmptySkuProp(groupIndex = 0, optionIndex = 0): RawSkuPropItem {
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

function normalizeSkuProps(items: RawSkuPropItem[] | null | undefined): RawSkuPropItem[] {
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

function appendUnique(images: string[], url: string, options?: { prepend?: boolean }): string[] {
  const clean = url.trim();
  if (!clean) return images;
  const next = images.filter((item) => item !== clean);
  if (options?.prepend) {
    next.unshift(clean);
  } else {
    next.push(clean);
  }
  return next;
}

function usageLabels(detail: RawProductDetail, url: string): string[] {
  const labels: string[] = [];
  if (detail.main_image === url) labels.push("任务主图");
  if (detail.main_images.includes(url)) labels.push("原始序列");
  const carouselIndex = detail.carousel_images.indexOf(url);
  if (carouselIndex >= 0) {
    labels.push(`轮播#${carouselIndex + 1}`);
  }
  if (detail.sku_images.includes(url)) labels.push("SKU");
  if (detail.detail_images.includes(url)) labels.push("详情");
  if (detail.size_chart_images.includes(url)) labels.push("尺寸");
  if (detail.screenshot_url === url) labels.push("页面截图");
  return labels;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取本地图片失败"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string" || !result.startsWith("data:")) {
        reject(new Error("本地图片格式不支持"));
        return;
      }
      resolve(result);
    };
    reader.readAsDataURL(file);
  });
}

function getCreateTaskPurposes(mode: GenerationMode, includeProductInfo: boolean): AiPurpose[] {
  if (mode === "task_only") return ["title"];
  if (mode === "title_only") {
    return includeProductInfo ? ["title_package", "product_info", "title"] : ["title_package", "title"];
  }
  return includeProductInfo ? ["title_package", "product_info", "title"] : ["title_package", "title"];
}

export default function RawProductsPage() {
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [data, setData] = useState<RawProductListResponse>({ items: [], total: 0, limit: 50, offset: 0 });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<RawProductDetail | null>(null);
  const [taskAssets, setTaskAssets] = useState<ProductAssetsResponse>({});
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [splitCount, setSplitCount] = useState(1);
  const [generationMode, setGenerationMode] = useState<GenerationMode>("title_and_4grid");
  const [includeProductInfo, setIncludeProductInfo] = useState(true);
  const [dragging, setDragging] = useState<RawDragPayload | null>(null);
  const [uploadingGroup, setUploadingGroup] = useState<ImageGroupKey | null>(null);

  const allImages = useMemo(() => {
    if (!detail) return [];
    return uniqueImages([
      detail.main_image,
      detail.screenshot_url,
      ...detail.main_images,
      ...detail.carousel_images,
      ...detail.sku_images,
      ...detail.detail_images,
      ...detail.size_chart_images,
    ]);
  }, [detail]);

  async function loadList(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${apiBaseUrl}/api/raw-products?limit=50&offset=0`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = (await response.json()) as RawProductListResponse;
      setData(result);
      setSelectedId((prev) => prev ?? result.items[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(id: number): Promise<void> {
    setDetailLoading(true);
    setError(null);
    try {
      const response = await fetch(`${apiBaseUrl}/api/raw-products/${id}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = (await response.json()) as RawProductDetail;
      setDetail(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载详情失败");
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    void loadList();
  }, []);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
  }, [selectedId]);

  useEffect(() => {
    if (!detail) return;
    const shouldMirror = generationMode !== "title_and_4grid";
    if (!shouldMirror) return;
    if (detail.carousel_images.length || !detail.main_images.length) return;
    setDetail((prev) => {
      if (!prev || prev.carousel_images.length || !prev.main_images.length) return prev;
      return {
        ...prev,
        main_image: prev.main_image || prev.main_images[0] || null,
        carousel_images: [...prev.main_images],
      };
    });
  }, [detail, generationMode]);

  useEffect(() => {
    if (!detail?.task_id) {
      setTaskAssets({});
      return;
    }
    let cancelled = false;
    const loadAssets = async (): Promise<void> => {
      setAssetsLoading(true);
      try {
        const response = await fetch(`${apiBaseUrl}/api/product-tasks/${detail.task_id}/assets`, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = (await response.json()) as ProductAssetsResponse;
        if (!cancelled) setTaskAssets(result);
      } catch {
        if (!cancelled) setTaskAssets({});
      } finally {
        if (!cancelled) setAssetsLoading(false);
      }
    };
    void loadAssets();
    return () => {
      cancelled = true;
    };
  }, [detail?.task_id]);

  function patchDetail(fields: Partial<RawProductDetail>): void {
    setDetail((prev) => (prev ? { ...prev, ...fields } : prev));
  }

  function appendToGroup(url: string, target: ImageGroupKey, options?: { prepend?: boolean }): void {
    setDetail((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        [target]: appendUnique(prev[target], url, { prepend: options?.prepend ?? false }),
      };
    });
  }

  function moveWithinGroup(group: ImageGroupKey, fromIndex: number, toIndex: number): void {
    setDetail((prev) => {
      if (!prev || fromIndex === toIndex) return prev;
      const nextList = [...prev[group]];
      const [moved] = nextList.splice(fromIndex, 1);
      if (!moved) return prev;
      nextList.splice(toIndex, 0, moved);
      return { ...prev, [group]: nextList };
    });
  }

  function removeImage(url: string): void {
    setDetail((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        main_image: prev.main_image === url ? null : prev.main_image,
        main_images: prev.main_images.filter((item) => item !== url),
        carousel_images: prev.carousel_images.filter((item) => item !== url),
        sku_images: prev.sku_images.filter((item) => item !== url),
        detail_images: prev.detail_images.filter((item) => item !== url),
        size_chart_images: prev.size_chart_images.filter((item) => item !== url),
      };
    });
  }

  function replaceGroup(group: ImageGroupKey, images: string[]): void {
    setDetail((prev) => (prev ? { ...prev, [group]: uniqueImages(images) } : prev));
  }

  async function handleUploadToGroup(group: ImageGroupKey, file: File): Promise<void> {
    if (!detail) return;
    setUploadingGroup(group);
    setError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      const response = await fetch(`${apiBaseUrl}/sync/screenshot`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId: `${detail.id}-${group}-${Date.now()}`, dataUrl }),
      });
      const result = (await response.json()) as { url?: string; detail?: string };
      if (!response.ok || !result.url) throw new Error(result.detail || "上传失败");
      appendToGroup(result.url, group, { prepend: group === "carousel_images" });
      if (group === "main_images" && !detail.main_image) patchDetail({ main_image: result.url });
      setNotice("图片已上传并加入当前分组。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "图片上传失败");
    } finally {
      setUploadingGroup(null);
    }
  }

  async function saveDetail(): Promise<void> {
    if (!detail) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`${apiBaseUrl}/api/raw-products/${detail.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          platform: normalizeInput(detail.platform || "") || null,
          url: detail.url,
          title: detail.title,
          price: normalizeInput(detail.price || ""),
          originalPrice: normalizeInput(detail.original_price || ""),
          currency: normalizeInput(detail.currency || ""),
          sourceId: normalizeInput(detail.source_id || ""),
          platformSku: normalizeInput(detail.platform_sku || ""),
          categoryPath: normalizeInput(detail.category_path || ""),
          shopName: normalizeInput(detail.shop_name || ""),
          attributesText: normalizeInput(detail.attributes_text || ""),
          skuText: normalizeInput(detail.sku_text || ""),
          skuProps: normalizeSkuProps(detail.sku_props),
          stock: normalizeInput(detail.stock || ""),
          collector: normalizeInput(detail.collector || ""),
          mainImage: normalizeInput(detail.main_image || ""),
          screenshot: normalizeInput(detail.screenshot_url || ""),
          videoUrl: normalizeInput(detail.video_url || ""),
          mainImages: detail.main_images,
          carouselImages: detail.carousel_images,
          skuImages: detail.sku_images,
          detailImages: detail.detail_images,
          sizeChartImages: detail.size_chart_images,
        }),
      });
      const result = (await response.json()) as RawProductDetail | { detail?: string };
      if (!response.ok) throw new Error("detail" in result ? (result.detail ?? "保存失败") : "保存失败");
      setDetail(result as RawProductDetail);
      setNotice("原始采集数据已保存，可继续生成任务。");
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateOne(): Promise<void> {
    if (!selectedId) return;
    setNotice(null);
    setError(null);
    try {
      const localTextRuntime = resolveLocalTextRuntime(getCreateTaskPurposes(generationMode, includeProductInfo));
      const localImageRuntime = resolveLocalImageRuntime();
      const aiHeaders: Record<string, string> = {};
      if (localTextRuntime?.apiKey) aiHeaders["X-AI-API-Key"] = localTextRuntime.apiKey;
      if (localTextRuntime?.baseUrl) aiHeaders["X-AI-Base-URL"] = localTextRuntime.baseUrl;
      if (localTextRuntime?.model) aiHeaders["X-AI-Model"] = localTextRuntime.model;
      if (localImageRuntime?.apiKey) aiHeaders["X-AI-Image-API-Key"] = localImageRuntime.apiKey;
      if (localImageRuntime?.baseUrl) aiHeaders["X-AI-Image-Base-URL"] = localImageRuntime.baseUrl;
      if (localImageRuntime?.model) aiHeaders["X-AI-Image-Model"] = localImageRuntime.model;
      const readiness = await fetch(
        `${apiBaseUrl}/api/settings/task-readiness?generation_mode=${generationMode}`,
        { cache: "no-store", headers: aiHeaders },
      );
      const readinessJson = (await readiness.json()) as { can_create_task?: boolean; blocking_message?: string };
      if (!readiness.ok || readinessJson.can_create_task === false) {
        throw new Error(readinessJson.blocking_message || "当前配置不满足生成任务条件");
      }
      const response = await fetch(`${apiBaseUrl}/api/raw-products/${selectedId}/create-task`, {
        method: "POST",
        headers: { "content-type": "application/json", ...aiHeaders },
        body: JSON.stringify({
          split_count: splitCount,
          generation_mode: generationMode,
          include_product_info: includeProductInfo,
        }),
      });
      const result = (await response.json()) as { id?: number; detail?: string };
      if (!response.ok) throw new Error(result.detail || `HTTP ${response.status}`);
      setNotice(`已生成商品任务 #${result.id}。`);
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成任务失败");
    }
  }

  async function handleDeleteOne(id: number): Promise<void> {
    if (!window.confirm("确定删除这条原始采集数据吗？如果它已经生成商品任务，也会一并删除。")) return;

    setNotice(null);
    setError(null);
    try {
      const response = await fetch(`${apiBaseUrl}/api/raw-products/${id}`, { method: "DELETE" });
      const result = (await response.json()) as { detail?: string };
      if (!response.ok) throw new Error(result.detail || `HTTP ${response.status}`);
      setNotice("已删除原始采集数据。");
      setDetail((prev) => (prev?.id === id ? null : prev));
      setSelectedId((prev) => {
        if (prev !== id) return prev;
        const remaining = data.items.filter((item) => item.id !== id);
        return remaining[0]?.id ?? null;
      });
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  }

  return (
    <main className="h-[calc(100vh-24px)] px-4 py-3 md:px-5">
      <section className="grid h-full grid-cols-12 gap-3">
        <div className="col-span-12 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm xl:col-span-4">
          <div className="flex items-center justify-between gap-2 pb-3">
            <div>
              <h1 className="text-lg font-semibold text-slate-900">原始采集数据</h1>
              <div className="text-xs text-slate-500">共 {data.total} 条 {loading ? "· 加载中" : ""}</div>
            </div>
            <button
              type="button"
              onClick={() => void loadList()}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700"
            >
              刷新
            </button>
          </div>
          <div className="space-y-2 overflow-y-auto pr-1" style={{ maxHeight: "calc(100vh - 180px)" }}>
            {data.items.map((item) => {
              const thumb = resolveThumbnail(item);
              const active = selectedId === item.id;
              return (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedId(item.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedId(item.id);
                    }
                  }}
                  className={[
                    "flex w-full items-start gap-3 rounded-xl border p-2 text-left",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-1",
                    active ? "border-teal-400 bg-teal-50/70" : "border-slate-200 bg-white hover:bg-slate-50",
                  ].join(" ")}
                >
                  {thumb ? (
                    <HoverZoomImage
                      src={thumb}
                      alt={item.title}
                      thumbClassName="h-14 w-14 rounded-lg border border-slate-200 bg-white object-cover"
                    />
                  ) : (
                    <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-[11px] text-slate-500">
                      无图
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-sm text-slate-900">{item.title}</div>
                    <div className="mt-1 text-xs text-slate-500">{item.platform || "-"} · {formatDate(item.created_at)}</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedId(item.id);
                        }}
                        className="rounded-md border border-slate-300 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50"
                      >
                        查看
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedId(item.id);
                          void handleDeleteOne(item.id);
                        }}
                        className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-700 hover:bg-rose-100"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="col-span-12 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm xl:col-span-8">
          {notice ? <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div> : null}
          {error ? <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
          {detailLoading ? <div className="py-16 text-center text-sm text-slate-500">正在加载详情…</div> : null}
          {!detailLoading && !detail ? <div className="py-16 text-center text-sm text-slate-500">请选择一条采集数据</div> : null}
          {!detailLoading && detail ? (
            <div className="h-full overflow-y-auto pr-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm text-slate-500">ID {detail.id} · {formatDate(detail.created_at)}</div>
                <div className="flex items-center gap-2">
                  <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-2 py-1 text-xs">
                    生成模式
                    <select
                      value={generationMode}
                      onChange={(event) => setGenerationMode(event.target.value as GenerationMode)}
                      className="rounded border border-slate-300 px-2 py-0.5"
                    >
                      <option value="task_only">只建任务</option>
                      <option value="title_only">只要 AI 标题</option>
                      <option value="title_and_4grid">标题+四宫格生成</option>
                    </select>
                  </label>
                  <label
                    className={[
                      "inline-flex items-center gap-2 rounded-lg border px-2 py-1 text-xs",
                      generationMode === "task_only"
                        ? "border-slate-200 bg-slate-50 text-slate-400"
                        : "border-slate-300 text-slate-700",
                    ].join(" ")}
                  >
                    商品理解
                    <input
                      type="checkbox"
                      checked={includeProductInfo}
                      disabled={generationMode === "task_only"}
                      onChange={(event) => setIncludeProductInfo(event.target.checked)}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-400 disabled:cursor-not-allowed"
                    />
                    <span
                      title="默认开启。开启后会先做商品理解，给标题和四宫格提示词补充上下文；关闭后直接基于原标题、属性、SKU 和图片生成，速度更快，但标题和四宫格上下文会更弱。"
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 text-[10px] font-semibold text-slate-500"
                    >
                      ?
                    </span>
                  </label>
                  <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-2 py-1 text-xs">
                    裂变数
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={splitCount}
                      onChange={(event) => setSplitCount(Math.max(1, Math.min(50, Number(event.target.value) || 1)))}
                      className="w-14 rounded border border-slate-300 px-1 py-0.5 text-center"
                    />
                  </label>
                  <button type="button" onClick={() => void handleCreateOne()} className="rounded-lg bg-slate-900 px-3 py-2 text-xs text-white">生成任务</button>
                  <button type="button" onClick={() => void saveDetail()} disabled={saving} className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 disabled:opacity-50">
                    {saving ? "保存中…" : "保存纠错"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteOne(detail.id)}
                    className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
                  >
                    删除
                  </button>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <input value={detail.title} onChange={(e) => patchDetail({ title: e.target.value })} className="col-span-2 rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="标题" />
                <input value={detail.platform || ""} onChange={(e) => patchDetail({ platform: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="平台" />
                <input value={detail.price || ""} onChange={(e) => patchDetail({ price: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="价格" />
                <input value={detail.platform_sku || ""} onChange={(e) => patchDetail({ platform_sku: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="平台SKU" />
                <input value={detail.source_id || ""} onChange={(e) => patchDetail({ source_id: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="来源ID" />
                <input value={detail.shop_name || ""} onChange={(e) => patchDetail({ shop_name: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="店铺名" />
                <input value={detail.category_path || ""} onChange={(e) => patchDetail({ category_path: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="类目路径" />
                <input value={detail.url} onChange={(e) => patchDetail({ url: e.target.value })} className="col-span-2 rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="URL" />
              </div>

              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium text-slate-800">SKU 规格采集</div>
                      <div className="mt-1 text-xs text-slate-500">
                        把插件识别到的颜色、款式、尺寸等选项放在这里，后续会同步到上架台继续编辑。
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        patchDetail({
                          sku_props: [...normalizeSkuProps(detail.sku_props), makeEmptySkuProp(detail.sku_props.length, detail.sku_props.length)],
                        })
                      }
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700"
                    >
                      添加 SKU 项
                    </button>
                  </div>
                  <div className="mt-3 space-y-2">
                    {normalizeSkuProps(detail.sku_props).length ? (
                      normalizeSkuProps(detail.sku_props).map((item, index) => (
                        <div key={`sku-prop-${index + 1}`} className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 md:grid-cols-[120px_1fr_1fr_auto]">
                          <input
                            value={item.group_name}
                            onChange={(event) =>
                              patchDetail({
                                sku_props: normalizeSkuProps(detail.sku_props).map((row, rowIndex) =>
                                  rowIndex === index ? { ...row, group_name: event.target.value } : row,
                                ),
                              })
                            }
                            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            placeholder="规格组，如颜色/尺寸"
                          />
                          <input
                            value={item.option_name}
                            onChange={(event) =>
                              patchDetail({
                                sku_props: normalizeSkuProps(detail.sku_props).map((row, rowIndex) =>
                                  rowIndex === index ? { ...row, option_name: event.target.value } : row,
                                ),
                              })
                            }
                            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            placeholder="选项值，如黑色/S"
                          />
                          <input
                            value={item.image_url || ""}
                            onChange={(event) =>
                              patchDetail({
                                sku_props: normalizeSkuProps(detail.sku_props).map((row, rowIndex) =>
                                  rowIndex === index ? { ...row, image_url: event.target.value || null } : row,
                                ),
                              })
                            }
                            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            placeholder="对应 SKU 图 URL，可留空"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              patchDetail({
                                sku_props: normalizeSkuProps(detail.sku_props).filter((_, rowIndex) => rowIndex !== index),
                              })
                            }
                            className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
                          >
                            删除
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-xs text-slate-500">
                        这条原始采集数据还没有结构化 SKU 规格。可以等插件新采集，也可以先手动补。
                      </div>
                    )}
                  </div>
                </div>
                <div className="mb-2 text-sm font-medium text-slate-800">图片纠错工作区</div>
                <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-900">
                  <div className="font-medium">先看关系，再改图</div>
                  <div className="mt-1">1. `task_only` 和 `title_only` 默认会把采集主图序列同步到主图轮播图，尽量减少手动搬图。</div>
                  <div>2. 主图轮播图不限制张数，顺序就是后续导出和人工检查看到的顺序。</div>
                  <div>3. SKU 图和尺寸图放在主图轮播图下面，支持换位、选现有图、本地上传。</div>
                  <div>4. 已经生成过四宫格时，下面会直接显示母图和裁切出来的轮播图对比。</div>
                </div>
                <ImagePreparationBoard
                  detail={detail}
                  onSetMainImage={(url) => patchDetail({ main_image: url })}
                  onReplaceGroup={replaceGroup}
                  onAppendToGroup={appendToGroup}
                  onUploadToGroup={(group, file) => void handleUploadToGroup(group, file)}
                  uploadingGroup={uploadingGroup}
                />
                {detail.task_id ? (
                  <TaskAssetCompareBoard
                    taskId={detail.task_id}
                    assets={taskAssets}
                    loading={assetsLoading}
                  />
                ) : (
                  <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white px-3 py-4 text-xs text-slate-500">
                    还没有商品任务。生成任务后，这里会显示四宫格母图、裁切轮播图和 AI 图入口。
                  </div>
                )}
                <div className="mt-4 text-xs text-slate-500">下面的图片池用于选图；每张图上的标签会告诉你它当前已经被放到了哪些位置。</div>
                <div className="grid grid-cols-3 gap-2 md:grid-cols-4 xl:grid-cols-5">
                  {allImages.map((url) => (
                    <div
                      key={url}
                      draggable
                      onDragStart={() => setDragging({ kind: "pool", url })}
                      onDragEnd={() => setDragging(null)}
                      className={[
                        "rounded-lg border border-slate-200 bg-white p-2",
                        dragging?.url === url ? "opacity-60" : "",
                      ].join(" ")}
                    >
                      <HoverZoomImage
                        src={url}
                        alt="raw"
                        thumbClassName="h-16 w-full rounded-md border border-slate-200 object-cover"
                        previewWidth={520}
                      />
                      <div className="mt-2 flex flex-wrap gap-1">
                        {usageLabels(detail, url).map((label) => (
                          <span key={label} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
                            {label}
                          </span>
                        ))}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <button type="button" onClick={() => patchDetail({ main_image: url })} className="rounded border border-slate-300 px-2 py-0.5 text-[11px]">设主图</button>
                        <button type="button" onClick={() => appendToGroup(url, "main_images")} className="rounded border border-slate-300 px-2 py-0.5 text-[11px]">原始序列</button>
                        <button type="button" onClick={() => appendToGroup(url, "carousel_images", { prepend: true })} className="rounded border border-slate-300 px-2 py-0.5 text-[11px]">轮播首位</button>
                        <button type="button" onClick={() => appendToGroup(url, "carousel_images")} className="rounded border border-slate-300 px-2 py-0.5 text-[11px]">加入轮播</button>
                        <button type="button" onClick={() => appendToGroup(url, "sku_images")} className="rounded border border-slate-300 px-2 py-0.5 text-[11px]">SKU</button>
                        <button type="button" onClick={() => appendToGroup(url, "detail_images")} className="rounded border border-slate-300 px-2 py-0.5 text-[11px]">详情</button>
                        <button type="button" onClick={() => appendToGroup(url, "size_chart_images")} className="rounded border border-slate-300 px-2 py-0.5 text-[11px]">尺寸</button>
                        <button type="button" onClick={() => removeImage(url)} className="rounded border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] text-rose-700">删除</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {(["main_images", "detail_images"] as ImageGroupKey[]).map((group) => (
                  <ImageGroupEditor
                    key={group}
                    group={group}
                    title={IMAGE_GROUP_META[group].title}
                    description={IMAGE_GROUP_META[group].description}
                    images={detail[group]}
                    sourceImages={allImages}
                    onReorder={(images) => replaceGroup(group, images)}
                    onAppend={(url) => appendToGroup(url, group)}
                    onDropExternal={(url) => appendToGroup(url, group)}
                    onDropReorder={(fromIndex, toIndex) => moveWithinGroup(group, fromIndex, toIndex)}
                    dragging={dragging}
                    onDragStateChange={setDragging}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function ImageGroupEditor({
  group,
  title,
  description,
  images,
  sourceImages,
  onReorder,
  onAppend,
  onDropExternal,
  onDropReorder,
  dragging,
  onDragStateChange,
}: {
  group: ImageGroupKey;
  title: string;
  description: string;
  images: string[];
  sourceImages: string[];
  onReorder: (images: string[]) => void;
  onAppend: (url: string) => void;
  onDropExternal: (url: string) => void;
  onDropReorder: (fromIndex: number, toIndex: number) => void;
  dragging: RawDragPayload | null;
  onDragStateChange: (payload: RawDragPayload | null) => void;
}) {
  const [selected, setSelected] = useState("");
  const moveUp = (idx: number) => {
    if (idx <= 0) return;
    const next = [...images];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    onReorder(next);
  };
  const moveDown = (idx: number) => {
    if (idx >= images.length - 1) return;
    const next = [...images];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    onReorder(next);
  };
  return (
    <div
      className="rounded-xl border border-slate-200 p-3"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        if (!dragging) return;
        if (dragging.kind === "pool") onDropExternal(dragging.url);
        if (dragging.kind === "group") onDropExternal(dragging.url);
        onDragStateChange(null);
      }}
    >
      <div className="mb-1 text-sm font-medium text-slate-800">{title}</div>
      <div className="mb-2 text-xs text-slate-500">{description}</div>
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        {images.map((url, idx) => (
          <div
            key={`${url}-${idx}`}
            draggable
            onDragStart={() => onDragStateChange({ kind: "group", url, index: idx, group })}
            onDragEnd={() => onDragStateChange(null)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (!dragging) return;
              if (dragging.kind === "pool") onDropExternal(dragging.url);
              if (dragging.kind === "group") {
                if (dragging.group === group) {
                  if (dragging.url === url) return;
                  onDropReorder(dragging.index, idx);
                } else {
                  onDropExternal(dragging.url);
                }
              }
              onDragStateChange(null);
            }}
            className={[
              "rounded-lg border border-slate-200 bg-slate-50 p-2",
              dragging?.url === url ? "opacity-60" : "",
            ].join(" ")}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] font-medium text-slate-500">#{idx + 1}</div>
              <div className="text-[11px] text-slate-400">拖拽换位</div>
            </div>
            <HoverZoomImage
              src={url}
              alt={title}
              thumbClassName="mt-2 h-20 w-full rounded border border-slate-200 bg-white object-cover"
              previewWidth={520}
            />
            <div className="mt-2 line-clamp-2 break-all text-[11px] text-slate-600">{url}</div>
            <div className="mt-2 flex flex-wrap gap-1">
              <button type="button" onClick={() => moveUp(idx)} className="rounded border border-slate-300 px-2 py-0.5 text-[11px]">左移</button>
              <button type="button" onClick={() => moveDown(idx)} className="rounded border border-slate-300 px-2 py-0.5 text-[11px]">右移</button>
              <button type="button" onClick={() => onReorder(images.filter((_, i) => i !== idx))} className="rounded border border-rose-200 px-2 py-0.5 text-[11px] text-rose-700">删除</button>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <select value={selected} onChange={(e) => setSelected(e.target.value)} className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-xs">
          <option value="">从当前图片池追加</option>
          {sourceImages.map((url) => (
            <option key={url} value={url}>{url}</option>
          ))}
        </select>
        <button type="button" onClick={() => selected && onAppend(selected)} className="rounded border border-slate-300 px-2 py-1 text-xs">追加</button>
      </div>
    </div>
  );
}

function ImagePreparationBoard({
  detail,
  onSetMainImage,
  onReplaceGroup,
  onAppendToGroup,
  onUploadToGroup,
  uploadingGroup,
}: {
  detail: RawProductDetail;
  onSetMainImage: (url: string) => void;
  onReplaceGroup: (group: ImageGroupKey, images: string[]) => void;
  onAppendToGroup: (url: string, group: ImageGroupKey, options?: { prepend?: boolean }) => void;
  onUploadToGroup: (group: ImageGroupKey, file: File) => void;
  uploadingGroup: ImageGroupKey | null;
}) {
  return (
    <div className="grid gap-3">
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="text-sm font-medium text-slate-800">任务主图</div>
        <div className="mt-1 text-xs text-slate-500">商品理解、主图参考和轮播首感知都会优先看这里，建议从轮播第 1 张里选。</div>
        {detail.main_image ? (
          <div className="mt-3">
            <HoverZoomImage
              src={detail.main_image}
              alt="任务主图"
              thumbClassName="h-36 w-full rounded-xl border border-slate-200 object-cover"
              previewWidth={560}
            />
            <div className="mt-2 flex flex-wrap gap-1">
              <button type="button" onClick={() => onAppendToGroup(detail.main_image!, "carousel_images", { prepend: true })} className="rounded border border-slate-300 px-2 py-0.5 text-[11px]">
                放到轮播首位
              </button>
              <button type="button" onClick={() => onAppendToGroup(detail.main_image!, "main_images", { prepend: true })} className="rounded border border-slate-300 px-2 py-0.5 text-[11px]">
                置顶原始序列
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">
            还没指定任务主图，请从下方图池或原始序列里选一张。
          </div>
        )}
      </div>

      <SequencePreview
        title="采集主图/轮播原始序列"
        subtitle="这是插件抓回来的主视觉顺序。通常先在这里确认图有没有抓错，再同步到主图轮播图。"
        images={detail.main_images}
        emptyText="还没有原始主图序列，可从图池把正确图片补进来。"
        onSetMainImage={onSetMainImage}
        onPromote={(url) => onAppendToGroup(url, "carousel_images", { prepend: true })}
        onMoveLeft={(idx) => {
          if (idx <= 0) return;
          const next = [...detail.main_images];
          [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
          onReplaceGroup("main_images", next);
        }}
        onMoveRight={(idx) => {
          if (idx >= detail.main_images.length - 1) return;
          const next = [...detail.main_images];
          [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
          onReplaceGroup("main_images", next);
        }}
      />

      <ManagedGroupBoard
        group="carousel_images"
        title="主图轮播图"
        description="默认从采集主图同步过来。不管多少张都可以换位置、换图；后续导出就按这里的顺序走。"
        images={detail.carousel_images}
        onSetMainImage={onSetMainImage}
        onReplace={(images) => onReplaceGroup("carousel_images", images)}
        onUpload={onUploadToGroup}
        uploading={uploadingGroup === "carousel_images"}
      />

      <div className="grid gap-3 xl:grid-cols-2">
        <ManagedGroupBoard
          group="sku_images"
          title="SKU 图"
          description="放颜色、款式、规格差异图；可手调顺序、补图和替换。"
          images={detail.sku_images}
          onSetMainImage={onSetMainImage}
          onReplace={(images) => onReplaceGroup("sku_images", images)}
          onUpload={onUploadToGroup}
          uploading={uploadingGroup === "sku_images"}
          compact
        />
        <ManagedGroupBoard
          group="size_chart_images"
          title="尺寸图"
          description="放尺寸表或尺寸示意图；可手调顺序、补图和替换。"
          images={detail.size_chart_images}
          onSetMainImage={onSetMainImage}
          onReplace={(images) => onReplaceGroup("size_chart_images", images)}
          onUpload={onUploadToGroup}
          uploading={uploadingGroup === "size_chart_images"}
          compact
        />
      </div>
    </div>
  );
}

function ManagedGroupBoard({
  group,
  title,
  description,
  images,
  onSetMainImage,
  onReplace,
  onUpload,
  uploading,
  compact = false,
}: {
  group: ImageGroupKey;
  title: string;
  description: string;
  images: string[];
  onSetMainImage: (url: string) => void;
  onReplace: (images: string[]) => void;
  onUpload: (group: ImageGroupKey, file: File) => void;
  uploading: boolean;
  compact?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-slate-800">{title}</div>
          <div className="mt-1 text-xs text-slate-500">{description}</div>
        </div>
        <label className="inline-flex cursor-pointer items-center rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50">
          {uploading ? "上传中…" : "本地上传"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onUpload(group, file);
              event.currentTarget.value = "";
            }}
          />
        </label>
      </div>
      <SequencePreview
        title=""
        subtitle=""
        images={images}
        emptyText={`当前还没有${title}。可从下方图片池选图，或直接本地上传。`}
        onSetMainImage={onSetMainImage}
        onPromote={(url) => onReplace([url, ...images.filter((item) => item !== url)])}
        onMoveLeft={(idx) => {
          if (idx <= 0) return;
          const next = [...images];
          [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
          onReplace(next);
        }}
        onMoveRight={(idx) => {
          if (idx >= images.length - 1) return;
          const next = [...images];
          [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
          onReplace(next);
        }}
        compact={compact}
      />
    </div>
  );
}

function TaskAssetCompareBoard({
  taskId,
  assets,
  loading,
}: {
  taskId: number;
  assets: ProductAssetsResponse;
  loading: boolean;
}) {
  const parent = (assets.carousel_4grid || [])[0] || null;
  const crops = ["carousel_1", "carousel_2", "carousel_3", "carousel_4"]
    .map((slot) => {
      const items = assets[slot] || [];
      return items.find((item) => item.selected_for_export) || items[0] || null;
    })
    .filter(Boolean) as ProductAsset[];

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-slate-800">已有四宫格对比</div>
          <div className="mt-1 text-xs text-slate-500">如果这个原始商品已经建过任务，这里会展示四宫格母图和裁切后的 4 张轮播图，方便比对。</div>
        </div>
        <a
          href={`/product-tasks`}
          className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
        >
          前往任务图工作台
        </a>
      </div>
      {loading ? (
        <div className="mt-3 text-xs text-slate-500">正在读取任务 #{taskId} 的图片资产…</div>
      ) : !parent && !crops.length ? (
        <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-center text-xs text-slate-500">
          这个任务还没有四宫格母图或裁切图。
        </div>
      ) : (
        <div className="mt-3 grid gap-3 lg:grid-cols-[1.1fr_1.6fr]">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-medium text-slate-700">四宫格母图</div>
            {parent?.public_url ? (
              <HoverZoomImage
                src={parent.public_url}
                alt="四宫格母图"
                thumbClassName="mt-2 h-56 w-full rounded-xl bg-white object-contain"
                previewWidth={640}
              />
            ) : (
              <div className="mt-2 flex h-56 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white text-xs text-slate-400">
                暂无母图
              </div>
            )}
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-medium text-slate-700">裁切轮播图 1-4</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {["carousel_1", "carousel_2", "carousel_3", "carousel_4"].map((slot, idx) => {
                const asset = (assets[slot] || []).find((item) => item.selected_for_export) || (assets[slot] || [])[0] || null;
                return (
                  <div key={slot} className="rounded-lg border border-slate-200 bg-white p-2">
                    <div className="text-[11px] font-medium text-slate-500">轮播 #{idx + 1}</div>
                    {asset?.public_url ? (
                      <HoverZoomImage
                        src={asset.public_url}
                        alt={slot}
                        thumbClassName="mt-2 h-24 w-full rounded-lg bg-slate-50 object-contain"
                        previewWidth={520}
                      />
                    ) : (
                      <div className="mt-2 flex h-24 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-[11px] text-slate-400">
                        暂无
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SequencePreview({
  title,
  subtitle,
  images,
  emptyText,
  onSetMainImage,
  onPromote,
  onMoveLeft,
  onMoveRight,
  startIndex = 1,
  compact = false,
}: {
  title: string;
  subtitle: string;
  images: string[];
  emptyText: string;
  onSetMainImage: (url: string) => void;
  onPromote: (url: string) => void;
  onMoveLeft: (idx: number) => void;
  onMoveRight: (idx: number) => void;
  startIndex?: number;
  compact?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      {title ? <div className="text-sm font-medium text-slate-800">{title}</div> : null}
      {subtitle ? <div className="mt-1 text-xs text-slate-500">{subtitle}</div> : null}
      {images.length ? (
        <div className={`mt-3 grid gap-2 ${compact ? "grid-cols-2 xl:grid-cols-4" : "grid-cols-2 xl:grid-cols-5"}`}>
          {images.map((url, idx) => (
            <div key={`${url}-${idx}`} className="rounded-lg border border-slate-200 bg-white p-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] font-medium text-slate-500">#{startIndex + idx}</div>
                <div className="text-[10px] text-slate-400">{compact ? "关键位" : "可调顺序"}</div>
              </div>
              <HoverZoomImage
                src={url}
                alt={title || "sequence"}
                thumbClassName={`mt-2 w-full rounded border border-slate-200 bg-white object-cover ${compact ? "h-20" : "h-24"}`}
                previewWidth={520}
              />
              <div className="mt-2 flex flex-wrap gap-1">
                <button type="button" onClick={() => onSetMainImage(url)} className="rounded border border-slate-300 px-2 py-0.5 text-[11px]">
                  设主图
                </button>
                <button type="button" onClick={() => onPromote(url)} className="rounded border border-slate-300 px-2 py-0.5 text-[11px]">
                  轮播首位
                </button>
                <button type="button" onClick={() => onMoveLeft(idx)} className="rounded border border-slate-300 px-2 py-0.5 text-[11px]">
                  前移
                </button>
                <button type="button" onClick={() => onMoveRight(idx)} className="rounded border border-slate-300 px-2 py-0.5 text-[11px]">
                  后移
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-white px-3 py-5 text-center text-xs text-slate-500">
          {emptyText}
        </div>
      )}
    </div>
  );
}
