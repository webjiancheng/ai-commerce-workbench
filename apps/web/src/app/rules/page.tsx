"use client";

import { apiBaseUrl } from "@/lib/api";
import { useEffect, useMemo, useState } from "react";

type DefaultRule = {
  id: number;
  name: string;
  rule_type: string;
  scope: string;
  match_json: Record<string, unknown>;
  output_json: Record<string, unknown>;
  priority: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

type ListResponse = {
  items: DefaultRule[];
  total: number;
  limit: number;
  offset: number;
};

type FieldDraft = {
  fieldKey: string;
  value: string;
};

type TemplateFieldsResponse = {
  ok: boolean;
  template_id: number;
  fields: Array<{ field_key: string; field_name: string; required?: boolean }>;
};

type ExportFieldMapping = {
  id: number;
  template_id: number;
  field_key: string;
  field_name: string;
  source_type: string | null;
  source_path: string | null;
  required: boolean;
};

type FieldTemplate = {
  id: string;
  name: string;
  rows: FieldDraft[];
};

const RULE_TYPE_LABEL: Record<string, string> = {
  fixed_default: "全局默认值（所有商品都补）",
  category_default: "类目默认值（指定类目补）",
  keyword_rule: "关键词规则（标题含关键词时补）",
  sensitive_rule: "敏感词规则（命中敏感词时处理）",
  sku_flatten_rule: "SKU 处理规则（SKU 字段整理）",
};

const SCOPE_LABEL: Record<string, string> = {
  global: "全局（对全部商品生效）",
  category: "类目（只对某类目生效）",
  keyword: "关键词（命中关键词才生效）",
  product: "单商品（只对指定商品生效）",
};

const TRIGGER_FIELD_OPTIONS = [
  { value: "always", label: "不过滤（所有商品）", hint: "不需要填触发值" },
  { value: "category_path", label: "类目路径 category_path", hint: "示例：手机配件>手机壳" },
  { value: "title", label: "商品标题 title（包含）", hint: "示例：磁吸" },
  { value: "source_id", label: "来源ID/平台SKU", hint: "示例：1234567890" },
  { value: "platform", label: "平台 platform", hint: "示例：temu" },
];

const OUTPUT_FIELD_OPTIONS: Array<{ value: string; label: string; hint: string; required?: boolean }> = [
  { value: "is_sensitive", label: "是否敏感商品", hint: "填 true 或 false", required: true },
  { value: "declared_price_cny", label: "申报价（CNY）", hint: "填数字，如 8.9", required: true },
  { value: "suggested_price_cny", label: "建议售价（CNY）", hint: "填数字，如 19.9" },
  { value: "category_path", label: "默认类目路径", hint: "示例：家居>收纳" },
  { value: "material", label: "默认材质", hint: "示例：硅胶" },
  { value: "target_user", label: "默认适用人群", hint: "示例：成人女性" },
  { value: "usage_scene", label: "默认使用场景", hint: "示例：居家日用" },
  { value: "package_hint", label: "默认包装说明", hint: "示例：标准包装" },
  { value: "master_no", label: "主编号", hint: "示例：M-001", required: true },
  { value: "master_item_no", label: "主货号", hint: "示例：SKU-MAIN-01" },
  { value: "stock_qty", label: "库存", hint: "填数字，如 9999" },
  { value: "origin_country", label: "产地", hint: "示例：中国", required: true },
  { value: "is_custom", label: "定制品", hint: "示例：否", required: true },
  { value: "sku_spec1_name", label: "规格名称1", hint: "示例：颜色", required: true },
  { value: "sku_spec1_value", label: "规格属性值1", hint: "示例：黑色", required: true },
  { value: "sku_spec2_name", label: "规格名称2", hint: "示例：尺寸", required: true },
  { value: "sku_spec2_value", label: "规格属性值2", hint: "示例：M", required: true },
  { value: "length_cm", label: "长（cm）", hint: "示例：25", required: true },
  { value: "width_cm", label: "宽（cm）", hint: "示例：10", required: true },
  { value: "height_cm", label: "高（cm）", hint: "示例：6", required: true },
  { value: "weight_g", label: "重量（g）", hint: "示例：320", required: true },
  { value: "sensitive_type", label: "敏感属性值", hint: "示例：带电池" },
  { value: "battery_capacity", label: "储电容量", hint: "示例：5000mAh" },
  { value: "blade_length", label: "刀具长度", hint: "示例：8cm" },
  { value: "blade_tip_sharpness", label: "刀具尖度", hint: "示例：圆头" },
  { value: "liquid_capacity", label: "液体容量", hint: "示例：500ml" },
  { value: "product_code_type", label: "产品编码类型", hint: "示例：EAN" },
  { value: "product_code", label: "产品编码", hint: "示例：1234567890123" },
  { value: "sku_class_type", label: "SKU分类类型", hint: "示例：件" },
  { value: "sku_class_count", label: "SKU分类数量", hint: "示例：12" },
  { value: "sku_class_unit", label: "SKU分类单位", hint: "示例：个" },
  { value: "is_independent_packaging", label: "是否独立包装", hint: "示例：是" },
  { value: "packing_list", label: "包装清单", hint: "示例：主品*1，配件*2" },
  { value: "packing_list_count", label: "包装清单数量", hint: "示例：3" },
  { value: "main_video_url", label: "主图视频", hint: "示例：https://..." },
  { value: "manual_url", label: "产品说明书", hint: "示例：https://..." },
  { value: "supplier_url", label: "货源链接", hint: "示例：https://..." },
];

const FIELD_TEMPLATES: FieldTemplate[] = [
  {
    id: "temu_basic",
    name: "Temu 常用基础字段（含必填）",
    rows: [
      { fieldKey: "master_no", value: "" },
      { fieldKey: "origin_country", value: "中国" },
      { fieldKey: "is_custom", value: "否" },
      { fieldKey: "sku_spec1_name", value: "" },
      { fieldKey: "sku_spec1_value", value: "" },
      { fieldKey: "sku_spec2_name", value: "" },
      { fieldKey: "sku_spec2_value", value: "" },
      { fieldKey: "length_cm", value: "" },
      { fieldKey: "width_cm", value: "" },
      { fieldKey: "height_cm", value: "" },
      { fieldKey: "weight_g", value: "" },
      { fieldKey: "is_sensitive", value: "false" },
      { fieldKey: "declared_price_cny", value: "8.9" },
      { fieldKey: "material", value: "塑料" },
      { fieldKey: "target_user", value: "成人通用" },
      { fieldKey: "usage_scene", value: "居家日用" },
      ],
  },
  {
    id: "safe_fallback",
      name: "通用兜底字段",
      rows: [
      { fieldKey: "is_sensitive", value: "false" },
      { fieldKey: "package_hint", value: "标准包装" },
      { fieldKey: "usage_scene", value: "居家日用" },
      ],
  },
];

function safeJsonParse(text: string): Record<string, unknown> | null {
  try {
    const obj = JSON.parse(text);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    return obj as Record<string, unknown>;
  } catch {
    return null;
  }
}

export default function RulesPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ListResponse>({ items: [], total: 0, limit: 200, offset: 0 });

  const [name, setName] = useState("");
  const [ruleType, setRuleType] = useState("fixed_default");
  const [scope, setScope] = useState("global");
  const [priority, setPriority] = useState(0);
  const [enabled, setEnabled] = useState(true);
  const [matchJsonText, setMatchJsonText] = useState("{}");
  const [outputJsonText, setOutputJsonText] = useState("{\n  \"is_sensitive\": false\n}");
  const [simpleTriggerField, setSimpleTriggerField] = useState("always");
  const [simpleTriggerValue, setSimpleTriggerValue] = useState("");
  const [fieldDrawerOpen, setFieldDrawerOpen] = useState(false);
  const [requiredDraftKeys, setRequiredDraftKeys] = useState<Set<string>>(new Set());
  const [selectedTemplateId, setSelectedTemplateId] = useState(FIELD_TEMPLATES[0]?.id || "");
  const [fieldDrafts, setFieldDrafts] = useState<FieldDraft[]>([
    { fieldKey: "is_sensitive", value: "false" },
    { fieldKey: "declared_price_cny", value: "" },
    { fieldKey: "material", value: "" },
  ]);

  const matchJsonErr = useMemo(() => (safeJsonParse(matchJsonText) ? null : "条件 JSON 格式不正确"), [
    matchJsonText,
  ]);
  const outputJsonErr = useMemo(() => (safeJsonParse(outputJsonText) ? null : "结果 JSON 格式不正确"), [outputJsonText]);

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/default-rules?enabled=true&limit=200&offset=0`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ListResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载规则失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    async function loadRequiredKeys(): Promise<void> {
      try {
        const templateRes = await fetch(`${apiBaseUrl}/api/export-template/fields`, { cache: "no-store" });
        if (!templateRes.ok) return;
        const templateJson = (await templateRes.json()) as TemplateFieldsResponse;
        if (!templateJson?.template_id) return;

        const mappingRes = await fetch(
          `${apiBaseUrl}/api/export-field-mappings?template_id=${templateJson.template_id}`,
          { cache: "no-store" },
        );
        if (!mappingRes.ok) return;
        const mappings = (await mappingRes.json()) as ExportFieldMapping[];
        const requiredKeys = new Set<string>();
        for (const m of mappings) {
          if (!m.required || m.source_type !== "draft" || !m.source_path) continue;
          const path = m.source_path.trim().replace(/^export_field_drafts\./, "").replace(/^fields\./, "");
          if (path) requiredKeys.add(path);
        }
        setRequiredDraftKeys(requiredKeys);
      } catch {
        // ignore and keep fallback required labels
      }
    }
    void loadRequiredKeys();
  }, []);

  function applySimpleBuilder(): void {
    const triggerValue = simpleTriggerValue.trim();
    const match: Record<string, unknown> = {};
    if (simpleTriggerField === "category_path" && triggerValue) {
      match.category_path_contains = triggerValue;
    } else if (simpleTriggerField === "title" && triggerValue) {
      match.keywords = [triggerValue];
    } else if (simpleTriggerField === "source_id" && triggerValue) {
      match.field_equals = { platform_sku: triggerValue };
    } else if (simpleTriggerField === "platform" && triggerValue) {
      match.field_equals = { platform: triggerValue };
    }

    setMatchJsonText(JSON.stringify(match, null, 2));
  }

  function parseFieldValue(text: string): unknown {
    const v = text.trim();
    if (v === "true") return true;
    if (v === "false") return false;
    if (v !== "" && !Number.isNaN(Number(v))) return Number(v);
    return text;
  }

  function syncFieldDraftsFromOutput(): void {
    const parsed = safeJsonParse(outputJsonText);
    if (!parsed) return;
    const next = Object.entries(parsed).map(([key, value]) => ({
      fieldKey: key,
      value: typeof value === "string" ? value : JSON.stringify(value),
    }));
    if (next.length) setFieldDrafts(next);
  }

  function applyFieldDraftsToOutput(): void {
    const output: Record<string, unknown> = {};
    for (const row of fieldDrafts) {
      const key = row.fieldKey.trim();
      if (!key) continue;
      output[key] = parseFieldValue(row.value);
    }
    setOutputJsonText(JSON.stringify(output, null, 2));
    setFieldDrawerOpen(false);
  }

  function applyTemplate(append: boolean): void {
    const tpl = FIELD_TEMPLATES.find((t) => t.id === selectedTemplateId);
    if (!tpl) return;
    if (!append) {
      setFieldDrafts(tpl.rows.map((r) => ({ ...r })));
      return;
    }
    setFieldDrafts((prev) => {
      const merged = [...prev];
      for (const row of tpl.rows) {
        if (!merged.find((x) => x.fieldKey.trim() === row.fieldKey.trim())) merged.push({ ...row });
      }
      for (const req of requiredDraftKeys) {
        if (!merged.find((x) => x.fieldKey.trim() === req.trim())) {
          merged.push({ fieldKey: req, value: "" });
        }
      }
      return merged;
    });
  }

  async function createRule(): Promise<void> {
    setError(null);
    const match = safeJsonParse(matchJsonText);
    const output = safeJsonParse(outputJsonText);
    if (!match) return setError("命中条件 JSON 格式不正确");
    if (!output) return setError("补齐结果 JSON 格式不正确");
    if (!name.trim()) return setError("规则名称必填");

    try {
      const res = await fetch(`${apiBaseUrl}/api/default-rules`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          rule_type: ruleType,
          scope,
          priority: Number(priority) || 0,
          enabled,
          match_json: match,
          output_json: output,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    }
  }

  async function toggleEnabled(rule: DefaultRule): Promise<void> {
    setError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/default-rules/${rule.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新失败");
    }
  }

  async function disable(rule: DefaultRule): Promise<void> {
    setError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/default-rules/${rule.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((prev) => ({ ...prev, items: prev.items.filter((item) => item.id !== rule.id) }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "禁用失败");
    }
  }

  return (
    <div className="min-h-screen px-4 py-6 md:px-6">
      <section className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-[28px] border border-[var(--card-border)] bg-[var(--card)] p-6 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="text-sm text-slate-500">采集后自动帮你把字段补完整</div>
          <h1 className="mt-1 text-3xl font-semibold">上架默认值</h1>
          <div className="mt-2 text-sm text-slate-600">
            这里相当于“自动填写规则”。你先设好规则，后面系统会按条件自动填字段，减少手工复制粘贴。
          </div>
        </header>

        {error ? (
          <div className="rounded-[18px] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="rounded-[24px] border border-slate-200 bg-white p-6">
          <div className="text-sm font-semibold text-slate-900">新增自动填写规则</div>
          <div className="mt-3 rounded-[16px] border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
            小白模式：先填“触发条件”，再到“默认字段抽屉”配置要自动补的内容。命中这条规则的商品都会应用，不是只针对单个商品。
          </div>
          <div className="mt-3 rounded-[16px] border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
            可选触发字段：类目路径、标题包含词、来源ID、平台。字段填写请在“默认字段抽屉”里按中文名称配置。
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            <label className="space-y-1">
              <div className="text-xs text-slate-500">触发字段</div>
              <select
                value={simpleTriggerField}
                onChange={(e) => setSimpleTriggerField(e.target.value)}
                className="h-11 w-full rounded-[16px] border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
              >
                {TRIGGER_FIELD_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              <div className="text-[11px] text-slate-500">
                {TRIGGER_FIELD_OPTIONS.find((x) => x.value === simpleTriggerField)?.hint}
              </div>
            </label>
            <label className="space-y-1">
              <div className="text-xs text-slate-500">触发值</div>
              <input
                value={simpleTriggerValue}
                onChange={(e) => setSimpleTriggerValue(e.target.value)}
                placeholder="例如 手机壳 / Women Dresses / 123456"
                className="h-11 w-full rounded-[16px] border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
              />
            </label>
            <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 md:col-span-2">
              这里先确定“触发条件”。要补哪些字段，请点下面“打开默认字段抽屉”统一配置。
            </div>
          </div>
          <div className="mt-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={applySimpleBuilder}
                className="h-10 rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50"
              >
                生成触发条件
              </button>
              <button
                type="button"
                onClick={() => {
                  syncFieldDraftsFromOutput();
                  setFieldDrawerOpen(true);
                }}
                className="h-10 rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50"
              >
                打开默认字段抽屉
              </button>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <div className="text-xs text-slate-500">规则名称（给自己看的备注名）</div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-11 w-full rounded-[16px] border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
                placeholder="例如：全局默认-非敏感商品"
              />
            </label>
            <div className="grid grid-cols-3 gap-3">
              <label className="space-y-1">
                <div className="text-xs text-slate-500">规则类型（这条规则是按什么方式触发）</div>
                <select
                  value={ruleType}
                  onChange={(e) => setRuleType(e.target.value)}
                  className="h-11 w-full rounded-[16px] border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                >
                  <option value="fixed_default">全局默认值（所有商品都补）</option>
                  <option value="category_default">类目默认值（指定类目补）</option>
                  <option value="keyword_rule">关键词规则（标题含关键词时补）</option>
                  <option value="sensitive_rule">敏感词规则（命中敏感词时处理）</option>
                  <option value="sku_flatten_rule">SKU 处理规则（SKU 字段整理）</option>
                </select>
              </label>
              <label className="space-y-1">
                <div className="text-xs text-slate-500">作用范围（这条规则影响哪些商品）</div>
                <select
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                  className="h-11 w-full rounded-[16px] border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                >
                  <option value="global">全局（对全部商品生效）</option>
                  <option value="category">类目（只对某类目生效）</option>
                  <option value="keyword">关键词（命中关键词才生效）</option>
                  <option value="product">单商品（只对指定商品生效）</option>
                </select>
              </label>
              <label className="space-y-1">
                <div className="text-xs text-slate-500">优先级（数字越大越先执行）</div>
                <input
                  value={String(priority)}
                  onChange={(e) => setPriority(Number(e.target.value))}
                  className="h-11 w-full rounded-[16px] border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
                  type="number"
                />
              </label>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>什么时候触发（命中条件）</span>
                {matchJsonErr ? <span className="text-rose-600">{matchJsonErr}</span> : null}
              </div>
              <textarea
                value={matchJsonText}
                onChange={(e) => setMatchJsonText(e.target.value)}
                className="h-[160px] w-full resize-none rounded-[18px] border border-slate-200 bg-white p-3 text-xs font-mono outline-none focus:border-slate-400"
              />
              <div className="text-[11px] text-slate-500">
                这里写“什么情况下触发”。支持按类目、关键词、字段值等条件匹配。
              </div>
            </label>

            <label className="space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>触发后要自动填写什么（补齐结果）</span>
                {outputJsonErr ? <span className="text-rose-600">{outputJsonErr}</span> : null}
              </div>
              <textarea
                value={outputJsonText}
                onChange={(e) => setOutputJsonText(e.target.value)}
                className="h-[160px] w-full resize-none rounded-[18px] border border-slate-200 bg-white p-3 text-xs font-mono outline-none focus:border-slate-400"
              />
              <div className="text-[11px] text-slate-500">这里写触发后要填入的字段和值。</div>
            </label>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              启用此规则
            </label>
            <button
              type="button"
              onClick={() => void createRule()}
              className="h-11 rounded-full bg-slate-900 px-5 text-sm font-medium text-white hover:bg-slate-800"
              disabled={!!matchJsonErr || !!outputJsonErr || loading}
            >
              保存规则
            </button>
          </div>
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-900">已保存规则列表</div>
            <button
              type="button"
              onClick={() => void load()}
              className="h-10 rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50"
            >
              刷新
            </button>
          </div>
          <div className="mt-4 space-y-3">
            {data.items.map((rule) => (
              <div key={rule.id} className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">
                      #{rule.id} · {rule.name}
                    </div>
                    <div className="mt-1 text-xs text-slate-600">
                      {RULE_TYPE_LABEL[rule.rule_type] || rule.rule_type} · {SCOPE_LABEL[rule.scope] || rule.scope} ·
                      优先级 {rule.priority}
                      {rule.enabled ? " · 已启用" : " · 已停用"}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void toggleEnabled(rule)}
                      className="h-9 rounded-full border border-slate-200 bg-white px-4 text-xs text-slate-700 hover:bg-slate-50"
                    >
                      {rule.enabled ? "停用" : "启用"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void disable(rule)}
                      className="h-9 rounded-full border border-rose-200 bg-rose-50 px-4 text-xs text-rose-700 hover:bg-rose-100"
                    >
                      删除
                    </button>
                  </div>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <pre className="max-h-[220px] overflow-auto rounded-[14px] border border-slate-200 bg-white p-3 text-xs text-slate-700">
                    {JSON.stringify(rule.match_json || {}, null, 2)}
                  </pre>
                  <pre className="max-h-[220px] overflow-auto rounded-[14px] border border-slate-200 bg-white p-3 text-xs text-slate-700">
                    {JSON.stringify(rule.output_json || {}, null, 2)}
                  </pre>
                </div>
              </div>
            ))}
            {data.items.length ? null : (
              <div className="rounded-[18px] border border-slate-200 bg-white p-4 text-sm text-slate-600">
                暂无规则
              </div>
            )}
          </div>
        </div>
      </section>
      {fieldDrawerOpen ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30">
          <div className="h-full w-full max-w-[520px] overflow-auto bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">默认字段配置抽屉</div>
                <div className="mt-1 text-xs text-slate-500">用于配置“未生成或未填写时”要补的默认字段。</div>
              </div>
              <button
                type="button"
                onClick={() => setFieldDrawerOpen(false)}
                className="h-9 rounded-full border border-slate-200 px-3 text-xs text-slate-600 hover:bg-slate-50"
              >
                关闭
              </button>
            </div>

            <div className="mt-4 space-y-2">
              <div className="rounded-[14px] border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-700">常用字段模板</div>
                <div className="mt-1 text-[11px] text-slate-500">字段后面标注“必填”的，建议优先配置默认值。</div>
                <div className="mt-2 grid grid-cols-[1fr_auto_auto] gap-2">
                  <select
                    value={selectedTemplateId}
                    onChange={(e) => setSelectedTemplateId(e.target.value)}
                    className="h-10 rounded-[12px] border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                  >
                    {FIELD_TEMPLATES.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {tpl.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => applyTemplate(false)}
                    className="h-10 rounded-[12px] border border-slate-200 bg-white px-3 text-xs text-slate-700 hover:bg-slate-100"
                  >
                    覆盖导入
                  </button>
                  <button
                    type="button"
                    onClick={() => applyTemplate(true)}
                    className="h-10 rounded-[12px] border border-slate-200 bg-white px-3 text-xs text-slate-700 hover:bg-slate-100"
                  >
                    追加导入
                  </button>
                </div>
              </div>
              {fieldDrafts.map((row, idx) => (
                <div key={`${idx}-${row.fieldKey}`} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                  <select
                    value={row.fieldKey}
                    onChange={(e) =>
                      setFieldDrafts((prev) =>
                        prev.map((x, i) => (i === idx ? { ...x, fieldKey: e.target.value } : x)),
                      )
                    }
                    className="h-10 rounded-[12px] border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                  >
                    {OUTPUT_FIELD_OPTIONS.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                        {item.required || requiredDraftKeys.has(item.value) ? "（必填）" : ""}
                      </option>
                    ))}
                  </select>
                  <input
                    value={row.value}
                    onChange={(e) =>
                      setFieldDrafts((prev) => prev.map((x, i) => (i === idx ? { ...x, value: e.target.value } : x)))
                    }
                    placeholder="默认值，例如 false / 9.9 / 普货"
                    className="h-10 rounded-[12px] border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
                  />
                  <button
                    type="button"
                    onClick={() => setFieldDrafts((prev) => prev.filter((_, i) => i !== idx))}
                    className="h-10 rounded-[12px] border border-rose-200 bg-rose-50 px-3 text-xs text-rose-700 hover:bg-rose-100"
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setFieldDrafts((prev) => [...prev, { fieldKey: OUTPUT_FIELD_OPTIONS[0].value, value: "" }])
                    }
                    className="h-10 rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    新增一行字段
              </button>
              <button
                type="button"
                onClick={applyFieldDraftsToOutput}
                className="h-10 rounded-full bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
              >
                应用到补齐结果
              </button>
            </div>

            <div className="mt-4 rounded-[14px] border border-slate-200 bg-slate-50 p-3 text-xs leading-6 text-slate-600">
              值类型规则：`true/false` 会按布尔值写入，纯数字会按数字写入，其它按文本写入。这里配置的是命中规则后的默认补齐值。
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
