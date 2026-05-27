"use client";

import { CompareCard } from "@/features/product-tasks/components/compare-card";
import type { ProductTaskDetail, ProductTaskTimelineEvent, ProductTaskTimelineResponse, RawProductDetail } from "@/features/product-tasks/types";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[18px] border border-slate-200 bg-white p-5">
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

type TraceTabLogsViewProps = {
  task: ProductTaskDetail;
  raw: RawProductDetail | null;
  timeline: ProductTaskTimelineResponse | null;
  normMode: string;
  defaultChainChecks: Array<{ key: string; label: string; hint: string; done: boolean; status: string }>;
  followupChecks: Array<{ key: string; label: string; hint: string; done: boolean; status: string }>;
  compactImageSummaries: ProductTaskTimelineEvent[];
  compactTimelineEvents: ProductTaskTimelineEvent[];
  modelEvents: ProductTaskTimelineEvent[];
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalEstimatedCost: number;
  costCurrency: string;
  codeStepEvents: ProductTaskTimelineEvent[];
  formatDateTime: (value: string | null | undefined) => string;
  formatJson: (value: unknown) => string;
  copyTraceEvent: (event: ProductTaskTimelineEvent) => Promise<void>;
  statusText: (status: string) => string;
  logEventStatusColor: (status: string) => string;
  modelCallSummary: (event: ProductTaskTimelineEvent, fallbackCurrency?: string) => string;
  isModelCallEvent: (event: ProductTaskTimelineEvent) => boolean;
  getGenerationModeLabel: (mode: string) => string;
  formatMoney: (value: unknown, currency?: string) => string;
  formatInteger: (value: unknown) => string;
};

export function TraceTabLogsView(props: TraceTabLogsViewProps) {
  const {
    task,
    raw,
    timeline,
    normMode,
    defaultChainChecks,
    followupChecks,
    compactImageSummaries,
    compactTimelineEvents,
    modelEvents,
    totalTokens,
    totalPromptTokens,
    totalCompletionTokens,
    totalEstimatedCost,
    costCurrency,
    codeStepEvents,
    formatDateTime,
    formatJson,
    copyTraceEvent,
    statusText,
    logEventStatusColor,
    modelCallSummary,
    isModelCallEvent,
    getGenerationModeLabel,
    formatMoney,
    formatInteger,
  } = props;

  return (
    <div className="space-y-4">
      <section className="rounded-[22px] border border-slate-200 bg-slate-950 p-5 text-white">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs text-slate-300">Task #{task.id} / Raw #{task.raw_product_id}</div>
            <div className="mt-2 line-clamp-2 text-xl font-semibold">{task.title}</div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1">{getGenerationModeLabel(normMode)}</span>
              <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1">
                当前：{timeline?.summary.current_step || statusText(task.main_status)}
              </span>
              <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1">创建：{formatDateTime(task.created_at)}</span>
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
          <div className="mt-4 rounded-[16px] border border-rose-300/30 bg-rose-500/15 p-3 text-sm text-rose-100">最后报错：{task.last_error_message}</div>
        ) : null}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[22px] border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">默认链路</div>
              <div className="mt-1 text-xs text-slate-500">只看创建任务后默认会跑的步骤，按当前模式判断跳过项。</div>
            </div>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">{normMode}</span>
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
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500">#{index + 1}</span>
                      <span className="text-sm font-medium text-slate-900">{event.title}</span>
                      <span className={["rounded-full border px-2 py-0.5 text-[11px]", logEventStatusColor(event.status)].join(" ")}>
                        {event.status === "completed" ? "已完成" : statusText(event.status)}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{formatDateTime(event.ts)} · {event.stage}</div>
                    <div className="mt-2 whitespace-pre-wrap break-all text-sm text-slate-700">{event.message}</div>
                    {isModelCallEvent(event) ? (
                      <div className="mt-2 rounded-[12px] border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">{modelCallSummary(event, costCurrency)}</div>
                    ) : null}
                  </div>
                  <button type="button" onClick={() => void copyTraceEvent(event)} className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50">复制事件</button>
                </div>
                <details className="mt-3 rounded-[14px] border border-slate-200 bg-slate-50">
                  <summary className="cursor-pointer list-none px-3 py-2 text-xs text-slate-600">查看元数据</summary>
                  <pre className="overflow-auto border-t border-slate-200 p-3 text-xs text-slate-700">{formatJson(event.meta)}</pre>
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
            <div className="mt-1 text-lg font-semibold text-slate-900">{totalTokens ? `${formatInteger(totalTokens)}（in ${formatInteger(totalPromptTokens)} / out ${formatInteger(totalCompletionTokens)}）` : "-"}</div>
          </div>
          <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs text-slate-500">预估费用</div>
            <div className="mt-1 text-lg font-semibold text-slate-900">{totalEstimatedCost ? formatMoney(totalEstimatedCost, costCurrency) : "-"}</div>
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
                      <div className="mt-1 text-xs text-slate-500">{formatDateTime(event.ts)} · {event.stage} · {String(event.meta?.prompt_type || "-")}</div>
                      <div className="mt-1 text-xs text-slate-700">{modelCallSummary(event, costCurrency)}</div>
                    </div>
                    <span className={["rounded-full border px-2 py-0.5 text-[11px]", logEventStatusColor(event.status)].join(" ")}>{statusText(event.status)}</span>
                  </div>
                </summary>
                <div className="grid gap-3 border-t border-slate-200 p-4 xl:grid-cols-3">
                  <pre className="max-h-[360px] overflow-auto rounded-[14px] border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">{formatJson(event.meta?.input)}</pre>
                  <pre className="max-h-[360px] overflow-auto rounded-[14px] border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">{typeof event.meta?.prompt === "string" && event.meta.prompt ? event.meta.prompt : "-"}</pre>
                  <pre className="max-h-[360px] overflow-auto rounded-[14px] border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">{formatJson(event.meta?.output)}</pre>
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
                  <span className={["rounded-full border px-2 py-0.5 text-[11px]", logEventStatusColor(event.status)].join(" ")}>{statusText(event.status)}</span>
                </div>
                <details className="mt-3 rounded-[14px] border border-slate-200 bg-white">
                  <summary className="cursor-pointer list-none px-3 py-2 text-xs text-slate-600">查看代码步骤输出</summary>
                  <pre className="max-h-[360px] overflow-auto border-t border-slate-200 p-3 text-xs text-slate-700">{formatJson(event.meta?.output)}</pre>
                </details>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-slate-600">暂无代码处理步骤。</div>
        )}
      </Section>

      <Section title="原始输入摘要">
        <div className="grid gap-4 xl:grid-cols-2">
          <CompareCard title="原始采集" tone="raw" items={[
            { label: "原标题", value: raw?.title || task.title || "-" },
            { label: "平台", value: raw?.platform || task.product_platform || "-" },
            { label: "来源链接", value: raw?.url || task.source_url || "-" },
            { label: "平台 SKU", value: raw?.platform_sku || task.platform_sku || "-" },
          ]} />
          <CompareCard title="素材证据" tone="ai" items={[
            { label: "截图", value: raw?.screenshot_url || task.screenshot_url || "-" },
            { label: "主图张数", value: String((raw?.carousel_images?.length || 0) + (raw?.main_image ? 1 : 0)) },
            { label: "详情图张数", value: String(raw?.detail_images?.length || 0) },
            { label: "尺寸图张数", value: String(raw?.size_chart_images?.length || 0) },
          ]} />
        </div>
      </Section>

      <Section title="图片任务结果">
        {compactImageSummaries.length ? (
          <div className="space-y-2">
            {compactImageSummaries.map((event, index) => (
              <div key={`${event.stage}-${event.ts || "na"}-${index}`} className="rounded-[14px] border border-slate-200 bg-white p-3 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-800">{event.title}</div>
                    <div className="mt-1 line-clamp-1 text-slate-500">{event.message}</div>
                  </div>
                  <span className={["shrink-0 rounded-full border px-2 py-0.5 text-[11px]", logEventStatusColor(event.status)].join(" ")}>
                    {event.status === "completed" ? "已完成" : statusText(event.status)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-slate-500">暂无图片任务记录。</div>
        )}
      </Section>
    </div>
  );
}

