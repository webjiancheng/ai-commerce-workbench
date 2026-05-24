"use client";

import { apiBaseUrl } from "@/lib/api";
import { useEffect, useMemo, useState } from "react";

type PromptTemplate = {
  id: number;
  name: string;
  prompt_type: string;
  scope: string;
  category_id: string | null;
  task_id: number | null;
  template_text: string;
  variables_json: Record<string, unknown>;
  version: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

type PromptTemplateListResponse = {
  items: PromptTemplate[];
  total: number;
  limit: number;
  offset: number;
};

type RenderResponse = { rendered_text: string };

const PROMPT_TYPE_LABELS: Record<string, string> = {
  product_info_from_screenshot: "产品截图信息提取",
  title_package_lite: "轻量标题包",
  title_package: "标题包",
  title_en: "英文标题生成",
  title_en_only: "英文标题单独生成",
  image_prompt_main: "主图提示词",
  image_prompt_carousel_1: "轮播图1提示词",
  image_prompt_carousel_2: "轮播图2提示词",
  image_prompt_carousel_3: "轮播图3提示词",
  image_prompt_carousel_4: "轮播图4提示词",
  image_prompt_carousel_4grid: "四宫格提示词",
  image_prompt_dimension: "尺寸图提示词",
  dimension_extract_from_image: "尺寸图识别提示词",
};

const SCOPE_LABELS: Record<string, string> = {
  global: "全局",
  category: "类目",
  task: "单商品",
};

function buildQuery(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (!value) return;
    query.set(key, value);
  });
  const result = query.toString();
  return result ? `?${result}` : "";
}

function groupKey(item: Pick<PromptTemplate, "prompt_type" | "scope" | "category_id" | "task_id">): string {
  return [item.prompt_type, item.scope, item.category_id || "-", item.task_id || "-"].join("|");
}

function defaultTemplateTextByType(promptType: string): string {
  const preset: Record<string, string> = {
    title_en:
      "You are an English listing title assistant. Generate one accurate marketplace-ready English title, concise and factual, JSON only.",
    image_prompt_main:
      "生成电商主图提示词：同一商品本体、居中清晰、背景干净、无文字无水印无 Logo，不改变材质颜色结构。",
  };
  return `${preset[promptType] || "请根据该类型写出可直接执行的提示词模板，输出要求明确、字段清晰。"}\n`;
}

export default function PromptsPage() {
  const [promptTypes, setPromptTypes] = useState<string[]>([]);
  const [promptVariables, setPromptVariables] = useState<Record<string, { type: string; desc: string }>>(
    {},
  );

  const [filterPromptType, setFilterPromptType] = useState("");
  const [filterScope, setFilterScope] = useState("");
  const [filterCategoryId, setFilterCategoryId] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [list, setList] = useState<PromptTemplateListResponse>({
    items: [],
    total: 0,
    limit: 20,
    offset: 0,
  });

  const [selected, setSelected] = useState<PromptTemplate | null>(null);
  const [draftText, setDraftText] = useState("");
  const [draftEnabled, setDraftEnabled] = useState(true);
  const [draftName, setDraftName] = useState("");
  const [draftVersion, setDraftVersion] = useState(1);

  const [testVarsJson, setTestVarsJson] = useState("{\n  \"title\": \"\",\n  \"candidates\": []\n}");
  const [rendered, setRendered] = useState<string>("");
  const [renderError, setRenderError] = useState<string | null>(null);

  const visibleItems = useMemo(() => {
    const allowed = new Set(promptTypes);
    return list.items.filter((item) => allowed.has(item.prompt_type));
  }, [list.items, promptTypes]);

  const defaultIdByGroup = useMemo(() => {
    const byGroup = new Map<string, PromptTemplate[]>();
    for (const item of visibleItems) {
      if (!item.enabled) continue;
      const key = groupKey(item);
      const arr = byGroup.get(key) || [];
      arr.push(item);
      byGroup.set(key, arr);
    }
    const out = new Map<string, number>();
    for (const [key, arr] of byGroup.entries()) {
      arr.sort((a, b) => {
        if (b.version !== a.version) return b.version - a.version;
        const ta = new Date(a.updated_at).getTime();
        const tb = new Date(b.updated_at).getTime();
        if (tb !== ta) return tb - ta;
        return b.id - a.id;
      });
      out.set(key, arr[0].id);
    }
    return out;
  }, [visibleItems]);

  useEffect(() => {
    async function bootstrap() {
      try {
        const [typesRes, varsRes] = await Promise.all([
          fetch(`${apiBaseUrl}/api/system/prompt-types`, { cache: "no-store" }),
          fetch(`${apiBaseUrl}/api/system/prompt-variables`, { cache: "no-store" }),
        ]);

        if (!typesRes.ok) throw new Error(`提示词类型加载失败: HTTP ${typesRes.status}`);
        if (!varsRes.ok) throw new Error(`提示词变量加载失败: HTTP ${varsRes.status}`);

        const typesData = (await typesRes.json()) as { items: string[] };
        const varsData = (await varsRes.json()) as { items: Record<string, { type: string; desc: string }> };
        setPromptTypes(typesData.items || []);
        setPromptVariables(varsData.items || {});
      } catch (err) {
        setError(err instanceof Error ? err.message : "系统提示词配置接口请求失败");
      }
    }
    void bootstrap();
  }, []);

  const queryString = useMemo(() => {
    return buildQuery({
      limit: String(list.limit),
      offset: String(list.offset),
      prompt_type: filterPromptType || undefined,
      scope: filterScope || undefined,
      category_id: filterCategoryId.trim() ? filterCategoryId.trim() : undefined,
    });
  }, [filterPromptType, filterScope, filterCategoryId, list.limit, list.offset]);

  useEffect(() => {
    async function loadList() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${apiBaseUrl}/api/prompt-templates${queryString}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as PromptTemplateListResponse;
        setList(data);
        if (selected) {
          const updated = data.items.find((item) => item.id === selected.id) || null;
          setSelected(updated);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load prompt templates");
      } finally {
        setLoading(false);
      }
    }
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryString]);

  function selectItem(item: PromptTemplate) {
    setSelected(item);
    setDraftText(item.template_text);
    setDraftEnabled(item.enabled);
    setDraftName(item.name);
    setDraftVersion(item.version);
    setRendered("");
    setRenderError(null);
  }

  async function saveSelected() {
    if (!selected) return;
    const res = await fetch(`${apiBaseUrl}/api/prompt-templates/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: draftName,
        template_text: draftText,
        enabled: draftEnabled,
        version: draftVersion,
      }),
    });
    if (!res.ok) {
      alert(`保存失败: HTTP ${res.status}`);
      return;
    }
    const updated = (await res.json()) as PromptTemplate;
    setSelected(updated);
    setDraftText(updated.template_text);
    await refreshList();
  }

  async function refreshList() {
    const res = await fetch(`${apiBaseUrl}/api/prompt-templates${queryString}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as PromptTemplateListResponse;
    setList(data);
  }

  async function createGlobal() {
    const promptType = filterPromptType || promptTypes[0];
    if (!promptType) {
      alert("提示词类型尚未加载，请确认后端服务是否正常运行");
      return;
    }
    const res = await fetch(`${apiBaseUrl}/api/prompt-templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `${PROMPT_TYPE_LABELS[promptType] || promptType}（全局）`,
        prompt_type: promptType,
        scope: "global",
        category_id: null,
        task_id: null,
        template_text: defaultTemplateTextByType(promptType),
        variables_json: {},
        version: 1,
        enabled: true,
      }),
    });
    if (!res.ok) {
      alert(`创建失败: HTTP ${res.status}`);
      return;
    }
    await refreshList();
  }

  async function runRender() {
    setRenderError(null);
    setRendered("");
    let vars: Record<string, unknown> = {};
    try {
      vars = JSON.parse(testVarsJson) as Record<string, unknown>;
    } catch {
      setRenderError("变量 JSON 解析失败");
      return;
    }
    const res = await fetch(`${apiBaseUrl}/api/prompt-templates/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template_text: draftText || "", variables: vars }),
    });
    if (!res.ok) {
      setRenderError(`渲染失败: HTTP ${res.status}`);
      return;
    }
    const data = (await res.json()) as RenderResponse;
    setRendered(data.rendered_text);
  }

  return (
    <div className="min-h-screen px-4 py-6 md:px-6">
      <section className="mx-auto ">
        <header className="rounded-[28px] border border-[var(--card-border)] bg-[var(--card)] p-6 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-sm text-slate-500">提示词管理</div>
              <h1 className="mt-1 text-3xl font-semibold">提示词中心</h1>
              <div className="mt-2 text-sm text-slate-600">
                共 {visibleItems.length} 条 {loading ? "（加载中…）" : ""}。同一类型里“已启用且版本最高”的模板会自动作为默认版本。
              </div>
            </div>
            <button
              type="button"
              onClick={() => void createGlobal()}
              className="h-11 rounded-full bg-slate-900 px-5 text-sm font-medium text-white"
            >
              新增全局模板
            </button>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-3">
            <select
              value={filterPromptType}
              onChange={(e) => setFilterPromptType(e.target.value)}
              className="h-11 rounded-[16px] border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
            >
              <option value="">类型：全部</option>
              {promptTypes.map((t) => (
                <option key={t} value={t}>
                  {PROMPT_TYPE_LABELS[t] || t}
                </option>
              ))}
            </select>
            <select
              value={filterScope}
              onChange={(e) => setFilterScope(e.target.value)}
              className="h-11 rounded-[16px] border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
            >
              <option value="">作用域：全部</option>
              <option value="global">全局</option>
              <option value="category">类目</option>
              <option value="task">单商品</option>
            </select>
            <input
              value={filterCategoryId}
              onChange={(e) => setFilterCategoryId(e.target.value)}
              placeholder="类目 ID（仅 scope=category）"
              className="h-11 rounded-[16px] border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
            />
          </div>

          {error ? <div className="mt-4 text-sm text-rose-600">加载失败：{error}</div> : null}
        </header>

        <div className="mt-6 grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
          <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900">
              模板列表
            </div>
            <div className="max-h-[680px] overflow-auto">
              {visibleItems.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-slate-500">暂无模板</div>
              ) : (
                visibleItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectItem(item)}
                    className={[
                      "w-full border-b border-slate-100 px-4 py-3 text-left text-sm hover:bg-slate-50",
                      selected?.id === item.id ? "bg-slate-100" : "bg-white",
                    ].join(" ")}
                  >
                    {defaultIdByGroup.get(groupKey(item)) === item.id ? (
                      <div className="mb-1 text-[11px] font-semibold text-emerald-700">默认版本</div>
                    ) : null}
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-slate-900">{item.name}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {PROMPT_TYPE_LABELS[item.prompt_type] || item.prompt_type} · {SCOPE_LABELS[item.scope] || item.scope}
                          {item.category_id ? ` · 类目=${item.category_id}` : ""}
                          {item.task_id ? ` · 商品任务=${item.task_id}` : ""}
                        </div>
                      </div>
                      <span
                        className={[
                          "shrink-0 rounded-full border px-2.5 py-1 text-xs",
                          item.enabled
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-slate-200 bg-slate-50 text-slate-500",
                        ].join(" ")}
                      >
                        v{item.version} {item.enabled ? "已启用" : "已停用"}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="rounded-[24px] border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-slate-900">编辑器</div>
              <button
                type="button"
                disabled={!selected}
                onClick={() => void saveSelected()}
                className="h-10 rounded-full bg-slate-900 px-4 text-sm font-medium text-white disabled:opacity-40"
              >
                保存
              </button>
            </div>

            {!selected ? (
              <div className="mt-4 rounded-[18px] border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                从左侧选择一个模板开始编辑
              </div>
            ) : (
              <>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <input
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    className="h-10 rounded-[14px] border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
                    placeholder="模板名"
                  />
                  <input
                    value={draftVersion}
                    onChange={(e) => setDraftVersion(Number(e.target.value || 1))}
                    className="h-10 rounded-[14px] border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
                    placeholder="版本"
                    type="number"
                    min={1}
                  />
                  <label className="flex h-10 items-center justify-between rounded-[14px] border border-slate-200 px-3 text-sm text-slate-700">
                    <span>启用</span>
                    <input
                      type="checkbox"
                      checked={draftEnabled}
                      onChange={(e) => setDraftEnabled(e.target.checked)}
                    />
                  </label>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
                  <div>
                    <div className="text-xs font-semibold text-slate-700">模板文本</div>
                    <textarea
                      value={draftText}
                      onChange={(e) => setDraftText(e.target.value)}
                      className="mt-2 h-[260px] w-full resize-none rounded-[18px] border border-slate-200 bg-white p-3 text-sm font-mono outline-none focus:border-slate-400"
                      placeholder="支持 {{title}} 这类变量占位符"
                    />
                    <div className="mt-2 text-xs text-slate-500">
                      变量占位符格式：<span className="font-mono">{`{{var_name}}`}</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-700">变量提示</div>
                    <div className="mt-2 max-h-[260px] overflow-auto rounded-[18px] border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                      {Object.entries(promptVariables).map(([k, v]) => (
                        <div key={k} className="border-b border-slate-200/70 py-2 last:border-b-0">
                          <div className="font-mono text-[12px] font-semibold">{k}</div>
                          <div className="mt-1 text-slate-600">
                            {v.type} · {v.desc}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-6 rounded-[18px] border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-900">渲染预览 / 测试区</div>
                    <button
                      type="button"
                      onClick={() => void runRender()}
                      className="h-10 rounded-full bg-white px-4 text-sm font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                    >
                      渲染
                    </button>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div>
                      <div className="text-xs font-semibold text-slate-700">变量 JSON</div>
                      <textarea
                        value={testVarsJson}
                        onChange={(e) => setTestVarsJson(e.target.value)}
                        className="mt-2 h-[180px] w-full resize-none rounded-[16px] border border-slate-200 bg-white p-3 text-xs font-mono outline-none focus:border-slate-400"
                      />
                      {renderError ? <div className="mt-2 text-xs text-rose-600" >{renderError}</div> : null}
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-slate-700">渲染结果</div>
                      <pre className="mt-2 h-[180px] overflow-auto rounded-[16px] border border-slate-200 bg-white p-3 text-xs text-slate-700">
                        {rendered || "（点击渲染）"}
                      </pre>
                    </div>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
