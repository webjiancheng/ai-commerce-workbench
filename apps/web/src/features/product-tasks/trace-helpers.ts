import type { ProductTaskTimelineEvent } from "@/features/product-tasks/types";

export function logEventStatusColor(status: string): string {
  if (status === "success" || status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "failed" || status === "warning" || status === "blocking") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "running" || status === "queued" || status === "started") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-white text-slate-500";
}

function getEventJobId(event: ProductTaskTimelineEvent): number | null {
  const raw = event.meta?.job_id;
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

function imageJobFinishedEvent(events: ProductTaskTimelineEvent[], jobId: number | null): ProductTaskTimelineEvent | null {
  if (!jobId) return null;
  return (
    events.find(
      (event) =>
        event.stage === "image.result" &&
        getEventJobId(event) === jobId &&
        (event.status === "success" || event.status === "failed"),
    ) || null
  );
}

export function displayTimelineEvent(
  event: ProductTaskTimelineEvent,
  allEvents: ProductTaskTimelineEvent[],
): ProductTaskTimelineEvent {
  if (!event.stage.startsWith("image.queue")) return event;
  const finished = imageJobFinishedEvent(allEvents, getEventJobId(event));
  if (!finished) return event;
  const imageType = String(event.meta?.image_type || finished.meta?.image_type || "");
  const parts = ["图片任务"];
  if (imageType) parts.push(`类型: ${imageType}`);
  if (finished.meta?.provider) parts.push(`供应商: ${String(finished.meta.provider)}`);
  if (finished.meta?.model_name) parts.push(`模型: ${String(finished.meta.model_name)}`);
  if (finished.meta?.estimated_cost != null) {
    const currency = String(finished.meta?.currency || "USD");
    parts.push(`预估费用: ${Number(finished.meta.estimated_cost).toFixed(4)} ${currency}`);
  }
  if (finished.meta?.final_prompt) {
    const promptPreview = String(finished.meta.final_prompt).replace(/\s+/g, " ").slice(0, 120);
    parts.push(`Prompt: ${promptPreview}${String(finished.meta.final_prompt).length > 120 ? "..." : ""}`);
  }

  return {
    ...finished,
    stage: event.stage,
    title: `${event.title} → ${finished.status === "success" ? "已完成" : "失败"}`,
    message: parts.join(" | "),
    meta: {
      ...finished.meta,
      queued_at: event.ts,
      queue_meta: event.meta,
    },
  };
}

export function getLatestImageJobSummaries(events: ProductTaskTimelineEvent[]): ProductTaskTimelineEvent[] {
  const byJob = new Map<number, ProductTaskTimelineEvent>();
  events.forEach((event) => {
    if (!event.stage.startsWith("image.")) return;
    const jobId = getEventJobId(event);
    if (!jobId) return;
    const existing = byJob.get(jobId);
    if (!existing || (event.ts && existing.ts && event.ts > existing.ts)) byJob.set(jobId, event);
  });
  return Array.from(byJob.values()).sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));
}

export function isModelCallEvent(event: ProductTaskTimelineEvent): boolean {
  return Boolean(event.meta?.is_model_call);
}

export function modelCallSummary(event: ProductTaskTimelineEvent, fallbackCurrency = "USD"): string {
  const usage = (event.meta?.usage as Record<string, unknown> | undefined) || {};
  const cost = (event.meta?.cost as Record<string, unknown> | undefined) || {};
  const provider = (event.meta?.provider as Record<string, unknown> | undefined) || {};
  const promptType = String(event.meta?.prompt_type || "-");
  const model = String(event.meta?.model || "-");
  const providerName = String(provider.provider_display_name || provider.provider_name || "-");
  const totalTokens = Number(usage.total_tokens || 0);
  const estimated = Number(cost.estimated_cost ?? NaN);
  const currency = String(cost.currency || fallbackCurrency || "USD");
  const tokenPart = totalTokens ? `${totalTokens.toLocaleString()} tokens` : "tokens -";
  const costPart = Number.isFinite(estimated) ? `${estimated.toFixed(4)} ${currency}` : "cost -";
  return `${promptType} | ${providerName} / ${model} | ${tokenPart} | ${costPart}`;
}

export function dedupeCompatAiEvents(events: ProductTaskTimelineEvent[]): ProductTaskTimelineEvent[] {
  const consumed = new Set<number>();
  const result: ProductTaskTimelineEvent[] = [];
  for (let index = 0; index < events.length; index += 1) {
    if (consumed.has(index)) continue;
    const current = events[index];
    if (current.stage !== "ai.result") {
      result.push(current);
      continue;
    }
    const promptType = String(current.meta?.prompt_type || "");
    if (!promptType) {
      result.push(current);
      continue;
    }
    const nextIndex = index + 1;
    const next = events[nextIndex];
    if (next && next.stage === "ai.result" && String(next.meta?.prompt_type || "") === promptType) {
      const currentProvider = (current.meta?.provider as Record<string, unknown> | undefined) || {};
      const currentRuntime = (current.meta?.runtime as Record<string, unknown> | undefined) || {};
      const nextProvider = (next.meta?.provider as Record<string, unknown> | undefined) || {};
      const nextRuntime = (next.meta?.runtime as Record<string, unknown> | undefined) || {};
      const currentSource = String(currentProvider.provider_source || currentRuntime.provider_source || "");
      const nextSource = String(nextProvider.provider_source || nextRuntime.provider_source || "");
      const preferNext = currentSource === "legacy" && nextSource !== "legacy";
      result.push(preferNext ? next : current);
      consumed.add(nextIndex);
      continue;
    }
    result.push(current);
  }
  return result;
}
