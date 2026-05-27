"use client";

import { apiBaseUrl } from "@/lib/api";
import type { PromptEditorConfig } from "@/features/product-tasks/types";
import { useEffect, useState } from "react";

export function PromptEditorModal({
  config,
  onClose,
  onRerunPrompt,
}: {
  config: PromptEditorConfig | null;
  onClose: () => void;
  onRerunPrompt: (taskIds: number[], promptType: string) => Promise<void>;
}) {
  const [selectedType, setSelectedType] = useState("");
  const [overrideText, setOverrideText] = useState("");
  const [resolved, setResolved] = useState<Record<string, { id: number; scope: string; version: number }>>({});
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!config) return;
    const activeConfig = config;
    const initialType = activeConfig.promptTypes[0] || "";
    setSelectedType(initialType);
    setNotice(null);
    setError(null);

    async function loadResolvedPrompt() {
      setLoading(true);
      try {
        const nextResolved: Record<string, { id: number; scope: string; version: number }> = {};
        for (const type of activeConfig.promptTypes) {
          const res = await fetch(
            `${apiBaseUrl}/api/prompt-templates/resolve?prompt_type=${encodeURIComponent(type)}&task_id=${activeConfig.taskIds[0]}`,
            { cache: "no-store" },
          );
          if (!res.ok) continue;
          const item = (await res.json()) as { id: number; scope: string; version: number; template_text: string };
          nextResolved[type] = { id: item.id, scope: item.scope, version: item.version };
          if (type === initialType) setOverrideText(item.template_text);
        }
        setResolved(nextResolved);
      } catch (err) {
        setError(err instanceof Error ? err.message : "加载提示词失败");
      } finally {
        setLoading(false);
      }
    }

    void loadResolvedPrompt();
  }, [config]);

  async function changeType(nextType: string) {
    if (!config) return;
    setSelectedType(nextType);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch(
        `${apiBaseUrl}/api/prompt-templates/resolve?prompt_type=${encodeURIComponent(nextType)}&task_id=${config.taskIds[0]}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const item = (await res.json()) as { id: number; scope: string; template_text: string; version: number };
      setOverrideText(item.template_text);
      setResolved((prev) => ({ ...prev, [nextType]: { id: item.id, scope: item.scope, version: item.version } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "切换提示词失败");
    }
  }

  async function saveOverride() {
    if (!config || !selectedType || !overrideText.trim()) return;
    setLoading(true);
    setNotice(null);
    setError(null);
    try {
      for (const taskId of config.taskIds) {
        const resolvedRes = await fetch(
          `${apiBaseUrl}/api/prompt-templates/resolve?prompt_type=${encodeURIComponent(selectedType)}&task_id=${taskId}`,
          { cache: "no-store" },
        );
        let existingTaskOverrideId: number | null = null;
        if (resolvedRes.ok) {
          const existing = (await resolvedRes.json()) as { id: number; scope: string };
          if (existing.scope === "task") existingTaskOverrideId = existing.id;
        }

        if (existingTaskOverrideId) {
          await fetch(`${apiBaseUrl}/api/prompt-templates/${existingTaskOverrideId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ template_text: overrideText, enabled: true }),
          }).then(async (res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
          });
        } else {
          await fetch(`${apiBaseUrl}/api/prompt-templates`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: `${selectedType} (task#${taskId})`,
              prompt_type: selectedType,
              scope: "task",
              category_id: null,
              task_id: taskId,
              template_text: overrideText,
              variables_json: {},
              version: 1,
              enabled: true,
            }),
          }).then(async (res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
          });
        }
      }
      setNotice(`已保存并应用到 ${config.taskIds.length} 个任务。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存提示词失败");
    } finally {
      setLoading(false);
    }
  }

  async function restoreDefault() {
    if (!config || !selectedType) return;
    setLoading(true);
    setNotice(null);
    setError(null);
    try {
      for (const taskId of config.taskIds) {
        const resolvedRes = await fetch(
          `${apiBaseUrl}/api/prompt-templates/resolve?prompt_type=${encodeURIComponent(selectedType)}&task_id=${taskId}`,
          { cache: "no-store" },
        );
        if (!resolvedRes.ok) continue;
        const existing = (await resolvedRes.json()) as { id: number; scope: string };
        if (existing.scope !== "task") continue;
        await fetch(`${apiBaseUrl}/api/prompt-templates/${existing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: false }),
        }).then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        });
      }
      setNotice("已恢复默认提示词。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "恢复默认失败");
    } finally {
      setLoading(false);
    }
  }

  async function rerunPrompt() {
    if (!config || !selectedType) return;
    setLoading(true);
    setNotice(null);
    setError(null);
    try {
      await onRerunPrompt(config.taskIds, selectedType);
      setNotice(`已触发 ${config.taskIds.length} 个任务重跑 ${selectedType}。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "重跑失败");
    } finally {
      setLoading(false);
    }
  }

  if (!config) return null;

  return (
    <div className="fixed inset-0 z-[110] bg-black/35 p-6" onClick={onClose}>
      <div
        className="mx-auto mt-8 max-w-5xl rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_30px_120px_rgba(15,23,42,0.22)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-slate-500">字段提示词</div>
            <div className="mt-1 text-xl font-semibold text-slate-900">{config.fieldLabel}</div>
            <div className="mt-1 text-xs text-slate-500">当前应用到 {config.taskIds.length} 个任务</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          >
            ×
          </button>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[280px_1fr]">
          <div className="space-y-2">
            {config.promptTypes.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => void changeType(type)}
                className={[
                  "block w-full rounded-[16px] border px-4 py-3 text-left",
                  selectedType === type ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white hover:bg-slate-50",
                ].join(" ")}
              >
                <div className="font-mono text-xs font-semibold text-slate-900">{type}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {resolved[type] ? `${resolved[type].scope} · v${resolved[type].version}` : "加载中"}
                </div>
              </button>
            ))}
          </div>

          <div>
            <textarea
              value={overrideText}
              onChange={(event) => setOverrideText(event.target.value)}
              className="h-[340px] w-full resize-none rounded-[18px] border border-slate-200 bg-white p-3 text-sm font-mono outline-none focus:border-slate-400"
              placeholder="编辑当前字段对应的提示词模板"
            />
            {error ? <div className="mt-2 text-sm text-rose-600">{error}</div> : null}
            {notice ? <div className="mt-2 text-sm text-emerald-700">{notice}</div> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void restoreDefault()}
                disabled={loading}
                className="h-10 rounded-full border border-slate-300 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                恢复默认
              </button>
              <button
                type="button"
                onClick={() => void saveOverride()}
                disabled={loading}
                className="h-10 rounded-full bg-slate-900 px-4 text-sm font-medium text-white disabled:opacity-50"
              >
                保存并应用
              </button>
              <button
                type="button"
                onClick={() => void rerunPrompt()}
                disabled={loading}
                className="h-10 rounded-full border border-slate-300 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                保存后重跑
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

