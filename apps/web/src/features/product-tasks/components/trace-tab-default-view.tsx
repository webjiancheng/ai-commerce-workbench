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

type Props = {
  task: ProductTaskDetail;
  raw: RawProductDetail | null;
  timeline: ProductTaskTimelineResponse | null;
  normMode: string;
  categoryOutput: Record<string, unknown>;
  categoryQueries: string[];
  categoryCandidates: Array<Record<string, unknown>>;
  categoryKeywords: string[];
  runtimeFromEvents: Record<string, unknown>;
  timelineEventsForDisplay: ProductTaskTimelineEvent[];
  flowPlan: { label: string; value: string }[];
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalEstimatedCost: number;
  costCurrency: string;
  aiStepRows: Array<Record<string, unknown>>;
  modelEvents: ProductTaskTimelineEvent[];
  backendEvents: ProductTaskTimelineEvent[];
  formatDateTime: (value: string | null | undefined) => string;
  formatJson: (value: unknown) => string;
  copyTraceEvent: (event: ProductTaskTimelineEvent) => Promise<void>;
  statusText: (status: string) => string;
  statusBadgeColor: (status: string) => string;
  formatMoney: (value: unknown, currency?: string) => string;
  formatInteger: (value: unknown) => string;
};

export function TraceTabDefaultView(props: Props) {
  const {
    task,
    raw,
    timeline,
    normMode,
    categoryOutput,
    categoryQueries,
    categoryCandidates,
    categoryKeywords,
    runtimeFromEvents,
    timelineEventsForDisplay,
    flowPlan,
    totalPromptTokens,
    totalCompletionTokens,
    totalTokens,
    totalEstimatedCost,
    costCurrency,
    aiStepRows,
    modelEvents,
    backendEvents,
    formatDateTime,
    formatJson,
    copyTraceEvent,
    statusText,
    statusBadgeColor,
    formatMoney,
    formatInteger,
  } = props;

  return (
    <div className="space-y-4">
      <Section title="排查总览">
        <div className="grid gap-4 xl:grid-cols-4">
          <CompareCard title="任务定位" tone="final" items={[
            { label: "任务 ID", value: String(task.id) },
            { label: "原始采集 ID", value: String(task.raw_product_id) },
            { label: "生成模式", value: task.generation_mode },
            { label: "当前步骤", value: timeline?.summary.current_step || statusText(task.main_status) },
          ]} />
          <CompareCard title="当前状态" tone="ai" items={[
            { label: "主状态", value: statusText(task.main_status) },
            { label: "类目状态", value: statusText(task.category_status) },
            { label: "标题状态", value: statusText(task.title_status) },
            { label: "图片提示词", value: statusText(task.image_prompt_status) },
          ]} />
          <CompareCard title="流程结果" tone="final" items={[
            { label: "图片状态", value: statusText(task.image_status) },
            { label: "导出状态", value: statusText(task.export_status) },
            { label: "选中类目", value: task.selected_category_id || task.ai?.category_best_path || "-" },
            { label: "当前标题", value: task.title || "-" },
          ]} />
          <CompareCard title="异常与时间" tone="raw" items={[
            { label: "异常等级", value: task.exception_level || "-" },
            { label: "异常状态", value: task.exception_status || "-" },
            { label: "最后报错", value: task.last_error_message || "-" },
            { label: "创建时间", value: formatDateTime(task.created_at) },
          ]} />
        </div>
      </Section>

      <Section title="模式说明">
        <div className="grid gap-4 xl:grid-cols-3">
          <CompareCard title="默认链路" tone="final" items={
            normMode === "title_only"
              ? [
                  { label: "模式定义", value: task.include_product_info ? "商品理解 + 中英文标题 + 代码类目召回" : "中英文标题 + 代码类目召回" },
                  { label: "默认 AI 次数", value: task.include_product_info ? "2 次" : "1 次" },
                  { label: "默认图片生成", value: "0 次" },
                  { label: "默认结果", value: "标题、类目检索字段、默认第 1 候选类目" },
                ]
              : flowPlan
          } />
          <CompareCard title="字段来源" tone="raw" items={[
            { label: "轮播图 / SKU 图", value: "原始回显" },
            { label: "标题", value: normMode === "task_only" ? "原始回显" : "AI 生成" },
            { label: "类目检索词", value: normMode === "task_only" ? "-" : "AI 生成" },
            { label: "默认候选类目", value: normMode === "task_only" ? "人工搜索" : "代码召回" },
          ]} />
          <CompareCard title="后续动作" tone="ai" items={[
            { label: "主图 / SKU 图", value: "用户主动生成" },
            { label: "四宫格 / 轮播图", value: "用户主动生成" },
            { label: "导出草稿", value: "预览或导出时触发" },
            { label: "导出执行", value: "人工确认后触发" },
          ]} />
        </div>
      </Section>

      <Section title="类目处理">
        <div className="grid gap-4 xl:grid-cols-4">
          <CompareCard title="原始采集类目" tone="neutral" items={[{ label: "采集时抓取的类目", value: raw?.category_path || "-" }]} />
          <CompareCard title="类目定位" tone="final" items={[
            { label: "默认第 1 候选", value: String(categoryOutput.selected_category || categoryOutput.best_path || task.selected_category_id || "-") },
            { label: "候选数量", value: String(categoryCandidates.length || 0) },
            { label: "人工选中类目", value: task.selected_category_id || "-" },
          ]} />
          <CompareCard title="AI 检索字段" tone="ai" items={[
            { label: "检索关键词", value: categoryKeywords.length ? categoryKeywords.join(" / ") : "-" },
            { label: "类目置信度", value: categoryOutput.confidence != null ? String(categoryOutput.confidence) : "-" },
          ]} />
          <CompareCard title="代码召回" tone="raw" items={[
            { label: "实际 query", value: categoryQueries.length ? categoryQueries.join(" / ") : "-" },
            { label: "类目待确认", value: task.category_status === "low_confidence" ? "是" : "否" },
            { label: "状态", value: statusText(task.category_status) },
            { label: "说明", value: categoryCandidates.length ? "AI 只提供检索字段，最终候选由代码字典召回。" : "暂无类目召回结果" },
          ]} />
        </div>
      </Section>

      <Section title="AI 配置与步骤调用">
        <div className="grid gap-4 xl:grid-cols-3">
          <CompareCard title="本次 AI 运行配置" tone="ai" items={[
            { label: "配置来源", value: String(runtimeFromEvents.provider_source || "-") },
            { label: "Provider", value: String(runtimeFromEvents.provider_display_name || runtimeFromEvents.provider_name || "-") },
            { label: "默认模型", value: String(runtimeFromEvents.model || "-") },
            { label: "输入 / 输出", value: totalTokens ? `${formatInteger(totalPromptTokens)} / ${formatInteger(totalCompletionTokens)}` : "-" },
            { label: "总 Tokens", value: totalTokens ? formatInteger(totalTokens) : "-" },
            { label: "解析时间", value: runtimeFromEvents.resolved_at ? formatDateTime(String(runtimeFromEvents.resolved_at)) : "-" },
          ]} />
          <CompareCard title="文本链路说明" tone="final" items={flowPlan} />
          <CompareCard title="当前排查重点" tone="raw" items={[
            { label: "模型 / 代码步骤", value: `${modelEvents.length} / 0` },
            { label: "后端动作数", value: String(backendEvents.length) },
            { label: "预估费用", value: totalEstimatedCost ? formatMoney(totalEstimatedCost, costCurrency) : "-" },
            { label: "最后报错", value: task.last_error_message || "-" },
          ]} />
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
                aiStepRows.map((row, i) => (
                  <tr key={i}>
                    <td className="px-4 py-3"><div className="font-medium text-slate-900">{String(row.step || "-")}</div><div className="mt-1 text-xs text-slate-500">{String(row.stage || "-")}</div></td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">{String(row.promptType || "-")}</td>
                    <td className="px-4 py-3"><div className="text-slate-800">{String(row.provider || "-")}</div></td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">{String(row.model || "-")}</td>
                    <td className="px-4 py-3 text-xs text-slate-700">{String(row.templateId || "-")}</td>
                    <td className="px-4 py-3"><span className={["rounded-full border px-2 py-1 text-xs", statusBadgeColor(String(row.status || "-"))].join(" ")}>{statusText(String(row.status || "-"))}</span></td>
                    <td className="px-4 py-3 text-xs text-slate-700">{String(row.durationMs || "-")} ms</td>
                    <td className="px-4 py-3 text-xs text-slate-700">{row.totalTokens ? formatInteger(row.totalTokens) : "-"}</td>
                    <td className="px-4 py-3 text-xs text-slate-700">{Number.isFinite(Number(row.estimatedCost)) ? formatMoney(row.estimatedCost, String(row.currency || costCurrency)) : "-"}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={9} className="px-4 py-6 text-center text-sm text-slate-500">暂无 AI 步骤记录</td></tr>
              )}
            </tbody>
          </table>
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
                      <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-500">#{index + 1}</span>
                      <span className="text-sm font-medium text-slate-900">{event.title}</span>
                      <span className={["rounded-full border px-2 py-0.5 text-[11px]", statusBadgeColor(event.status)].join(" ")}>{statusText(event.status)}</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{formatDateTime(event.ts)} · {event.stage} · {event.source}</div>
                    <div className="mt-2 whitespace-pre-wrap break-all text-sm text-slate-700">{event.message}</div>
                  </div>
                  <button type="button" onClick={() => void copyTraceEvent(event)} className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50">复制事件</button>
                </div>
                {Object.keys((event.meta as Record<string, unknown>) || {}).length ? (
                  <details className="mt-3 rounded-[14px] border border-slate-200 bg-white">
                    <summary className="cursor-pointer list-none px-3 py-2 text-xs text-slate-600">查看事件元数据</summary>
                    <pre className="overflow-auto border-t border-slate-200 p-3 text-xs text-slate-700">{formatJson(event.meta)}</pre>
                  </details>
                ) : null}
              </div>
            ))}
          </div>
        ) : <div className="text-sm text-slate-600">暂无时间线事件</div>}
      </Section>
    </div>
  );
}
