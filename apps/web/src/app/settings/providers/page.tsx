"use client";

import { apiBaseUrl } from "@/lib/api";
import { useEffect, useMemo, useState } from "react";

type ProviderConfig = {
  id: number;
  provider_type: string;
  provider_name: string;
  display_name: string;
  enabled: boolean;
  is_default: boolean;
  config_json: Record<string, unknown>;
  capabilities_json: Record<string, unknown>;
  pricing_json: Record<string, unknown>;
  api_key_configured: boolean;
  masked_key: string | null;
  updated_at: string;
};

function safeJsonParse(text: string): Record<string, unknown> | null {
  try {
    const obj = JSON.parse(text);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    return obj as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readStringValue(source: Record<string, unknown>, key: string, fallback = ""): string {
  const value = source[key];
  return typeof value === "string" ? value : fallback;
}

function readNumberValue(source: Record<string, unknown>, key: string, fallback = ""): string {
  const value = source[key];
  return typeof value === "number" ? String(value) : fallback;
}

export default function ProviderSettingsPage() {
  const [items, setItems] = useState<ProviderConfig[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [selected, setSelected] = useState<ProviderConfig | null>(null);
  const [configText, setConfigText] = useState("{}");
  const [pricingText, setPricingText] = useState("{}");
  const [apiKey, setApiKey] = useState("");

  const configErr = useMemo(() => (safeJsonParse(configText) ? null : "config_json 不是合法 JSON 对象"), [configText]);
  const pricingErr = useMemo(
    () => (safeJsonParse(pricingText) ? null : "pricing_json 不是合法 JSON 对象"),
    [pricingText],
  );

  async function load(): Promise<void> {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/provider-configs`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ProviderConfig[];
      setItems(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function pick(p: ProviderConfig): void {
    setSelected(p);
    setConfigText(JSON.stringify(p.config_json || {}, null, 2));
    setPricingText(JSON.stringify(p.pricing_json || {}, null, 2));
    setApiKey("");
  }

  async function save(): Promise<void> {
    if (!selected) return;
    setError(null);
    if (configErr) return setError(configErr);
    if (pricingErr) return setError(pricingErr);
    setLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/provider-configs/${selected.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled: selected.enabled,
          is_default: selected.is_default,
          display_name: selected.display_name,
          config_json: selected.config_json,
          pricing_json: selected.pricing_json,
          api_key: apiKey.trim() ? apiKey.trim() : undefined,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setLoading(false);
    }
  }

  async function setDefault(): Promise<void> {
    if (!selected) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/provider-configs/${selected.id}/set-default`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "设置默认失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen px-4 py-6 md:px-6">
      <section className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-[28px] border border-[var(--card-border)] bg-[var(--card)] p-6 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="text-sm text-slate-500">系统设置 / AI 与存储配置</div>
          <h1 className="mt-1 text-3xl font-semibold">模型与接口配置</h1>
          <div className="mt-2 text-sm text-slate-600">优先把常用项做成表单，底部仍保留高级 JSON 配置区。</div>
        </header>

        {error ? (
          <div className="rounded-[18px] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
          <div className="rounded-[24px] border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-900">配置列表</div>
              <button
                type="button"
                onClick={() => void load()}
                className="h-10 rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50"
              >
                刷新
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {items.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => pick(p)}
                  className={[
                    "w-full rounded-[18px] border px-4 py-3 text-left",
                    selected?.id === p.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white",
                  ].join(" ")}
                >
                  <div className="text-sm font-semibold">
                    {p.display_name} <span className="text-xs opacity-80">（{p.provider_type}:{p.provider_name}）</span>
                  </div>
                  <div className="mt-1 text-xs opacity-80">
                    {p.enabled ? "启用中" : "已停用"} · {p.is_default ? "默认" : "非默认"} ·{" "}
                    {p.api_key_configured ? `密钥 ${p.masked_key}` : "未配置密钥"}
                  </div>
                </button>
              ))}
              {items.length ? null : <div className="text-sm text-slate-600">暂无配置</div>}
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-6">
            <div className="text-sm font-semibold text-slate-900">编辑配置</div>
            {!selected ? (
              <div className="mt-3 text-sm text-slate-600">请选择左侧一项配置开始编辑</div>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  当前类型：{selected.provider_type === "image" ? "生图模型" : selected.provider_type === "text" ? "文本模型" : selected.provider_type === "storage" ? "存储方式" : selected.provider_type}
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1">
                    <div className="text-xs text-slate-500">显示名称</div>
                    <input
                      value={selected.display_name}
                      onChange={(e) => setSelected({ ...selected, display_name: e.target.value })}
                      className="h-11 w-full rounded-[16px] border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
                    />
                  </label>
                  <div className="flex items-end gap-3">
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={selected.enabled}
                        onChange={(e) => setSelected({ ...selected, enabled: e.target.checked })}
                      />
                      启用
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={selected.is_default}
                        onChange={(e) => setSelected({ ...selected, is_default: e.target.checked })}
                      />
                      设为默认
                    </label>
                    <button
                      type="button"
                      onClick={() => void setDefault()}
                      className="h-11 rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50"
                      disabled={loading}
                    >
                      设为默认
                    </button>
                  </div>
                </div>

                {selected.provider_type === "image" || selected.provider_type === "text" ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="space-y-1">
                      <div className="text-xs text-slate-500">接口地址 Base URL</div>
                      <input
                        value={readStringValue(selected.config_json, "base_url")}
                        onChange={(e) =>
                          setSelected({
                            ...selected,
                            config_json: { ...selected.config_json, base_url: e.target.value },
                          })
                        }
                        className="h-11 w-full rounded-[16px] border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
                        placeholder="可选，例如 https://api.openai.com/v1"
                      />
                    </label>
                    <label className="space-y-1">
                      <div className="text-xs text-slate-500">
                        {selected.provider_type === "image" ? "默认生图模型" : "默认文本模型"}
                      </div>
                      <input
                        value={readStringValue(selected.config_json, "default_model")}
                        onChange={(e) =>
                          setSelected({
                            ...selected,
                            config_json: { ...selected.config_json, default_model: e.target.value },
                          })
                        }
                        className="h-11 w-full rounded-[16px] border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
                        placeholder={selected.provider_type === "image" ? "例如 gpt-image-1" : "例如 gpt-4.1-mini"}
                      />
                    </label>
                    {selected.provider_type === "image" ? (
                      <>
                        <label className="space-y-1">
                          <div className="text-xs text-slate-500">默认出图尺寸</div>
                          <input
                            value={readStringValue(selected.config_json, "default_size", "1024x1024")}
                            onChange={(e) =>
                              setSelected({
                                ...selected,
                                config_json: { ...selected.config_json, default_size: e.target.value },
                              })
                            }
                            className="h-11 w-full rounded-[16px] border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
                            placeholder="例如 1024x1024"
                          />
                        </label>
                        <label className="space-y-1">
                          <div className="text-xs text-slate-500">单张预估成本</div>
                          <input
                            value={readNumberValue(selected.pricing_json, "estimated_cost_per_image")}
                            onChange={(e) =>
                              setSelected({
                                ...selected,
                                pricing_json: {
                                  ...selected.pricing_json,
                                  estimated_cost_per_image: e.target.value ? Number(e.target.value) : 0,
                                },
                              })
                            }
                            className="h-11 w-full rounded-[16px] border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
                            placeholder="例如 0.04"
                            type="number"
                            step="0.0001"
                          />
                        </label>
                      </>
                    ) : null}
                  </div>
                ) : null}

                <label className="space-y-1">
                  <div className="text-xs text-slate-500">接口密钥（只写入，不回显）</div>
                  <input
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="h-11 w-full rounded-[16px] border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
                    placeholder={selected.api_key_configured ? "已配置，如需更新可重新输入" : "未配置"}
                  />
                </label>

                <label className="space-y-1">
                  <div className="text-xs text-slate-500">
                    高级配置 JSON {configErr ? <span className="ml-2 text-rose-600">{configErr}</span> : null}
                  </div>
                  <textarea
                    value={JSON.stringify(selected.config_json || {}, null, 2)}
                    onChange={(e) => {
                      setConfigText(e.target.value);
                      const parsed = safeJsonParse(e.target.value);
                      if (parsed) {
                        setSelected({ ...selected, config_json: parsed });
                      }
                    }}
                    className="h-[200px] w-full resize-none rounded-[18px] border border-slate-200 bg-white p-3 text-xs font-mono outline-none focus:border-slate-400"
                  />
                </label>

                <label className="space-y-1">
                  <div className="text-xs text-slate-500">
                    费用配置 JSON {pricingErr ? <span className="ml-2 text-rose-600">{pricingErr}</span> : null}
                  </div>
                  <textarea
                    value={JSON.stringify(selected.pricing_json || {}, null, 2)}
                    onChange={(e) => {
                      setPricingText(e.target.value);
                      const parsed = safeJsonParse(e.target.value);
                      if (parsed) {
                        setSelected({ ...selected, pricing_json: parsed });
                      }
                    }}
                    className="h-[160px] w-full resize-none rounded-[18px] border border-slate-200 bg-white p-3 text-xs font-mono outline-none focus:border-slate-400"
                  />
                </label>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void save()}
                    className="h-11 rounded-full bg-slate-900 px-5 text-sm font-medium text-white hover:bg-slate-800"
                    disabled={loading || !!configErr || !!pricingErr}
                  >
                    保存
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
