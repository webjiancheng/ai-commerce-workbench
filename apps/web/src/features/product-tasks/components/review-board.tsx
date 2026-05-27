"use client";

import { HoverZoomImage } from "@/components/hover-zoom-image";
import { statusText } from "@/components/product-tasks/status";
import { ThumbnailPlaceholder } from "@/components/product-tasks/thumbnail-placeholder";
import type {
  ProductTaskListItem,
  ProductTaskTimelineEvent,
  ProductTaskTimelineResponse,
  RowMeta,
} from "@/features/product-tasks/types";

type ReviewBoardProps = {
  items: ProductTaskListItem[];
  rowMeta: Record<number, RowMeta>;
  timelineMap: Record<number, ProductTaskTimelineResponse>;
  onOpenDrawer: (taskId: number) => void;
  taskThumbnail: (item: ProductTaskListItem, meta: RowMeta | undefined) => string | null;
  displayTimelineEvent: (
    event: ProductTaskTimelineEvent,
    allEvents: ProductTaskTimelineEvent[],
  ) => ProductTaskTimelineEvent;
  logEventStatusColor: (status: string) => string;
  formatDateTime: (value: string | null | undefined) => string;
  getGenerationModeLabel: (mode: string) => string;
  normalizeGenerationMode: (mode: string) => string;
  getLatestImageJobSummaries: (events: ProductTaskTimelineEvent[]) => ProductTaskTimelineEvent[];
};

export function ReviewBoard({
  items,
  rowMeta,
  timelineMap,
  onOpenDrawer,
  taskThumbnail,
  displayTimelineEvent,
  logEventStatusColor,
  formatDateTime,
  getGenerationModeLabel,
  normalizeGenerationMode,
  getLatestImageJobSummaries,
}: ReviewBoardProps) {
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
