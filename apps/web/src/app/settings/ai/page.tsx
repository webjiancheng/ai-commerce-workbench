"use client";

import { apiBaseUrl } from "@/lib/api";
import Link from "next/link";
import {
  AiPurpose,
  AiProviderCapability,
  LocalAiProvider,
  deleteLocalAiProvider,
  ensureDefaultAiRoutes,
  loadLocalAiProviders,
  loadLocalAiRoutes,
  setLocalAiRoute,
  upsertLocalAiProvider,
} from "@/lib/local-settings";
import { useEffect, useMemo, useState } from "react";

function newId(): string {
  return `p_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

const PURPOSE_LABEL: Record<AiPurpose, string> = {
  title: "标题生成",
  image_generate: "通用生图",
  image_4grid: "4宫格生图",
};

const PURPOSE_GROUPS: Array<{ title: string; purposes: AiPurpose[] }> = [
  { title: "文案能力", purposes: ["title"] },
  { title: "图片能力", purposes: ["image_generate", "image_4grid"] },
];

const RECOMMENDED_COMBOS = [
  "稳妥方案：标题走 DeepSeek / Qwen，生图走 OpenAI。",
  "质量优先：标题和生图都走 OpenAI，配置最省事。",
  "统一网关方案：如果你有聚合网关，就把标题模型和生图模型统一挂到一个出口。",
];

type TestResult = { ok: boolean; detail?: string; models?: string[] };

type ProviderPreset = {
  name: string;
  baseUrl: string;
  capabilities: AiProviderCapability[];
  models: string[];
  keyUrl: string;
};

const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    name: "豆包（文案）",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    capabilities: ["text"],
    models: ["doubao-seed-1-6-flash", "doubao-seed-1-6"],
    keyUrl: "https://console.volcengine.com/ark",
  },
  {
    name: "DeepSeek（文案）",
    baseUrl: "https://api.deepseek.com/v1",
    capabilities: ["text"],
    models: ["deepseek-chat", "deepseek-reasoner"],
    keyUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    name: "通义千问（文案）",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    capabilities: ["text"],
    models: ["qwen-plus", "qwen-max", "qwen-turbo"],
    keyUrl: "https://bailian.console.aliyun.com/",
  },
  {
    name: "OpenAI（文案+生图）",
    baseUrl: "https://api.openai.com/v1",
    capabilities: ["text", "image"],
    models: ["gpt-5", "gpt-4.1-mini", "gpt-image-1"],
    keyUrl: "https://platform.openai.com/api-keys",
  },
];

export default function AiSettingsWizardPage() {
  const [providers, setProviders] = useState<LocalAiProvider[]>([]);
  const [routes, setRoutes] = useState(() => loadLocalAiRoutes());

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(() => providers.find((p) => p.id === selectedId) || null, [providers, selectedId]);

  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const selectedKeyPreset =
    (selected
      ? PROVIDER_PRESETS.find(
          (preset) =>
            selected.baseUrl === preset.baseUrl || selected.name.includes(preset.name.split("（")[0]),
        )
      : null) || null;

  useEffect(() => {
    ensureDefaultAiRoutes();
    const items = loadLocalAiProviders();
    setProviders(items);
    setRoutes(loadLocalAiRoutes());
    if (!selectedId && items[0]?.id) setSelectedId(items[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function refresh(): void {
    const items = loadLocalAiProviders();
    setProviders(items);
    setRoutes(loadLocalAiRoutes());
  }

  function startAdd(): void {
    const id = newId();
    const created: LocalAiProvider = {
      id,
      name: "新建接口（OpenAI 兼容）",
      type: "openai_compatible",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      capabilities: ["text"],
      models: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    upsertLocalAiProvider(created);
    refresh();
    setSelectedId(id);
    setTestResult(null);
  }

  function addFromPreset(preset: ProviderPreset): void {
    const id = newId();
    const created: LocalAiProvider = {
      id,
      name: preset.name,
      type: "openai_compatible",
      baseUrl: preset.baseUrl,
      apiKey: "",
      capabilities: preset.capabilities,
      models: preset.models,
      testStatus: "unknown",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    upsertLocalAiProvider(created);
    refresh();
    setSelectedId(id);
    setTestResult(null);
  }

  async function testConnection(p: LocalAiProvider): Promise<void> {
    setTestResult(null);
    setTesting(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/ai/test-openai-compatible`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ base_url: p.baseUrl, api_key: p.apiKey }),
      });
      const json = (await res.json()) as { ok?: boolean; detail?: string; models?: string[] };
      if (!res.ok || !json?.ok) {
        upsertLocalAiProvider({
          ...p,
          testStatus: "failed",
          testedAt: new Date().toISOString(),
          testDetail: json?.detail || `HTTP ${res.status}`,
        });
        refresh();
        setTestResult({ ok: false, detail: json?.detail || `HTTP ${res.status}` });
        return;
      }
      upsertLocalAiProvider({
        ...p,
        testStatus: "success",
        testedAt: new Date().toISOString(),
        testDetail: "",
      });
      refresh();
      setTestResult({ ok: true, models: Array.isArray(json.models) ? json.models : [] });
    } catch (err) {
      upsertLocalAiProvider({
        ...p,
        testStatus: "failed",
        testedAt: new Date().toISOString(),
        testDetail: err instanceof Error ? err.message : "测试失败",
      });
      refresh();
      setTestResult({ ok: false, detail: err instanceof Error ? err.message : "测试失败" });
    } finally {
      setTesting(false);
    }
  }

  function updateSelected(patch: Partial<LocalAiProvider>): void {
    if (!selected) return;
    const baseChanged = typeof patch.baseUrl === "string" && patch.baseUrl !== selected.baseUrl;
    const keyChanged = typeof patch.apiKey === "string" && patch.apiKey !== selected.apiKey;
    upsertLocalAiProvider({
      ...selected,
      ...patch,
      ...(baseChanged || keyChanged
        ? { testStatus: "unknown", testedAt: undefined, testDetail: "接口地址或密钥已修改，请重新测试连接" }
        : {}),
    });
    refresh();
    setTestResult(null);
  }

  return (
    <div className="min-h-screen px-4 py-6 md:px-6">
      <section className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-[28px] border border-[var(--card-border)] bg-[var(--card)] p-6 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm text-slate-500">运营可读 · 三步搞定</div>
              <h1 className="mt-1 text-3xl font-semibold">AI 配置向导</h1>
              <div className="mt-2 text-sm text-slate-600">
                先添加接口（可多个），再把“标题生成 / 通用生图 / 4宫格生图”分配给对应模型。
              </div>
            </div>
            <Link
              href="/settings/ai/guide"
              className="h-10 rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50 inline-flex items-center"
            >
              查看详细教程
            </Link>
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <div className="rounded-[24px] border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-slate-900">1）接口列表</div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={startAdd}
                  className="h-10 rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50"
                >
                  新增接口
                </button>
              </div>
            </div>
            <div className="mt-3 rounded-[14px] border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-semibold text-slate-700">常用模型模板（Key 需你自己填）</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {PROVIDER_PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => addFromPreset(preset)}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                    title={`一键新增：${preset.name}`}
                  >
                    + {preset.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {providers.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(p.id);
                    setTestResult(null);
                  }}
                  className={[
                    "w-full rounded-[18px] border px-4 py-3 text-left",
                    selectedId === p.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white",
                  ].join(" ")}
                >
                  <div className="text-sm font-semibold">{p.name}</div>
                  <div className="mt-1 break-all text-xs opacity-80">{p.baseUrl || "未填写 Base URL"}</div>
                  <div className="mt-2 text-[11px] opacity-80">
                    {p.testStatus === "success"
                      ? "连接状态：连接成功"
                      : p.testStatus === "failed"
                        ? "连接状态：连接失败"
                        : "连接状态：未测试"}
                  </div>
                </button>
              ))}
              {!providers.length ? <div className="text-sm text-slate-600">还没有接口，先点“新增接口”。</div> : null}
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-6">
            <div className="text-sm font-semibold text-slate-900">2）编辑接口（选中左侧一项）</div>
            {!selected ? (
              <div className="mt-3 text-sm text-slate-600">请选择一个接口开始配置</div>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1">
                    <div className="text-xs text-slate-500">名称（你自己看得懂就行）</div>
                    <input
                      value={selected.name}
                      onChange={(e) => updateSelected({ name: e.target.value })}
                      className="h-11 w-full rounded-[16px] border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
                      placeholder="例如：豆包-标题 / OpenAI-生图 / OpenAI-四宫格"
                    />
                  </label>
                  <label className="space-y-1">
                    <div className="text-xs text-slate-500">接口地址 Base URL（OpenAI 兼容）</div>
                    <input
                      value={selected.baseUrl}
                      onChange={(e) => updateSelected({ baseUrl: e.target.value })}
                      className="h-11 w-full rounded-[16px] border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
                      placeholder="例如：https://api.openai.com/v1"
                    />
                  </label>
                </div>

                <label className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>API Key（当前向导仍保存在本机浏览器）</span>
                    <span className="text-[11px] text-slate-400">生产默认文本模型请改到服务端“供应商配置”里</span>
                  </div>
                  <input
                    type="password"
                    value={selected.apiKey}
                    onChange={(e) => updateSelected({ apiKey: e.target.value })}
                    className="h-11 w-full rounded-[16px] border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
                    placeholder="sk-..."
                  />
                  <div className="grid gap-2 pt-1 md:grid-cols-[1fr_auto]">
                    <div className="h-9 w-full rounded-[12px] border border-slate-200 bg-slate-50 px-3 text-xs text-slate-600 inline-flex items-center">
                      {selectedKeyPreset
                        ? `已识别平台：${selectedKeyPreset.name.split("（")[0]}`
                        : "未识别平台：请确认名称或 Base URL"}
                    </div>
                    {selectedKeyPreset ? (
                      <a
                        href={selectedKeyPreset.keyUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="h-9 rounded-[12px] border border-slate-200 bg-white px-3 text-xs text-slate-700 hover:bg-slate-50 inline-flex items-center"
                      >
                        打开 {selectedKeyPreset.name.split("（")[0]} 官方 Key 页面
                      </a>
                    ) : (
                      <span className="h-9 rounded-[12px] border border-slate-200 bg-white px-3 text-xs text-slate-400 inline-flex items-center">
                        暂无匹配 Key 链接
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    先在平台创建 Key，再粘贴到上面输入框并点“测试连接”。
                  </div>
                </label>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-xs text-slate-500">支持能力</div>
                    <div className="mt-2 flex flex-wrap gap-3 text-sm text-slate-700">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selected.capabilities.includes("text")}
                          onChange={(e) => {
                            const next: AiProviderCapability[] = e.target.checked
                              ? Array.from(new Set([...selected.capabilities, "text"]))
                              : selected.capabilities.filter((x) => x !== "text");
                            updateSelected({ capabilities: next });
                          }}
                        />
                        文本
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selected.capabilities.includes("image")}
                          onChange={(e) => {
                            const next: AiProviderCapability[] = e.target.checked
                              ? Array.from(new Set([...selected.capabilities, "image"]))
                              : selected.capabilities.filter((x) => x !== "image");
                            updateSelected({ capabilities: next });
                          }}
                        />
                        图片
                      </label>
                    </div>
                    <div className="mt-2 text-[11px] text-slate-500">用途分配时会按能力过滤，避免选错。</div>
                  </div>
                  <label className="space-y-1">
                    <div className="text-xs text-slate-500">常用模型（可选，逗号分隔）</div>
                    <input
                      value={selected.models.join(", ")}
                      onChange={(e) =>
                        updateSelected({
                          models: e.target.value
                            .split(",")
                            .map((x) => x.trim())
                            .filter(Boolean),
                        })
                      }
                      className="h-11 w-full rounded-[16px] border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
                      placeholder="例如：gpt-4o-mini, gpt-image-1, doubao-seed-1"
                    />
                    <div className="text-[11px] text-slate-500">如果留空，也可以在“用途分配”里手填模型名。</div>
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void testConnection(selected)}
                    className="h-11 rounded-full border border-slate-900 bg-slate-900 px-5 text-sm font-medium text-white hover:bg-slate-800"
                    disabled={testing || !selected.baseUrl.trim() || !selected.apiKey.trim()}
                  >
                    {testing ? "测试中..." : "测试连接"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!selected) return;
                      if (!confirm(`确认删除接口：${selected.name}？`)) return;
                      deleteLocalAiProvider(selected.id);
                      refresh();
                      setSelectedId(loadLocalAiProviders()[0]?.id || null);
                      setTestResult(null);
                    }}
                    className="h-11 rounded-full border border-slate-200 bg-white px-5 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    删除
                  </button>
                  {testResult ? (
                    <span
                      className={[
                        "rounded-full border px-3 py-2 text-xs",
                        testResult.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-700",
                      ].join(" ")}
                    >
                      {testResult.ok ? `连接成功${testResult.models?.length ? `（发现 ${testResult.models.length} 个模型）` : ""}` : `失败：${testResult.detail || "unknown"}`}
                    </span>
                  ) : null}
                </div>

                {testResult?.ok && testResult.models?.length ? (
                  <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold text-slate-700">可用模型（截取前 12 个）</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {testResult.models.slice(0, 12).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => {
                            const next = Array.from(new Set([m, ...selected.models]));
                            updateSelected({ models: next });
                          }}
                          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                          title="点一下加入“常用模型”"
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                    <div className="mt-2 text-[11px] text-slate-500">点模型标签可加入“常用模型”。</div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-white p-6">
          <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-semibold text-slate-700">官方 API Key 配置入口</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {PROVIDER_PRESETS.map((preset) => (
                <a
                  key={`${preset.name}-${preset.keyUrl}`}
                  href={preset.keyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                >
                  {preset.name.split("（")[0]} Key
                </a>
              ))}
            </div>
          </div>

          <div className="text-sm font-semibold text-slate-900">3）用途分配（按现有流程保留必要项）</div>
          <div className="mt-2 text-sm text-slate-600">
            这里只保留当前系统真正会走到的用途：标题生成、通用生图、4宫格生图。没接入流程的用途先不展示，避免误配。
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {PURPOSE_GROUPS.map((group) => (
              <div key={group.title} className="rounded-[20px] border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold text-slate-700">{group.title}</div>
                <div className="mt-3 space-y-3">
                  {group.purposes.map((purpose) => {
                    const current = routes.find((r) => r.purpose === purpose) || null;
                    const requiredCapability: AiProviderCapability = group.title === "图片能力" ? "image" : "text";
                    const selectableProviders = providers.filter(
                      (p) => p.capabilities.includes(requiredCapability) && p.testStatus === "success",
                    );
                    const selectedProvider = current ? providers.find((p) => p.id === current.providerId) : null;
                    const modelOptions = selectedProvider?.models || [];

                    return (
                      <div key={purpose} className="grid gap-2 md:grid-cols-[140px_1fr_1fr] items-center">
                        <div className="text-sm text-slate-700">{PURPOSE_LABEL[purpose]}</div>
                        <select
                          value={current?.providerId || ""}
                          onChange={(e) => {
                            const providerId = e.target.value;
                            const provider = providers.find((p) => p.id === providerId);
                            const model = provider?.models?.[0] || "";
                            if (!providerId) return;
                            setLocalAiRoute({ purpose, providerId, model });
                            refresh();
                          }}
                          className="h-10 w-full rounded-[14px] border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                        >
                          <option value="">选择接口</option>
                          {selectableProviders.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                        {current?.providerId && selectedProvider?.testStatus !== "success" ? (
                          <div className="md:col-start-2 text-xs text-rose-600">该接口未测试成功，不能用于此用途，请先修复并测试通过。</div>
                        ) : null}
                        <input
                          value={current?.model || ""}
                          onChange={(e) => {
                            if (!current?.providerId) return;
                            setLocalAiRoute({ ...current, model: e.target.value });
                            refresh();
                          }}
                          list={`models-${purpose}`}
                          className="h-10 w-full rounded-[14px] border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                          placeholder="模型名（可手填）"
                        />
                        <datalist id={`models-${purpose}`}>
                          {modelOptions.map((m) => (
                            <option key={m} value={m} />
                          ))}
                        </datalist>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 text-[11px] text-slate-500">
            提示：接口类型先统一按“OpenAI 兼容”落地（豆包/DeepSeek/自建网关一般都能兼容）。后续如果要做“供应商专用配置”，再在这里扩展类型即可。
          </div>

          <div className="mt-4 rounded-[18px] border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-semibold text-slate-700">推荐分配方式</div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {RECOMMENDED_COMBOS.map((item) => (
                <div
                  key={item}
                  className="rounded-[14px] border border-slate-200 bg-white px-3 py-2 text-xs leading-6 text-slate-600"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
