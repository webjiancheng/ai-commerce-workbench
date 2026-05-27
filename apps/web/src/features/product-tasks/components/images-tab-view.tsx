"use client";

import { HoverZoomImage } from "@/components/hover-zoom-image";
import {
  CandidatePoolSection,
  ImageLightbox,
  MetricCard,
  type LightboxImage,
  type PoolCandidate,
} from "@/features/product-tasks/image-workbench/components/media-panels";
import { FourGridCenterCard, LayoutCompareCard } from "@/features/product-tasks/image-workbench/components/slot-cards";
import type { AssetsBySlotResponse, ProductAsset, RawProductDetail, RawSkuPropItem } from "@/features/product-tasks/types";

type ImagesTabViewProps = {
  opError: string | null;
  jobStatus: string | null;
  allAssets: ProductAsset[];
  selectedTargetSlot: string;
  assigning: boolean;
  loading: boolean;
  lightbox: LightboxImage | null;
  dimensionJson: Record<string, unknown> | null;
  raw: RawProductDetail | null;
  rawCandidates: PoolCandidate[];
  aiCandidates: PoolCandidate[];
  assets: AssetsBySlotResponse;
  carouselSlots: readonly string[];
  extraCarouselSlots: readonly string[];
  supportSlots: readonly string[];
  draggedSlot: string | null;
  busySlots: Record<string, string>;
  insertSizeChartInCarousel: boolean;
  sizeChartPosition: number;
  imageSettingsSaving: boolean;
  sizeChartExportAsset: ProductAsset | null;
  arrangedCarouselExportAssets: { slot: string; asset: ProductAsset | null }[];
  carouselExportValue: string;
  skuCodeDraft: string;
  skuTextDraft: string;
  skuPropsDraft: RawSkuPropItem[];
  skuSaving: boolean;
  onCloseLightbox: () => void;
  onSelectTargetSlot: (slot: string) => void;
  onGenerateCarousel4Grid: () => void;
  onGenerateSellingImages: () => void;
  onGenerateSkuImage: () => void;
  onGenerateSizeImage: () => void;
  onSyncVisibleCarouselToTable: () => void;
  onSetLightbox: (image: LightboxImage) => void;
  onSetInsertSizeChartInCarousel: (value: boolean) => void;
  onSetSizeChartPosition: (value: number) => void;
  onSaveExportImageSettings: (next: { insert_size_chart_in_carousel: boolean; size_chart_position: number }) => void;
  onPatchSkuCodeDraft: (value: string) => void;
  onPatchSkuTextDraft: (value: string) => void;
  onPatchSkuPropDraft: (index: number, patch: Partial<RawSkuPropItem>) => void;
  onAddSkuPropDraft: () => void;
  onRemoveSkuPropDraft: (index: number) => void;
  onSaveSkuAttributes: () => void;
  onHandleUploadToSelectedSlot: (file: File) => void;
  onAssignCandidateToSlot: (payload: { targetSlot: string; sourceAssetId?: number; sourceUrl?: string; imageDataUrl?: string }) => void;
  onUploadToSlot: (slot: string, file: File) => void;
  onReorderSlots: (sourceSlot: string, targetSlot: string) => void;
  onSetDraggedSlot: (slot: string | null) => void;
  onFocusRawOverview: (slot: string) => void;
  onGenerateSingle: (slot: string) => void;
  onSetFinal: (assetId: number) => void;
  onRegenerate: (slot: string, assetId: number) => void;
  onDeleteSlotImage: (slot: string) => void;
  onRunDimensionExtract: (assetId: number) => void;
  onOpenPromptEditor: (slot: string) => void;
  slotLabel: (slot: string) => string;
  getRawReferenceImage: (slot: string) => string | null;
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[18px] border border-slate-200 bg-white p-5">
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function ImagesTabView(props: ImagesTabViewProps) {
  const {
    opError,
    jobStatus,
    allAssets,
    selectedTargetSlot,
    assigning,
    loading,
    lightbox,
    dimensionJson,
    raw,
    rawCandidates,
    aiCandidates,
    assets,
    carouselSlots,
    extraCarouselSlots,
    supportSlots,
    draggedSlot,
    busySlots,
    insertSizeChartInCarousel,
    sizeChartPosition,
    imageSettingsSaving,
    sizeChartExportAsset,
    arrangedCarouselExportAssets,
    carouselExportValue,
    skuCodeDraft,
    skuTextDraft,
    skuPropsDraft,
    skuSaving,
    onCloseLightbox,
    onSelectTargetSlot,
    onGenerateCarousel4Grid,
    onGenerateSellingImages,
    onGenerateSkuImage,
    onGenerateSizeImage,
    onSyncVisibleCarouselToTable,
    onSetLightbox,
    onSetInsertSizeChartInCarousel,
    onSetSizeChartPosition,
    onSaveExportImageSettings,
    onPatchSkuCodeDraft,
    onPatchSkuTextDraft,
    onPatchSkuPropDraft,
    onAddSkuPropDraft,
    onRemoveSkuPropDraft,
    onSaveSkuAttributes,
    onHandleUploadToSelectedSlot,
    onAssignCandidateToSlot,
    onUploadToSlot,
    onReorderSlots,
    onSetDraggedSlot,
    onFocusRawOverview,
    onGenerateSingle,
    onSetFinal,
    onRegenerate,
    onDeleteSlotImage,
    onRunDimensionExtract,
    onOpenPromptEditor,
    slotLabel,
    getRawReferenceImage,
  } = props;

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
            <button type="button" onClick={onGenerateCarousel4Grid} className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800">生成四宫格轮播图</button>
            <button type="button" onClick={onGenerateSellingImages} className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">批量生成轮播1-4</button>
            <button type="button" onClick={onGenerateSkuImage} className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">生成 SKU 图</button>
            <button type="button" onClick={onGenerateSizeImage} className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">生成尺寸图</button>
          </div>
          <button type="button" onClick={onSyncVisibleCarouselToTable} className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
            同步轮播到表格
          </button>
        </div>

        <div className="mt-4 rounded-[18px] border border-slate-200 bg-white p-4">
          <div className="text-sm font-semibold text-slate-900">四宫格中心位</div>
          <div className="mt-3">
            <FourGridCenterCard
              rawImage={getRawReferenceImage("carousel_1")}
              assets={assets.carousel_4grid || []}
              busyLabel={busySlots.carousel_4grid || (assigning ? "同步图片中" : null)}
              onGenerate={async () => {
                await onGenerateSingle("carousel_4grid");
              }}
              onPreview={(src, caption) => onSetLightbox({ src, alt: caption, caption })}
              onOpenPrompt={() => onOpenPromptEditor("carousel_4grid")}
            />
          </div>
        </div>

        <div className="mt-4 grid gap-3 xl:grid-cols-4">
          {carouselSlots.map((slot) => (
            <LayoutCompareCard
              key={slot}
              slot={slot}
              rawImage={getRawReferenceImage(slot)}
              assets={assets[slot] || []}
              selected={selectedTargetSlot === slot}
              dragged={draggedSlot === slot}
              draggedSlot={draggedSlot}
              busyLabel={busySlots[slot] || (assigning ? "同步图片中" : null)}
              onSelectSlot={onSelectTargetSlot}
              onDragStart={onSetDraggedSlot}
              onReorder={async (sourceSlot, targetSlot) => {
                await onReorderSlots(sourceSlot, targetSlot);
              }}
              onChooseOther={onFocusRawOverview}
              onUploadToSlot={async (slot, file) => {
                await onUploadToSlot(slot, file);
              }}
              onGenerateSingle={async (slot) => {
                await onGenerateSingle(slot);
              }}
              onSetFinal={async (assetId) => {
                await onSetFinal(assetId);
              }}
              onRegenerate={async (slot, assetId) => {
                await onRegenerate(slot, assetId);
              }}
              onDeleteSlot={async (slot) => {
                await onDeleteSlotImage(slot);
              }}
              onAssignFromAsset={async (targetSlot, sourceAssetId) => {
                onAssignCandidateToSlot({ targetSlot, sourceAssetId });
              }}
              onAssignFromUrl={async (targetSlot, sourceUrl) => {
                onAssignCandidateToSlot({ targetSlot, sourceUrl });
              }}
              onPreview={(src, caption) => onSetLightbox({ src, alt: caption, caption })}
              slotLabel={slotLabel}
              onOpenPrompt={() => onOpenPromptEditor(slot)}
            />
          ))}
        </div>

        <div className="mt-4 rounded-[18px] border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">剩余主图轮播图</div>
              <div className="mt-1 text-xs text-slate-500">前 4 张之外继续往下排。</div>
            </div>
            <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">导出 {arrangedCarouselExportAssets.length} 张</div>
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
                onSelectSlot={onSelectTargetSlot}
                onDragStart={onSetDraggedSlot}
                onReorder={async (sourceSlot, targetSlot) => {
                  await onReorderSlots(sourceSlot, targetSlot);
                }}
                onChooseOther={onFocusRawOverview}
                onUploadToSlot={async (slot, file) => {
                  await onUploadToSlot(slot, file);
                }}
                onGenerateSingle={async (slot) => {
                  await onGenerateSingle(slot);
                }}
                onSetFinal={async (assetId) => {
                  await onSetFinal(assetId);
                }}
                onRegenerate={async (slot, assetId) => {
                  await onRegenerate(slot, assetId);
                }}
                onDeleteSlot={async (slot) => {
                  await onDeleteSlotImage(slot);
                }}
                onAssignFromAsset={async (targetSlot, sourceAssetId) => {
                  onAssignCandidateToSlot({ targetSlot, sourceAssetId });
                }}
                onAssignFromUrl={async (targetSlot, sourceUrl) => {
                  onAssignCandidateToSlot({ targetSlot, sourceUrl });
                }}
                onPreview={(src, caption) => onSetLightbox({ src, alt: caption, caption })}
                slotLabel={slotLabel}
                onOpenPrompt={() => onOpenPromptEditor(slot)}
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
              onSelectSlot={onSelectTargetSlot}
              onDragStart={onSetDraggedSlot}
              onReorder={async (sourceSlot, targetSlot) => {
                await onReorderSlots(sourceSlot, targetSlot);
              }}
              onChooseOther={onFocusRawOverview}
              onUploadToSlot={async (slot, file) => {
                await onUploadToSlot(slot, file);
              }}
              onGenerateSingle={async (slot) => {
                await onGenerateSingle(slot);
              }}
              onSetFinal={async (assetId) => {
                await onSetFinal(assetId);
              }}
              onRegenerate={async (slot, assetId) => {
                await onRegenerate(slot, assetId);
              }}
              onDeleteSlot={async (slot) => {
                await onDeleteSlotImage(slot);
              }}
              onAssignFromAsset={async (targetSlot, sourceAssetId) => {
                onAssignCandidateToSlot({ targetSlot, sourceAssetId });
              }}
              onAssignFromUrl={async (targetSlot, sourceUrl) => {
                onAssignCandidateToSlot({ targetSlot, sourceUrl });
              }}
              onPreview={(src, caption) => onSetLightbox({ src, alt: caption, caption })}
              slotLabel={slotLabel}
              onOpenPrompt={() => onOpenPromptEditor(slot)}
            />
          ))}
        </div>

        <div className="mt-4 rounded-[18px] border border-amber-200 bg-amber-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-amber-950">尺寸图导出位置</div>
              <div className="mt-1 text-xs text-amber-800">导出时插入尺寸图位置。</div>
              {!sizeChartExportAsset?.public_url ? <div className="mt-2 text-xs text-amber-700">当前还没有已采用的尺寸图。</div> : null}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-white px-3 py-2 text-xs text-amber-900">
                <input
                  type="checkbox"
                  checked={insertSizeChartInCarousel}
                  onChange={(event) => {
                    const next = { insert_size_chart_in_carousel: event.target.checked, size_chart_position: sizeChartPosition };
                    onSetInsertSizeChartInCarousel(next.insert_size_chart_in_carousel);
                    onSaveExportImageSettings(next);
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
                    const next = { insert_size_chart_in_carousel: insertSizeChartInCarousel, size_chart_position: Number(event.target.value) };
                    onSetSizeChartPosition(next.size_chart_position);
                    onSaveExportImageSettings(next);
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
              <div className="mt-1 text-xs text-slate-500">采集到的 SKU 图可逐张设为 `SKU 图` 槽位。</div>
            </div>
            <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">{raw?.sku_images?.length || 0} 张</div>
          </div>
          {raw?.sku_images?.length ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {raw.sku_images.map((src, index) => (
                <div key={index} className="rounded-[14px] border border-slate-200 bg-slate-50 p-2">
                  <button type="button" onClick={() => onSetLightbox({ src, alt: `SKU 图 ${index + 1}`, caption: `SKU 图 ${index + 1}` })} className="block w-full">
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
                    >
                      拖拽
                    </button>
                    <button type="button" onClick={() => onAssignCandidateToSlot({ targetSlot: "sku_image", sourceUrl: src })} className="flex-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50">
                      设为 SKU 图
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 rounded-[12px] border border-dashed border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">暂无采集到的 SKU 图</div>
          )}

          <div className="mt-4 grid gap-3 xl:grid-cols-2">
            <label className="text-xs text-slate-600">
              平台 SKU
              <input value={skuCodeDraft} onChange={(event) => onPatchSkuCodeDraft(event.target.value)} className="mt-1 w-full rounded-[10px] border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800" />
            </label>
            <label className="text-xs text-slate-600">
              SKU 文本
              <textarea value={skuTextDraft} onChange={(event) => onPatchSkuTextDraft(event.target.value)} className="mt-1 h-20 w-full rounded-[10px] border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800" />
            </label>
          </div>
          <div className="mt-4 rounded-[14px] border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">结构化 SKU 规格</div>
                <div className="mt-1 text-xs text-slate-500">上架补充里的 SKU 行会优先拿这里预填。</div>
              </div>
              <button type="button" onClick={onAddSkuPropDraft} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50">添加选项</button>
            </div>
            <div className="mt-3 space-y-2">
              {skuPropsDraft.length ? (
                skuPropsDraft.map((item, index) => (
                  <div key={index} className="grid gap-2 rounded-[12px] border border-slate-200 bg-white p-2 xl:grid-cols-[120px_1fr_1fr_auto]">
                    <input value={item.group_name} onChange={(event) => onPatchSkuPropDraft(index, { group_name: event.target.value })} className="rounded-[10px] border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800" placeholder="规格组" />
                    <input value={item.option_name} onChange={(event) => onPatchSkuPropDraft(index, { option_name: event.target.value })} className="rounded-[10px] border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800" placeholder="选项值" />
                    <input value={item.image_url || ""} onChange={(event) => onPatchSkuPropDraft(index, { image_url: event.target.value || null })} className="rounded-[10px] border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800" placeholder="对应 SKU 图 URL，可留空" />
                    <button type="button" onClick={() => onRemoveSkuPropDraft(index)} className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">删除</button>
                  </div>
                ))
              ) : (
                <div className="rounded-[12px] border border-dashed border-slate-200 bg-white p-3 text-xs text-slate-500">还没有结构化 SKU 规格。</div>
              )}
            </div>
          </div>
          <div className="mt-3">
            <button type="button" onClick={onSaveSkuAttributes} disabled={skuSaving} className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
              {skuSaving ? "保存中..." : "保存 SKU 属性"}
            </button>
          </div>
        </div>

        <div className="mt-4 rounded-[14px] border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs text-slate-500">导出字段预览值</div>
          <div className="mt-2 break-all text-xs text-slate-700">{carouselExportValue || "当前还没有可导出的轮播图 URL"}</div>
        </div>
      </Section>

      <Section title="原始采集图片总览">
        <div id="raw-source-overview" className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">当前目标位：{slotLabel(selectedTargetSlot)}</div>
              <div className="mt-1 text-xs text-slate-500">素材池选中后会放到当前目标位。</div>
            </div>
            <label className="inline-flex cursor-pointer items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
              本地上传到当前位
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onHandleUploadToSelectedSlot(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </div>
        </div>
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <CandidatePoolSection
            title="原始主图 / 轮播图"
            description="默认从这里同步到轮播编排。"
            items={rawCandidates.filter((item) => item.label.startsWith("原始主图") || item.label.startsWith("原始轮播"))}
            onAssign={(item) => onAssignCandidateToSlot({ targetSlot: selectedTargetSlot, sourceUrl: item.src })}
            onPreview={(src, caption) => onSetLightbox({ src, alt: caption, caption })}
            onDragStateChange={() => {}}
          />
          <CandidatePoolSection
            title="详情 / SKU / 尺寸 / 页面截图"
            description="用于补细节或缺失角度。"
            items={rawCandidates.filter((item) => !item.label.startsWith("原始主图") && !item.label.startsWith("原始轮播"))}
            onAssign={(item) => onAssignCandidateToSlot({ targetSlot: selectedTargetSlot, sourceUrl: item.src })}
            onPreview={(src, caption) => onSetLightbox({ src, alt: caption, caption })}
            onDragStateChange={() => {}}
          />
        </div>
        <div className="mt-4">
          <CandidatePoolSection
            title="AI 生成素材"
            description="已生成素材可直接替换上方位置。"
            items={aiCandidates}
            onAssign={(item) => onAssignCandidateToSlot({ targetSlot: selectedTargetSlot, sourceAssetId: item.assetId })}
            onPreview={(src, caption) => onSetLightbox({ src, alt: caption, caption })}
            onDragStateChange={() => {}}
          />
        </div>
        <div className="mt-4 rounded-[18px] border border-slate-200 bg-white p-4">
          <div className="text-sm font-semibold text-slate-900">尺寸识别工作区</div>
          <div className="mt-1 text-xs text-slate-500">从尺寸图挑一张识别，结果显示在下方。</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {allAssets.slice(0, 12).map((asset) => (
              <button key={asset.id} type="button" onClick={() => onRunDimensionExtract(asset.id)} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
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
        <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">正在加载图片资产…</div>
      ) : null}

      <ImageLightbox image={lightbox} onClose={onCloseLightbox} />
    </div>
  );
}
