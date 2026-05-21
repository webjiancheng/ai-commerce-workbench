"use client";

import { useEffect, useMemo, useState } from "react";

import { HoverZoomImage } from "@/components/hover-zoom-image";
import { apiBaseUrl } from "@/lib/api";
import { resolveLocalTextRuntime } from "@/lib/local-settings";

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
  created_at: string;
};

type GenerationMode = "no_ai" | "title_only" | "title_and_image_prompts" | "full_later";

type ImageGroupKey = "carousel_images" | "sku_images" | "detail_images" | "size_chart_images";
type RawDragPayload =
  | { kind: "pool"; url: string }
  | { kind: "group"; url: string; group: ImageGroupKey; index: number };

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

export default function RawProductsPage() {
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [data, setData] = useState<RawProductListResponse>({ items: [], total: 0, limit: 50, offset: 0 });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<RawProductDetail | null>(null);
  const [splitCount, setSplitCount] = useState(1);
  const [generationMode, setGenerationMode] = useState<GenerationMode>("title_and_image_prompts");
  const [dragging, setDragging] = useState<RawDragPayload | null>(null);

  const allImages = useMemo(() => {
    if (!detail) return [];
    const merged = new Set<string>();
    if (detail.main_image) merged.add(detail.main_image);
    if (detail.screenshot_url) merged.add(detail.screenshot_url);
    detail.carousel_images.forEach((url) => merged.add(url));
    detail.sku_images.forEach((url) => merged.add(url));
    detail.detail_images.forEach((url) => merged.add(url));
    detail.size_chart_images.forEach((url) => merged.add(url));
    return Array.from(merged);
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

  function patchDetail(fields: Partial<RawProductDetail>): void {
    setDetail((prev) => (prev ? { ...prev, ...fields } : prev));
  }

  function moveImage(url: string, target: ImageGroupKey): void {
    setDetail((prev) => {
      if (!prev) return prev;
      const next = {
        ...prev,
        carousel_images: prev.carousel_images.filter((item) => item !== url),
        sku_images: prev.sku_images.filter((item) => item !== url),
        detail_images: prev.detail_images.filter((item) => item !== url),
        size_chart_images: prev.size_chart_images.filter((item) => item !== url),
      };
      const list = [...next[target]];
      if (!list.includes(url)) list.push(url);
      next[target] = list;
      return next;
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
        carousel_images: prev.carousel_images.filter((item) => item !== url),
        sku_images: prev.sku_images.filter((item) => item !== url),
        detail_images: prev.detail_images.filter((item) => item !== url),
        size_chart_images: prev.size_chart_images.filter((item) => item !== url),
      };
    });
  }

  function pushToGroup(url: string, target: ImageGroupKey): void {
    setDetail((prev) => {
      if (!prev || !url) return prev;
      if (prev[target].includes(url)) return prev;
      return { ...prev, [target]: [...prev[target], url] };
    });
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
      const localTextRuntime = resolveLocalTextRuntime();
      const aiHeaders: Record<string, string> = {};
      if (localTextRuntime?.apiKey) aiHeaders["X-AI-API-Key"] = localTextRuntime.apiKey;
      if (localTextRuntime?.baseUrl) aiHeaders["X-AI-Base-URL"] = localTextRuntime.baseUrl;
      if (localTextRuntime?.model) aiHeaders["X-AI-Model"] = localTextRuntime.model;
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
        body: JSON.stringify({ split_count: splitCount, generation_mode: generationMode }),
      });
      const result = (await response.json()) as { existed?: boolean; detail?: string };
      if (!response.ok) throw new Error(result.detail || `HTTP ${response.status}`);
      setNotice(result.existed ? "该商品已存在商品任务。" : "已生成商品任务。");
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
                      <option value="no_ai">只建任务</option>
                      <option value="title_only">只要 AI 标题</option>
                      <option value="title_and_image_prompts">AI 标题+图片提示词</option>
                      <option value="full_later">完整模式（预留）</option>
                    </select>
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
                <div className="mb-2 text-sm font-medium text-slate-800">图片纠错工作区（支持拖拽设组、组内换位、设主图）</div>
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
                        <button type="button" onClick={() => patchDetail({ main_image: url })} className="rounded border border-slate-300 px-2 py-0.5 text-[11px]">设主图</button>
                        <button type="button" onClick={() => moveImage(url, "carousel_images")} className="rounded border border-slate-300 px-2 py-0.5 text-[11px]">轮播</button>
                        <button type="button" onClick={() => moveImage(url, "sku_images")} className="rounded border border-slate-300 px-2 py-0.5 text-[11px]">SKU</button>
                        <button type="button" onClick={() => moveImage(url, "detail_images")} className="rounded border border-slate-300 px-2 py-0.5 text-[11px]">详情</button>
                        <button type="button" onClick={() => moveImage(url, "size_chart_images")} className="rounded border border-slate-300 px-2 py-0.5 text-[11px]">尺寸</button>
                        <button type="button" onClick={() => removeImage(url)} className="rounded border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] text-rose-700">删除</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {(["carousel_images", "sku_images", "detail_images", "size_chart_images"] as ImageGroupKey[]).map((group) => (
                  <ImageGroupEditor
                    key={group}
                    group={group}
                    title={
                      group === "carousel_images"
                        ? "轮播图"
                        : group === "sku_images"
                          ? "SKU图"
                          : group === "detail_images"
                            ? "详情图"
                            : "尺寸图"
                    }
                    images={detail[group]}
                    sourceImages={allImages}
                    onReorder={(images) => patchDetail({ [group]: images } as Partial<RawProductDetail>)}
                    onAppend={(url) => pushToGroup(url, group)}
                    onDropExternal={(url) => moveImage(url, group)}
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
      <div className="mb-2 text-sm font-medium text-slate-800">{title}</div>
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
