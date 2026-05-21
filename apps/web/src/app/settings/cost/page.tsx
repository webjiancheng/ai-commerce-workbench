"use client";

import { apiBaseUrl } from "@/lib/api";
import { useEffect, useMemo, useState } from "react";

export default function CostSettingsPage() {
  const [enabled, setEnabled] = useState(true);
  const [jsonText, setJsonText] = useState("{\n  \"limits\": {\n    \"daily_image_generation_limit\": 200,\n    \"task_regeneration_limit\": 20,\n    \"slot_regeneration_limit\": 8,\n    \"provider_daily_image_generation_limit\": 200\n  },\n  \"daily_budget\": null,\n  \"currency\": \"USD\"\n}");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const jsonErr = useMemo(() => {
    try {
      const obj = JSON.parse(jsonText);
      return obj && typeof obj === "object" && !Array.isArray(obj) ? null : "必须是 JSON 对象";
    } catch {
      return "不是合法 JSON";
    }
  }, [jsonText]);

  async function load(): Promise<void> {
    setError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/cost-configs`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { enabled: boolean; config_json: Record<string, unknown> };
      setEnabled(data.enabled);
      setJsonText(JSON.stringify(data.config_json || {}, null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(): Promise<void> {
    setError(null);
    if (jsonErr) return setError(jsonErr);
    setSaving(true);
    try {
      const payload = { enabled, config_json: JSON.parse(jsonText) as Record<string, unknown> };
      const res = await fetch(`${apiBaseUrl}/api/cost-configs`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen px-4 py-6 md:px-6">
      <section className="mx-auto max-w-4xl space-y-6">
        <header className="rounded-[28px] border border-[var(--card-border)] bg-[var(--card)] p-6 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="text-sm text-slate-500">系统设置 / 成本配置</div>
          <h1 className="mt-1 text-3xl font-semibold">成本配置</h1>
          <div className="mt-2 text-sm text-slate-600">用于阶段9限流/预算/估算读取</div>
        </header>

        {error ? (
          <div className="rounded-[18px] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="rounded-[24px] border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-900">配置</div>
            <button
              type="button"
              onClick={() => void load()}
              className="h-10 rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50"
            >
              刷新
            </button>
          </div>

          <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            enabled
          </label>

          <div className="mt-3 text-xs text-slate-500">
            {jsonErr ? <span className="text-rose-600">{jsonErr}</span> : "JSON 合法"}
          </div>
          <textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            className="mt-2 h-[360px] w-full resize-none rounded-[18px] border border-slate-200 bg-white p-3 text-xs font-mono outline-none focus:border-slate-400"
          />

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => void save()}
              className="h-11 rounded-full bg-slate-900 px-5 text-sm font-medium text-white hover:bg-slate-800"
              disabled={saving || !!jsonErr}
            >
              保存
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
