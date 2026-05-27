"use client";

import { useEffect, useState } from "react";

import { SearchableCategoryInput, type CategorySearchItem, type CategorySearchResponse } from "@/components/product-tasks/searchable-category-input";
import { statusText } from "@/components/product-tasks/status";
import type { ProductTaskDetail, ProductTaskTimelineEvent, ProductTaskTimelineResponse, RawProductDetail } from "@/features/product-tasks/types";
import { apiBaseUrl } from "@/lib/api";
import type { AiPurpose } from "@/lib/local-settings";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[18px] border border-slate-200 bg-white p-5">
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function CompareCard({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "raw" | "ai" | "final" | "neutral";
  items: { label: string; value: string }[];
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
            <div className="text-xs text-slate-500">{item.label}</div>
            <div className="mt-1 whitespace-pre-wrap break-all text-sm text-slate-800">{item.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function InfoTab({
  task,
  raw,
  timeline,
  onRefresh,
  isLogsRoute,
  formatDateTime,
  formatJson,
  copyTraceEvent,
  getGenerationModeLabel,
  buildAiRequestHeaders,
}: {
  task: ProductTaskDetail;
  raw: RawProductDetail | null;
  timeline: ProductTaskTimelineResponse | null;
  onRefresh?: (() => Promise<void>) | undefined;
  isLogsRoute: boolean;
  formatDateTime: (value: string | null | undefined) => string;
  formatJson: (value: unknown) => string;
  copyTraceEvent: (event: ProductTaskTimelineEvent) => Promise<void>;
  getGenerationModeLabel: (mode: string) => string;
  buildAiRequestHeaders: (includeJsonContentType?: boolean, preferredPurposes?: AiPurpose[]) => Record<string, string>;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualTitle, setManualTitle] = useState(task.ai?.title_en || "");
  const [manualCategory, setManualCategory] = useState(task.selected_category_id || task.ai?.category_best_path || "");
  const [categoryOptions, setCategoryOptions] = useState<CategorySearchItem[]>([]);

  useEffect(() => {
    setManualTitle(task.ai?.title_en || "");
    setManualCategory(task.selected_category_id || task.ai?.category_best_path || "");
  }, [task.id, task.title, task.selected_category_id, task.ai?.category_best_path, task.ai?.title_en]);

  useEffect(() => {
    let cancelled = false;
    async function loadCategoryOptions(): Promise<void> {
      try {
        const response = await fetch(`${apiBaseUrl}/api/categories/search?limit=5000`, { cache: "no-store" });
        if (!response.ok) return;
        const result = (await response.json()) as CategorySearchResponse;
        if (!cancelled) {
          setCategoryOptions(result.items || []);
        }
      } catch {
        // ignore
      }
    }
    void loadCategoryOptions();
    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshAfterMutation(): Promise<void> {
    if (onRefresh) await onRefresh();
  }

  async function runProductInfo(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/product-tasks/${task.id}/run-product-info`, {
        method: "POST",
        headers: buildAiRequestHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "触发商品理解失败");
    } finally {
      setLoading(false);
    }
  }

  async function regenerateTitles(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/product-tasks/${task.id}/generate-titles`, {
        method: "POST",
        headers: buildAiRequestHeaders(false, ["title_package_lite", "title"]),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "触发标题重生成失败");
    } finally {
      setLoading(false);
    }
  }

  async function selectCategory(path: string): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/product-tasks/${task.id}/select-category`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category_path: path }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await refreshAfterMutation();
    } catch (err) {
      setError(err instanceof Error ? err.message : "选择类目失败");
    } finally {
      setLoading(false);
    }
  }

  async function applyFieldChoice(fieldKey: string, selectedSource: "raw" | "ai" | "manual", manualValue?: string): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/product-tasks/${task.id}/field-choice`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          field_key: fieldKey,
          selected_source: selectedSource,
          manual_value: manualValue,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await refreshAfterMutation();
    } catch (err) {
      setError(err instanceof Error ? err.message : "应用字段选择失败");
    } finally {
      setLoading(false);
    }
  }

  const titlePackageSummary = task.ai?.title_package as
    | {
        category_search_keywords?: unknown[];
      }
    | null
    | undefined;
  const titleCategoryKeywords = ((titlePackageSummary?.category_search_keywords as unknown[]) || [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  const categoryCandidates =
    task.ai?.category_candidates?.length ? task.ai.category_candidates : ((task.category_candidates_json as { path: string; score?: number | null }[]) || []);
  const preferredCategoryPaths = [
    ...(task.ai?.category_top3 || []).map((candidate) => candidate.path),
    ...categoryCandidates.map((candidate) => candidate.path),
    task.selected_category_id || "",
    task.ai?.category_best_path || "",
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-[18px] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
      ) : null}

      <Section title="字段对照">
        <div className="grid gap-4 xl:grid-cols-3">
          <CompareCard
            title="原始采集"
            tone="raw"
            items={[
              { label: "中文标题", value: raw?.title || task.title || "-" },
              { label: "平台", value: raw?.platform || task.product_platform || "-" },
              { label: "SKU", value: raw?.platform_sku || raw?.source_id || task.platform_sku || "-" },
              { label: "价格", value: raw?.price || "-" },
              { label: "链接", value: raw?.url || task.source_url || "-" },
            ]}
          />
          <CompareCard
            title="AI 生成"
            tone="ai"
            items={[
              { label: "中文标题", value: task.ai?.title_cn || "-" },
              { label: "英文标题", value: task.ai?.title_en || "-" },
              { label: "建议类目", value: task.ai?.category_best_path || "-" },
              {
                label: "类目检索词",
                value:
                  titleCategoryKeywords.join("\n") ||
                  categoryCandidates.map((item) => item.path).join("\n") ||
                  "-",
              },
            ]}
          />
          <CompareCard
            title="当前采用"
            tone="final"
            items={[
              { label: "中文标题", value: raw?.title || task.title || "-" },
              {
                label: "英文标题",
                value:
                  String((task.ai?.title_package as Record<string, unknown> | null)?.title_en || task.ai?.title_en || "-"),
              },
              { label: "采用类目", value: task.selected_category_id || task.ai?.category_best_path || "-" },
              { label: "主状态", value: statusText(task.main_status) },
              { label: "导出状态", value: statusText(task.export_status) },
              { label: "备注", value: task.notes || "-" },
            ]}
          />
        </div>
      </Section>

      <Section title="快捷操作">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void runProductInfo()}
            disabled={loading}
            className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
          >
            重跑商品理解
          </button>
          <button
            type="button"
            onClick={() => void regenerateTitles()}
            disabled={loading}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            重生成标题
          </button>
          {onRefresh ? (
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={loading}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              刷新详情
            </button>
          ) : null}
        </div>
      </Section>

      <Section title="类目候选">
        {categoryCandidates.length ? (
          <div className="space-y-3">
            {categoryCandidates.map((item) => {
              const active = (task.selected_category_id || task.ai?.category_best_path || "") === item.path;
              return (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => void selectCategory(item.path)}
                  disabled={loading}
                  className={[
                    "block w-full rounded-[16px] border px-4 py-3 text-left",
                    active
                      ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                      : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50",
                  ].join(" ")}
                >
                  <div className="text-sm font-medium">{item.path}</div>
                  <div className="mt-1 text-xs text-slate-500">检索分：{"score" in item ? item.score ?? "-" : "-"}</div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="text-sm text-slate-600">暂无类目候选</div>
        )}

        <div className="mt-4 rounded-[16px] border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs text-slate-500">手动类目</div>
          <SearchableCategoryInput
            value={manualCategory}
            onChange={setManualCategory}
            onSelect={setManualCategory}
            allOptions={categoryOptions}
            preferredPaths={preferredCategoryPaths}
            className="mt-2"
            minHeight={44}
            placeholder="输入完整类目路径"
          />
          <div className="mt-3">
            <button
              type="button"
              onClick={() => void applyFieldChoice("selected_category_id", "manual", manualCategory)}
              disabled={loading || !manualCategory.trim()}
              className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
            >
              保存手动类目
            </button>
          </div>
        </div>
      </Section>

      <Section title="标题采用">
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs text-slate-500">原英文标题（采集）</div>
            <div className="mt-1 text-sm text-slate-900">{raw?.title || task.title || "-"}</div>
            <div className="mt-3 text-xs text-slate-500">AI 中文标题（只读）</div>
            <div className="mt-1 text-sm text-slate-900">{task.ai?.title_cn || "-"}</div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void regenerateTitles()}
                disabled={loading}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                重生成标题
              </button>
            </div>
          </div>

          <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs text-slate-500">AI 英文标题（可修改）</div>
            <div className="mt-1 text-sm text-slate-900">{task.ai?.title_en || "-"}</div>
            <input
              value={manualTitle}
              onChange={(event) => setManualTitle(event.target.value)}
              className="mt-2 h-11 w-full rounded-[14px] border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
              placeholder={task.ai?.title_en || "输入最终英文标题"}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void applyFieldChoice("product_title_en", "ai")}
                disabled={loading || !task.ai?.title_en}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                采用 AI 英文标题
              </button>
              <button
                type="button"
                onClick={() => void applyFieldChoice("product_title_en", "manual", manualTitle)}
                disabled={loading || !manualTitle.trim()}
                className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
              >
                保存英文标题
              </button>
            </div>
          </div>
        </div>
      </Section>

      <Section title="任务状态">
        <div className="grid gap-2 text-sm text-slate-700 md:grid-cols-3">
          <div>
            <div className="text-xs text-slate-500">主状态</div>
            <div className="mt-1">{statusText(task.main_status)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">类目状态</div>
            <div className="mt-1">{statusText(task.category_status)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">导出状态</div>
            <div className="mt-1">{statusText(task.export_status)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">图片提示词状态</div>
            <div className="mt-1">{statusText(task.image_prompt_status)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">生成模式</div>
            <div className="mt-1">{getGenerationModeLabel(task.generation_mode)}</div>
          </div>
        </div>
      </Section>

      <Section title="AI 理解">
        {task.ai ? (
          <div className="space-y-3 text-sm text-slate-700">
            <div>
              <div className="text-xs text-slate-500">中文标题</div>
              <div className="mt-1">{task.ai.title_cn || "-"}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">英文标题</div>
              <div className="mt-1">{task.ai.title_en || "-"}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">标题包</div>
              <pre className="mt-1 overflow-auto rounded-[14px] border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                {task.ai.title_package ? JSON.stringify(task.ai.title_package, null, 2) : "-"}
              </pre>
            </div>
            <div>
              <div className="text-xs text-slate-500">图片提示词包</div>
              <pre className="mt-1 overflow-auto rounded-[14px] border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                {task.ai.image_prompt_package ? JSON.stringify(task.ai.image_prompt_package, null, 2) : "-"}
              </pre>
            </div>
            <div>
              <div className="text-xs text-slate-500">Product Info</div>
              <pre className="mt-1 overflow-auto rounded-[14px] border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                {task.ai.product_info ? JSON.stringify(task.ai.product_info, null, 2) : "-"}
              </pre>
            </div>
          </div>
        ) : (
          <div className="text-sm text-slate-600">暂无 AI 结果</div>
        )}
      </Section>

      {isLogsRoute ? (
        <Section title="AI 调用日志 / 排查">
          {timeline?.events?.filter((event) => String(event.stage).startsWith("ai.")).length ? (
            <div className="space-y-4">
              {timeline.events
                .filter((event) => String(event.stage).startsWith("ai."))
                .map((event) => (
                  <div key={`${event.stage}-${event.ts || "na"}`} className="rounded-[16px] border border-slate-200 bg-white p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-medium text-slate-900">{event.title}</div>
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <span>{formatDateTime(event.ts)}</span>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">{statusText(event.status)}</span>
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{event.message}</div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">stage: {event.stage}</span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">model: {String(event.meta?.model || "-")}</span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">耗时: {String(event.meta?.duration_ms || 0)}ms</span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">prompt: {String(event.meta?.prompt_type || "-")}</span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">
                        模板: #{String((event.meta?.prompt_template as Record<string, unknown> | undefined)?.template_id || "-")}
                      </span>
                    </div>
                    {!!event.meta?.error && (
                      <div className="mt-2 rounded-[12px] border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
                        {String(event.meta.error)}
                      </div>
                    )}
                    <div className="mt-3 grid gap-3 xl:grid-cols-3">
                      <div>
                        <div className="text-xs text-slate-500">输入</div>
                        <pre className="mt-1 overflow-auto rounded-[14px] border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                          {formatJson(event.meta?.input)}
                        </pre>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500">提示词</div>
                        <pre className="mt-1 overflow-auto rounded-[14px] border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                          {typeof event.meta?.prompt === "string" && event.meta.prompt ? event.meta.prompt : "-"}
                        </pre>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500">输出</div>
                        <pre className="mt-1 overflow-auto rounded-[14px] border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                          {formatJson(event.meta?.output)}
                        </pre>
                      </div>
                    </div>
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => void copyTraceEvent(event)}
                        className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                      >
                        复制本步骤日志
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <div className="text-sm text-slate-600">暂无 AI 调用日志</div>
          )}
        </Section>
      ) : null}
    </div>
  );
}
