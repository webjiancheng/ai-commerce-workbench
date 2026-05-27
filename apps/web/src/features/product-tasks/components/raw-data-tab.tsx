"use client";

import { ImageGallerySection } from "@/features/product-tasks/image-workbench/components/media-panels";
import { statusText } from "@/components/product-tasks/status";
import type { ProductTaskDetail, RawProductDetail } from "@/features/product-tasks/types";

function CompareCard({
  title,
  tone,
  items,
  onCopy,
}: {
  title: string;
  tone: "raw" | "ai" | "final" | "neutral";
  items: { label: string; value: string }[];
  onCopy: (value: string) => Promise<void>;
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
                  onClick={() => void onCopy(item.value)}
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[18px] border border-slate-200 bg-white p-5">
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function RawDataTab({
  task,
  raw,
  formatDateTime,
  onCopyText,
}: {
  task: ProductTaskDetail;
  raw: RawProductDetail | null;
  formatDateTime: (value: string | null | undefined) => string;
  onCopyText: (value: string) => Promise<void>;
}) {
  const screenshotImages = raw?.screenshot_url ? [raw.screenshot_url] : task.screenshot_url ? [task.screenshot_url] : [];

  return (
    <div className="space-y-4">
      <Section title="原始采集字段">
        <div className="grid gap-4 xl:grid-cols-2">
          <CompareCard
            title="原始文本"
            tone="raw"
            onCopy={onCopyText}
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
            onCopy={onCopyText}
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
