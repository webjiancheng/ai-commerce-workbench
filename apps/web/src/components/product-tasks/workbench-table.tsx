"use client";

import { HoverZoomImage } from "@/components/hover-zoom-image";
import { SearchableCategoryInput, type CategorySearchItem } from "@/components/product-tasks/searchable-category-input";
import { StatusBadge, statusText } from "@/components/product-tasks/status";
import { ThumbnailPlaceholder } from "@/components/product-tasks/thumbnail-placeholder";
import type {
  AssetsBySlotResponse,
  ProductAsset,
  ProductTaskListItem,
  RawProductDetail,
  RowMeta,
  TableSlotImage,
} from "@/features/product-tasks/types";
import {
  latestAsset,
  selectedSlotAsset,
  tableSlotImage,
  taskThumbnail,
} from "@/features/product-tasks/utils";
import { useState } from "react";

async function copyText(value: string): Promise<void> {
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  window.prompt("复制内容", value);
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

function HoverTitleText({ value }: { value: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
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

function RowActionButtons({
  rowAction,
  onOpenDrawer,
  onRunAi,
  onGenerateFourGrid,
  onDelete,
}: {
  rowAction: string;
  onOpenDrawer: () => void;
  onRunAi: () => void;
  onGenerateFourGrid: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={onOpenDrawer}
        className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
      >
        查看 / 修改
      </button>
      <button
        type="button"
        onClick={onRunAi}
        disabled={rowAction !== ""}
        className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
      >
        {rowAction === "run-ai" ? "AI生成中..." : "重新AI生成"}
      </button>
      <button
        type="button"
        onClick={onGenerateFourGrid}
        disabled={rowAction !== ""}
        className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
      >
        {rowAction === "gen-4grid" ? "提交中..." : "生四宫格"}
      </button>
      <button
        type="button"
        onClick={onDelete}
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
  );
}

export function WorkbenchTable({
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
  onRunAi,
  onGenerateTitles,
  onSaveTitle,
  onSaveCategory,
  onGenerateFourGrid,
  onOpenDrawer,
  onDelete,
  onOpenPromptEditor,
  formatDateTime,
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
  onRunAi: (taskId: number) => void;
  onGenerateTitles: (taskId: number) => void;
  onSaveTitle: (taskId: number) => void;
  onSaveCategory: (taskId: number) => void;
  onGenerateFourGrid: (taskId: number) => void;
  onOpenDrawer: (taskId: number) => void;
  onDelete: (taskId: number) => void;
  onOpenPromptEditor: (fieldLabel: string, promptTypes: string[]) => void;
  formatDateTime: (value: string | null | undefined) => string;
}) {
  return (
    <div className="overflow-x-auto rounded-[24px] border border-slate-200 bg-white">
      <table className="min-w-full border-collapse text-left text-sm">
        <thead className="bg-slate-100 text-slate-600">
          <tr>
            <th className="px-4 py-3 font-medium">
              <input type="checkbox" checked={allSelected} onChange={onToggleSelectAll} />
            </th>
            <th className="px-4 py-3 font-medium">缩略图</th>
            <th className="px-4 py-3 font-medium">
              <PromptableHeader
                label="英文标题"
                onEditPrompt={() =>
                  onOpenPromptEditor("英文标题", [
                    "title_en",
                    "title_en_only",
                    "title_package_lite",
                    "title_package",
                    "product_info_from_screenshot",
                  ])
                }
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
                onEditPrompt={() =>
                  onOpenPromptEditor("主图 / 四宫格", [
                    "image_prompt_main",
                    "image_prompt_carousel_1",
                    "image_prompt_carousel_2",
                    "image_prompt_carousel_3",
                    "image_prompt_carousel_4",
                    "image_prompt_carousel_4grid",
                  ])
                }
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
              const aiCategoryText = detail?.ai?.category_best_path || item.selected_category_id || "";
              const rawCategoryText = meta?.raw?.category_path || "";
              const quickTitle =
                quickTitleDrafts[item.id] ??
                String(
                  meta?.exportDraft?.fields_json?.["英文名称"] ||
                    meta?.exportDraft?.fields_json?.product_title_en ||
                    detail?.ai?.title_en ||
                    "",
                ).trim();
              const quickCategory =
                quickCategoryDrafts[item.id] ?? detail?.selected_category_id ?? detail?.ai?.category_best_path ?? "";
              const preferredCategoryPaths = [
                ...(detail?.ai?.category_top3 || []).map((candidate) => candidate.path),
                ...(((detail?.ai?.category_candidates || []) as { path: string }[]).map((candidate) => candidate.path)),
                detail?.selected_category_id || "",
                detail?.ai?.category_best_path || "",
                meta?.raw?.category_path || "",
              ].filter(Boolean);

              return (
                <tr key={item.id} className="border-t hover:bg-slate-50">
                  <td className="px-4 ">
                    <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => onToggleSelect(item.id)} />
                  </td>
                  <td>
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
                  <td className="px-4 ">
                    <div className="relative w-[280px] space-y-2">
                      {rowAction === "run-ai" || rowAction === "gen-title" ? (
                        <InlineLoadingOverlay label={rowActionLabel} />
                      ) : null}
                      <div className="rounded-[12px] border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                        <div className="text-[11px] text-slate-500">原英文标题（采集）</div>
                        <HoverTitleText value={originalEnTitleText} />
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
                      <div>
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
                  <td className="px-4 ">
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
                  <td className="px-4 ">
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
                  <td className="px-4 ">
                    {hasFourGrid ? (
                      <div>
                        <TableFourGridCell
                          parentAsset={fourGridParent}
                          slotImages={fourGridImages}
                          busyLabel={
                            rowAction === "gen-4grid"
                              ? rowActionLabel
                              : item.image_status === "running" || item.main_status === "image_running"
                                ? "图片生成中"
                                : null
                          }
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
                  <td className="px-4 ">
                    <TableCarouselFieldCell
                      assets={meta?.assets}
                      raw={meta?.raw || null}
                      busyLabel={
                        rowAction === "gen-4grid"
                          ? rowActionLabel
                          : item.image_status === "running" || item.main_status === "image_running"
                            ? "图片生成中"
                            : null
                      }
                    />
                  </td>
                  <td className="px-4 ">
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
                  <td className="px-4 ">
                    <div className="space-y-1 text-xs text-slate-600">
                      <div>原始图 {rawImageTotal} 张</div>
                      <div>AI 图 {aiImageTotal} 张</div>
                    </div>
                  </td>
                  <td className="px-4 ">
                    <div className="max-w-[240px] space-y-2 text-xs">
                      <StatusBadge status={item.main_status} prefix="主状态：" />
                      <StatusBadge status={item.export_status} prefix="导出：" className="ml-2" />
                      {item.exception_level ? (
                        <>
                          <span className={[("inline-flex items-center rounded-full border px-2 py-1"), exceptionTone].join(" ")}>
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
                  <td className="px-4 text-xs text-slate-600">
                    <div>平台：{item.product_platform || meta?.raw?.platform || "-"}</div>
                    <div className="mt-1">source_id：{item.source_id || meta?.raw?.source_id || "-"}</div>
                    <div className="mt-1">raw_id：{item.raw_product_id}</div>
                    <div className="mt-1">采集：{formatDateTime(collectTime)}</div>
                    <div className="mt-1">SKU图：{rawSkuCount} 张</div>
                    <div className="mt-1">尺寸图：{sizeChartStatus}</div>
                  </td>
                  <td className="px-4 ">
                    <RowActionButtons
                      rowAction={rowAction}
                      onOpenDrawer={() => onOpenDrawer(item.id)}
                      onRunAi={() => onRunAi(item.id)}
                      onGenerateFourGrid={() => onGenerateFourGrid(item.id)}
                      onDelete={() => onDelete(item.id)}
                    />
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
