import { HoverZoomImage } from "@/components/hover-zoom-image";

export type LightboxImage = {
  src: string;
  alt: string;
  caption?: string;
};

export type PoolCandidate = {
  src: string;
  label: string;
  source: string;
  assetId?: number;
};

export function CandidatePoolSection({
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

export function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{hint}</div>
    </div>
  );
}

export function ImageGallerySection({
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

export function ImageLightbox({
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
