import { HoverZoomImage } from "@/components/hover-zoom-image";
import type { ProductAsset } from "@/features/product-tasks/types";

export function LayoutCompareCard({
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
  slotLabel,
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
  slotLabel: (slot: string) => string;
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

export function FourGridCenterCard({
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
