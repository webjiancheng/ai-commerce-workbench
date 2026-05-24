"use client";

import { apiBaseUrl } from "@/lib/api";
import { useEffect, useState } from "react";

/* ───────────────── types ───────────────── */
type DefaultRule = {
  id: number;
  name: string;
  rule_type: string;
  scope: string;
  platform: string | null;
  site: string | null;
  fulfillment_mode: string | null;
  category_path: string | null;
  conditions_json: Record<string, unknown>;
  values_json: Record<string, unknown>;
  priority: number;
  enabled: boolean;
  updated_at: string;
};

type CategorySearchItem = { path: string; leaf: string };

type QuickTemplate = {
  id: string;
  name: string;
  platform: string;
  category_path: string;
  category_keywords: string;
  values: Record<string, string>;
};

type FieldEntry = { key: string; value: string; layer: "uniform" | "category" | "manual"; status: "filled" | "empty" };

/* ───────────────── field groups (高密度版) ───────────────── */
type FieldDef = {
  key: string;
  label: string;
  type?: "text" | "select" | "number" | "textarea";
  options?: string[];
  hint?: string;
  layer: "uniform" | "category" | "manual";
  group: string;
};

const ALL_FIELD_DEFS: Record<string, FieldDef> = {
  // ── 站点与物流 (Layer-2) ──
  经营站点: { key: "经营站点", label: "经营站点", type: "select", options: ["美国站", "英国站", "德国站", "法国站", "意大利站", "西班牙站", "日本站", "澳大利亚站"], layer: "uniform", group: "经营配置" },
  发货仓: { key: "发货仓", label: "发货仓", type: "select", options: ["美国-饰品", "美国-普货", "英国-饰品", "英国-普货", "德国-饰品", "德国-普货"], layer: "uniform", group: "经营配置" },
  运费模版: { key: "运费模版", label: "运费模版", type: "text", hint: "按站点自动切换", layer: "uniform", group: "经营配置" },
  承诺发货时效: { key: "承诺发货时效", label: "承诺发货时效", type: "select", options: ["2个工作日内发货", "3个工作日内发货", "5个工作日内发货", "7个工作日内发货"], layer: "uniform", group: "经营配置" },
  素材语言: { key: "素材语言", label: "素材语言", type: "select", options: ["英语", "英语+德语", "英语+法语", "英语+西班牙语", "多语言"], layer: "uniform", group: "经营配置" },
  // ── 商品基础 (Layer-2) ──
  商品产地: { key: "商品产地", label: "商品产地", type: "select", options: ["中国", "美国", "日本", "韩国", "英国"], layer: "uniform", group: "商品与SKU默认" },
  产地省份: { key: "产地省份", label: "产地省份", type: "text", hint: "默认广东省", layer: "uniform", group: "商品与SKU默认" },
  商品层级: { key: "商品层级", label: "商品层级", type: "select", options: ["根据 SKU 自动判断", "单SKU商品", "多SKU商品"], layer: "uniform", group: "商品与SKU默认" },
  SPU货号规则: { key: "SPU货号规则", label: "SPU货号规则", type: "select", options: ["自动生成", "手动填写"], layer: "uniform", group: "商品与SKU默认" },
  SKU货号规则: { key: "SKU货号规则", label: "SKU货号规则", type: "select", options: ["自动生成", "手动填写"], layer: "uniform", group: "商品与SKU默认" },
  // ── SKU 规格 (Layer-2) ──
  默认规格类型: { key: "默认规格类型", label: "默认规格类型", type: "text", hint: "例如：款式/颜色", layer: "uniform", group: "商品与SKU默认" },
  币种: { key: "币种", label: "币种", type: "select", options: ["CNY", "USD", "EUR", "GBP"], layer: "uniform", group: "商品与SKU默认" },
  发货仓1: { key: "发货仓1", label: "发货仓1", type: "text", hint: "默认同顶部发货仓", layer: "uniform", group: "商品与SKU默认" },
  默认库存: { key: "默认库存", label: "默认库存", type: "number", hint: "每个SKU默认数量", layer: "uniform", group: "商品与SKU默认" },
  SKU分类: { key: "SKU分类", label: "SKU分类", type: "select", options: ["单品", "同款多件装", "混合套装"], layer: "uniform", group: "商品与SKU默认" },
  SKU数量: { key: "SKU数量", label: "SKU数量", type: "number", layer: "uniform", group: "商品与SKU默认" },
  SKU数量单位: { key: "SKU数量单位", label: "SKU数量单位", type: "select", options: ["件", "套", "对", "个", "组", "盒", "袋"], layer: "uniform", group: "商品与SKU默认" },
  是否独立包装: { key: "是否独立包装", label: "是否独立包装", type: "select", options: ["是", "否"], layer: "uniform", group: "商品与SKU默认" },
  商品编码类型: { key: "商品编码类型", label: "商品编码类型", type: "select", options: ["", "UPC", "EAN", "GTIN", "ASIN", "ISBN"], hint: "选填", layer: "uniform", group: "商品与SKU默认" },
  商品编码: { key: "商品编码", label: "商品编码", type: "text", hint: "选填", layer: "uniform", group: "商品与SKU默认" },
  制造商建议零售价USD: { key: "制造商建议零售价(USD)", label: "建议零售价(USD)", type: "text", hint: "非必填", layer: "uniform", group: "商品与SKU默认" },
  参考链接: { key: "参考链接", label: "参考链接", type: "text", hint: "选填，获取申报参考价", layer: "uniform", group: "商品与SKU默认" },
  // ── 尺寸重量 (Layer-2) ──
  最长边cm: { key: "最长边（cm）", label: "最长边(cm)", type: "number", hint: "cm", layer: "uniform", group: "尺寸与重量" },
  次长边cm: { key: "次长边（cm）", label: "次长边(cm)", type: "number", hint: "cm", layer: "uniform", group: "尺寸与重量" },
  最短边cm: { key: "最短边（cm）", label: "最短边(cm)", type: "number", hint: "cm", layer: "uniform", group: "尺寸与重量" },
  重量g: { key: "重量（g）", label: "重量(g)", type: "number", hint: "克", layer: "uniform", group: "尺寸与重量" },
  // ── 敏感属性 (Layer-2) ──
  敏感词属性1: { key: "敏感词属性1", label: "敏感词属性1", type: "select", options: ["", "纯电", "内电", "液体", "粉末", "膏体", "刀具", "磁性", "气雾剂"], hint: "无敏感则空", layer: "uniform", group: "敏感属性" },
  敏感词属性2: { key: "敏感词属性2", label: "敏感词属性2", type: "select", options: ["", "纯电", "内电", "液体", "粉末", "膏体", "刀具", "磁性", "气雾剂"], layer: "uniform", group: "敏感属性" },
  敏感词属性3: { key: "敏感词属性3", label: "敏感词属性3", type: "select", options: ["", "纯电", "内电", "液体", "粉末", "膏体", "刀具", "磁性", "气雾剂"], layer: "uniform", group: "敏感属性" },
  液体容量ml: { key: "液体容量（ml）", label: "液体容量(ml)", type: "text", hint: "选择液体时填", layer: "uniform", group: "敏感属性" },
  刀具长度cm: { key: "刀具长度(cm)", label: "刀具长度(cm)", type: "text", hint: "选择刀具时填", layer: "uniform", group: "敏感属性" },
  刀尖角度度: { key: "刀尖角度(度)", label: "刀尖角度(度)", type: "text", hint: "选择刀具时填", layer: "uniform", group: "敏感属性" },
  储电容量wh: { key: "储电容量（wh）", label: "储电容量(wh)", type: "text", hint: "选择纯电/内电时填", layer: "uniform", group: "敏感属性" },
  // ── 类目属性 (Layer-3) ──
  镀层: { key: "镀层", label: "镀层", type: "select", options: ["无镀层", "镀金", "镀银", "镀铜", "镀玫瑰金", "镀白金"], layer: "category", group: "类目属性" },
  镶嵌材质: { key: "镶嵌材质", label: "镶嵌材质", type: "select", options: ["无镶嵌", "锆石", "珍珠", "宝石", "水钻", "翡翠", "珊瑚"], layer: "category", group: "类目属性" },
  主体材质: { key: "主体材质", label: "主体材质", type: "select", options: ["合金", "纯银", "925银", "不锈钢", "钛钢", "铜", "木头", "树脂"], layer: "category", group: "类目属性" },
  银材料净克重: { key: "银材料净克重(g）", label: "银材料净克重(g）", type: "text", hint: "银材质时必填", layer: "category", group: "类目属性" },
  银材料净克重单位: { key: "银材料净克重(g）单位", label: "银材料净克重单位", type: "select", options: ["g", "mg"], layer: "category", group: "类目属性" },
  耳针材质: { key: "耳针材质", label: "耳针材质", type: "select", options: ["合金", "纯银", "925银", "不锈钢", "钛钢"], layer: "category", group: "类目属性" },
  是否为羽毛: { key: "是否为羽毛", label: "是否为羽毛", type: "select", options: ["否", "是"], layer: "category", group: "类目属性" },
  适配季节: { key: "适配季节", label: "适配季节", type: "select", options: ["四季", "春季", "夏季", "秋季", "冬季", "春夏", "秋冬"], layer: "category", group: "类目属性" },
  是否含金属部件: { key: "是否含金属部件", label: "是否含金属部件", type: "select", options: ["是", "否"], layer: "category", group: "类目属性" },
  金属部件材质类型1: { key: "金属部件材质类型1", label: "金属部件材质类型1", type: "select", options: ["合金", "纯银", "925银", "不锈钢", "钛钢", "铜"], layer: "category", group: "类目属性" },
  金属部件材质类型2: { key: "金属部件材质类型2", label: "金属部件材质类型2", type: "select", options: ["", "合金", "纯银", "925银", "不锈钢", "钛钢", "铜"], layer: "category", group: "类目属性" },
  金属部件材质类型3: { key: "金属部件材质类型3", label: "金属部件材质类型3", type: "select", options: ["", "合金", "纯银", "925银", "不锈钢", "钛钢", "铜"], layer: "category", group: "类目属性" },
  木材类型: { key: "木材类型", label: "木材类型", type: "text", hint: "木质饰品填写", layer: "category", group: "类目属性" },
  木种: { key: "木种", label: "木种", type: "text", hint: "例如：红木、松木", layer: "category", group: "类目属性" },
  羽毛材质: { key: "羽毛材质", label: "羽毛材质", type: "text", hint: "羽毛饰品填写", layer: "category", group: "类目属性" },
  // ── 风格/场合 (Layer-3 多选) ──
  风格1: { key: "风格1", label: "风格1（可选）", type: "textarea", hint: "例如：时尚、简约、复古", layer: "category", group: "风格与场合" },
  风格2: { key: "风格2", label: "风格2（可选）", type: "textarea", layer: "category", group: "风格与场合" },
  风格3: { key: "风格3", label: "风格3（可选）", type: "textarea", layer: "category", group: "风格与场合" },
  佩戴场合1: { key: "佩戴场合1", label: "佩戴场合1（可选）", type: "textarea", hint: "例如：日常、派对", layer: "category", group: "风格与场合" },
  佩戴场合2: { key: "佩戴场合2", label: "佩戴场合2（可选）", type: "textarea", layer: "category", group: "风格与场合" },
  营销节日1: { key: "营销节日1", label: "营销节日1（可选）", type: "textarea", hint: "例如：情人节、圣诞节", layer: "category", group: "风格与场合" },
  主题1: { key: "主题1", label: "主题1（可选）", type: "textarea", hint: "例如：几何、花朵、爱心", layer: "category", group: "风格与场合" },
  诞生石1: { key: "诞生石1", label: "诞生石1（可选）", type: "textarea", layer: "category", group: "风格与场合" },
  系列线1: { key: "系列线1", label: "系列线1（可选）", type: "textarea", layer: "category", group: "风格与场合" },
  // ── 人工必填 (Layer-4) ──
  申报价格美国站: { key: "申报价格-美国站", label: "申报价格（美国站）", type: "text", hint: "必填，需参考同类商品价格", layer: "manual", group: "人工必填" },
};

/* 字段分组顺序 */
const FIELD_GROUPS_ORDER = ["经营配置", "商品与SKU默认", "尺寸与重量", "敏感属性", "类目属性", "风格与场合", "人工必填"];

const QUICK_TEMPLATES: QuickTemplate[] = [
  {
    id: "earrings-us-half",
    name: "女士耳饰（半托）",
    platform: "Temu",
    category_path: "服装、鞋靴和珠宝饰品>女士时尚>女士饰品>女士耳饰>女士时尚耳廓环和全耳式耳环",
    category_keywords: "女士耳饰,女童耳饰,女士时尚耳廓环",
    values: {
      "经营站点": "美国站",
      "发货仓": "美国-饰品",
      "运费模版": "美国运费模版",
      "承诺发货时效": "7个工作日内发货",
      "素材语言": "英语",
      "商品产地": "中国",
      "产地省份": "广东省",
      "币种": "CNY",
      "默认库存": "100",
      "SKU分类": "单品",
      "SKU数量": "1",
      "SKU数量单位": "件",
      "是否独立包装": "是",
      "最长边（cm）": "10",
      "次长边（cm）": "8",
      "最短边（cm）": "2",
      "重量（g）": "30",
      "镀层": "无镀层",
      "镶嵌材质": "无镶嵌",
      "主体材质": "合金",
      "耳针材质": "合金",
      "适配季节": "四季",
      "是否含金属部件": "是",
      "金属部件材质类型1": "合金",
      "风格1": "时尚",
      "风格2": "简约",
      "风格3": "复古",
      "佩戴场合1": "日常",
      "佩戴场合2": "派对",
      "营销节日1": "情人节、圣诞节、母亲节",
      "主题1": "几何、花朵、爱心",
    },
  },
  {
    id: "blank",
    name: "空白规则",
    platform: "Temu",
    category_path: "",
    category_keywords: "自定义",
    values: {},
  },
];

function getGroupFields(group: string): FieldDef[] {
  return Object.values(ALL_FIELD_DEFS).filter((f) => f.group === group);
}

/* ───────────────── utils ───────────────── */
function toTextMap(input: Record<string, unknown> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input || {})) {
    out[key] = value == null ? "" : String(value);
  }
  return out;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getLayerBadgeClass(layer: string): string {
  if (layer === "manual") return "bg-rose-100 text-rose-700";
  if (layer === "category") return "bg-blue-100 text-blue-700";
  return "bg-slate-100 text-slate-600";
}

function getStatusBadgeClass(status: string): string {
  if (status === "filled") return "bg-emerald-100 text-emerald-700";
  return "bg-amber-100 text-amber-700";
}

/* ───────────────── component ───────────────── */
export default function RulesPage() {
  const [items, setItems] = useState<DefaultRule[]>([]);
  const [templates] = useState<QuickTemplate[]>(QUICK_TEMPLATES);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Edit state
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);
  const [name, setName] = useState("新建默认值规则");
  const [platform, setPlatform] = useState("Temu");
  const [site, setSite] = useState("美国站");
  const [fulfillmentMode, setFulfillmentMode] = useState("半托");
  const [categoryPath, setCategoryPath] = useState("");
  const [ruleType] = useState("category_default");
  const [scope] = useState("category");
  const [priority, setPriority] = useState(100);
  const [enabled, setEnabled] = useState(true);
  const [values, setValues] = useState<Record<string, string>>({});

  // Category search
  const [categoryQuery, setCategoryQuery] = useState("");
  const [categorySuggestions, setCategorySuggestions] = useState<CategorySearchItem[]>([]);
  const [categorySearching, setCategorySearching] = useState(false);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);

  // Collapsed groups - 默认只展开"经营配置"和"商品与SKU默认"
  const [activeGroups, setActiveGroups] = useState<Set<string>>(
    new Set(["经营配置", "商品与SKU默认"])
  );

  // Template selection
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");

  /* ─────────── load rules ─────────── */
  async function loadRules(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const rulesRes = await fetch(`${apiBaseUrl}/api/default-rules?limit=200&offset=0`, { cache: "no-store" });
      if (!rulesRes.ok) throw new Error(`HTTP ${rulesRes.status}`);
      const rulesData = (await rulesRes.json()) as { items: DefaultRule[] };
      setItems(rulesData.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载规则失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRules();
  }, []);

  /* ─────────── category search ─────────── */
  useEffect(() => {
    if (!categoryQuery.trim()) {
      setCategorySuggestions([]);
      setShowCategoryDropdown(false);
      return;
    }
    const timer = setTimeout(async () => {
      setCategorySearching(true);
      try {
        const res = await fetch(`${apiBaseUrl}/api/categories/search?q=${encodeURIComponent(categoryQuery)}&limit=50`, { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { items: CategorySearchItem[] };
          setCategorySuggestions(data.items || []);
          setShowCategoryDropdown(true);
        }
      } catch {
        setCategorySuggestions([]);
      } finally {
        setCategorySearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [categoryQuery]);

  /* ─────────── apply listing template ─────────── */
  function applyTemplateItem(templateId: string): void {
    const tmpl = templates.find((t) => t.id === templateId);
    if (!tmpl) return;
    setSelectedTemplate(`tmpl-${templateId}`);
    setName(tmpl.name);
    setPlatform(tmpl.platform || "Temu");
    if (tmpl.category_path) {
      setCategoryPath(tmpl.category_path);
      setCategoryQuery(tmpl.category_path);
    }
    setValues({ ...tmpl.values });
    setNotice(`已加载模板「${tmpl.name}」`);
  }

  /* ─────────── toggle group ─────────── */
  function toggleGroup(title: string): void {
    setActiveGroups((current) => {
      const next = new Set(current);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }

  /* ─────────── update value ─────────── */
  function updateValue(key: string, value: string): void {
    setValues((current) => ({ ...current, [key]: value }));
  }

  /* ─────────── fill form from rule ─────────── */
  function fillFormFromRule(rule: DefaultRule, copyMode: boolean): void {
    setEditingRuleId(copyMode ? null : rule.id);
    setName(copyMode ? `${rule.name}-副本` : rule.name);
    setPlatform(rule.platform || "Temu");
    setSite(rule.site || "美国站");
    setFulfillmentMode(rule.fulfillment_mode || "半托");
    setCategoryPath(rule.category_path || "");
    setCategoryQuery(rule.category_path || "");
    setPriority(rule.priority);
    setEnabled(rule.enabled);
    setValues(toTextMap(rule.values_json));
    setSelectedTemplate("");
    setNotice(copyMode ? "已复制规则到编辑区" : "已载入规则到编辑区");
    // 滚动到顶部
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ─────────── reset form ─────────── */
  function resetForm(): void {
    setEditingRuleId(null);
    setName("新建默认值规则");
    setPlatform("Temu");
    setSite("美国站");
    setFulfillmentMode("半托");
    setCategoryPath("");
    setCategoryQuery("");
    setPriority(100);
    setEnabled(true);
    setValues({});
    setSelectedTemplate("");
    setNotice(null);
  }

  /* ─────────── submit rule ─────────── */
  async function submitRule(): Promise<void> {
    if (!name.trim()) return setError("规则名称必填");
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const cleanValues: Record<string, string> = {};
      for (const [k, v] of Object.entries(values)) {
        if (v !== undefined && v !== null && String(v).trim() !== "") {
          cleanValues[k] = String(v).trim();
        }
      }
      const payload = {
        name: name.trim(),
        rule_type: ruleType,
        scope,
        platform,
        site,
        fulfillment_mode: fulfillmentMode,
        category_path: categoryPath.trim() || null,
        priority: Number(priority) || 0,
        enabled,
        conditions_json: {},
        match_json: {},
        values_json: cleanValues,
        output_json: cleanValues,
      };
      const url = editingRuleId
        ? `${apiBaseUrl}/api/default-rules/${editingRuleId}`
        : `${apiBaseUrl}/api/default-rules`;
      const method = editingRuleId ? "PATCH" : "POST";
      const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNotice(editingRuleId ? "规则已更新" : "规则已创建");
      await loadRules();
      if (!editingRuleId) resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存规则失败");
    } finally {
      setSaving(false);
    }
  }

  /* ─────────── patch / delete ─────────── */
  async function patchRule(ruleId: number, patch: Record<string, unknown>): Promise<void> {
    setError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/default-rules/${ruleId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新规则失败");
    }
  }

  async function deleteRule(ruleId: number): Promise<void> {
    setError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/default-rules/${ruleId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadRules();
      setNotice("规则已删除");
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除规则失败");
    }
  }

  /* ─────────── preview data ─────────── */
  const allFieldEntries: FieldEntry[] = Object.values(ALL_FIELD_DEFS).map((def) => ({
    key: def.key,
    value: values[def.key] || "",
    layer: def.layer,
    status: values[def.key] ? "filled" : "empty",
  }));

  const filledCount = allFieldEntries.filter((e) => e.status === "filled").length;
  const emptyCount = allFieldEntries.length - filledCount;
  const manualCount = allFieldEntries.filter((e) => e.layer === "manual").length;
  const manualEmptyCount = allFieldEntries.filter((e) => e.layer === "manual" && e.status === "empty").length;

  const previewFilled = allFieldEntries.filter((e) => e.status === "filled").slice(0, 20);

  /* ─────────── render ─────────── */
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50">

      {/* ── Top Toolbar ── */}
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5 py-3 shadow-sm">
        <div className="flex items-center gap-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-orange-500">Listing Center</div>
            <div className="text-base font-bold text-slate-950">上架默认值规则</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
              启用 <strong className="text-slate-800">{items.filter((i) => i.enabled).length}</strong>
            </span>
            <span className="flex items-center gap-1.5">
              总计 <strong className="text-slate-800">{items.length}</strong>
            </span>
          </div>
          <button
            type="button"
            onClick={resetForm}
            className="h-9 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            新建
          </button>
          <button
            type="button"
            onClick={() => void submitRule()}
            disabled={saving}
            className="h-9 rounded-full bg-slate-950 px-5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {saving ? "保存中..." : editingRuleId ? "更新规则" : "保存规则"}
          </button>
        </div>
      </header>

      {/* ── Error / Notice ── */}
      {error && (
        <div className="mx-5 mt-2 flex shrink-0 items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
          <span className="text-rose-400">⚠️</span> {error}
        </div>
      )}
      {notice && (
        <div className="mx-5 mt-2 flex shrink-0 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">
          <span className="text-emerald-400">✓</span> {notice}
        </div>
      )}

      {/* ── Main Body: 三栏 ── */}
      <div className="flex min-h-0 flex-1">

        {/* ── 左栏：260px 固定宽度 ── */}
        <aside className="flex w-[260px] shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-white">
          {/* 快速模板区 */}
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
              <span>🚀</span> 快速模板
            </div>
            {templates.length > 0 ? (
              <div className="space-y-1">
                {templates.map((tmpl) => (
                  <button
                    key={tmpl.id}
                    type="button"
                    onClick={() => applyTemplateItem(tmpl.id)}
                    className={`w-full rounded-lg px-3 py-2 text-left text-xs transition-all ${
                      selectedTemplate === `tmpl-${tmpl.id}`
                        ? "bg-orange-50 text-orange-700 ring-1 ring-orange-200"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <div className="truncate font-medium">{tmpl.name}</div>
                    {tmpl.category_keywords && <div className="mt-0.5 truncate text-[10px] text-slate-400">{tmpl.category_keywords}</div>}
                  </button>
                ))}
              </div>
            ) : (
              <div className="py-3 text-center text-[10px] text-slate-400">暂无模板，请先保存规则</div>
            )}
          </div>

          {/* 规则列表 */}
          <div className="flex-1 px-4 py-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                <span>📋</span> 规则列表
              </div>
              <button
                type="button"
                onClick={() => void loadRules()}
                className="text-[10px] text-slate-400 hover:text-slate-600"
              >
                {loading ? "..." : "刷新"}
              </button>
            </div>
            <div className="space-y-1">
              {items.length === 0 && (
                <div className="py-6 text-center text-xs text-slate-400">暂无规则</div>
              )}
              {items.map((rule) => (
                <div
                  key={rule.id}
                  className={`group cursor-pointer rounded-lg px-3 py-2.5 transition-all ${
                    editingRuleId === rule.id
                      ? "bg-orange-50 ring-1 ring-orange-200"
                      : "hover:bg-slate-50"
                  } ${rule.enabled ? "" : "opacity-50"}`}
                  onClick={() => fillFormFromRule(rule, false)}
                >
                  <div className="flex items-start justify-between gap-1">
                    <div className="min-w-0 flex-1">
                      <div className={`truncate text-xs font-semibold ${editingRuleId === rule.id ? "text-orange-700" : "text-slate-800"}`}>
                        {rule.name}
                      </div>
                      <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-400">
                        <span>{rule.platform || ""}</span>
                        {rule.site && <><span>·</span><span>{rule.site}</span></>}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); fillFormFromRule(rule, true); }}
                        className="rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-slate-200"
                        title="复制"
                      >
                        ⧉
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void patchRule(rule.id, { enabled: !rule.enabled }); }}
                        className="rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-slate-200"
                        title={rule.enabled ? "停用" : "启用"}
                      >
                        {rule.enabled ? "○" : "●"}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void deleteRule(rule.id); }}
                        className="rounded px-1.5 py-0.5 text-[10px] text-rose-400 hover:bg-rose-100"
                        title="删除"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* ── 中栏：编辑区（自适应） ── */}
        <main className="flex-1 overflow-y-auto px-5 py-4">
          <div className="mx-auto max-w-5xl space-y-2">

            {/* 基础信息区 - 高密度单行 */}
            <div className="rounded-xl border border-slate-200 bg-white">
              <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-2.5">
                <span className="text-sm font-semibold text-slate-800">规则基础信息</span>
                {editingRuleId && (
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">编辑中 #{editingRuleId}</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
                <label className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-xs font-medium text-slate-500">规则名称</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="h-8 w-52 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-100"
                  />
                </label>
                <label className="flex items-center gap-2">
                  <span className="w-12 shrink-0 text-xs font-medium text-slate-500">平台</span>
                  <select
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value)}
                    className="h-8 rounded-lg border border-slate-200 px-2 text-sm outline-none focus:border-orange-400"
                  >
                    <option value="Temu">Temu</option>
                    <option value="Shein">Shein</option>
                    <option value="Amazon">Amazon</option>
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  <span className="w-12 shrink-0 text-xs font-medium text-slate-500">站点</span>
                  <select
                    value={site}
                    onChange={(e) => setSite(e.target.value)}
                    className="h-8 rounded-lg border border-slate-200 px-2 text-sm outline-none focus:border-orange-400"
                  >
                    <option value="美国站">美国站</option>
                    <option value="英国站">英国站</option>
                    <option value="德国站">德国站</option>
                    <option value="法国站">法国站</option>
                    <option value="意大利站">意大利站</option>
                    <option value="西班牙站">西班牙站</option>
                    <option value="日本站">日本站</option>
                    <option value="澳大利亚站">澳大利亚站</option>
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-xs font-medium text-slate-500">履约模式</span>
                  <select
                    value={fulfillmentMode}
                    onChange={(e) => setFulfillmentMode(e.target.value)}
                    className="h-8 rounded-lg border border-slate-200 px-2 text-sm outline-none focus:border-orange-400"
                  >
                    <option value="半托">半托</option>
                    <option value="全托">全托</option>
                    <option value="本地直发">本地直发</option>
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  <span className="w-12 shrink-0 text-xs font-medium text-slate-500">优先级</span>
                  <input
                    type="number"
                    value={priority}
                    onChange={(e) => setPriority(Number(e.target.value))}
                    className="h-8 w-16 rounded-lg border border-slate-200 px-2 text-sm outline-none focus:border-orange-400"
                  />
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="enabled-check"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <label htmlFor="enabled-check" className="text-xs font-medium text-slate-700">启用</label>
                </label>
              </div>
              {/* 类目选择 */}
              <div className="border-t border-slate-100 px-4 py-2.5">
                <label className="flex items-center gap-3">
                  <span className="w-16 shrink-0 text-xs font-medium text-slate-500">适用类目</span>
                  <div className="relative flex-1">
                    <input
                      value={categoryQuery}
                      onChange={(e) => setCategoryQuery(e.target.value)}
                      onFocus={() => categorySuggestions.length > 0 && setShowCategoryDropdown(true)}
                      placeholder="搜索类目关键词"
                      className="h-8 w-full rounded-lg border border-slate-200 px-3 pr-8 text-sm outline-none focus:border-orange-400"
                    />
                    {categorySearching && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">...</span>
                    )}
                    {showCategoryDropdown && categorySuggestions.length > 0 && (
                      <div className="absolute z-50 mt-1 max-h-48 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-xl">
                        {categorySuggestions.map((item, i) => (
                          <div
                            key={i}
                            className="cursor-pointer px-3 py-2 text-xs hover:bg-orange-50"
                            onClick={() => {
                              setCategoryPath(item.path);
                              setCategoryQuery(item.path);
                              setShowCategoryDropdown(false);
                            }}
                          >
                            <div className="truncate text-slate-800">{item.path}</div>
                            <div className="text-[10px] text-slate-400">{item.leaf}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {categoryPath && (
                    <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">✅ 已设置</span>
                  )}
                </label>
              </div>
            </div>

            {/* 字段分组（可折叠） */}
            {FIELD_GROUPS_ORDER.map((groupName) => {
              const groupFields = getGroupFields(groupName);
              if (groupFields.length === 0) return null;
              const isActive = activeGroups.has(groupName);
              const filledInGroup = groupFields.filter((f) => values[f.key]).length;
              const groupBg = groupName === "人工必填" ? "border-rose-200" : groupName === "类目属性" || groupName === "风格与场合" ? "border-blue-200" : "";
              const groupHeaderBg = groupName === "人工必填" ? "bg-rose-50" : groupName === "类目属性" || groupName === "风格与场合" ? "bg-blue-50" : "bg-slate-50";

              return (
                <div key={groupName} className={`rounded-xl border border-slate-200 bg-white ${groupBg}`}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(groupName)}
                    className={`flex w-full items-center justify-between px-4 py-2.5 text-left ${groupHeaderBg}`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`h-5 w-5 shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold ${filledInGroup === groupFields.length ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>
                        {filledInGroup}/{groupFields.length}
                      </div>
                      <span className="text-sm font-semibold text-slate-800">{groupName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {groupName === "人工必填" && manualEmptyCount > 0 && (
                        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700">{manualEmptyCount} 必填未填</span>
                      )}
                      <span className="text-xs text-slate-400">{isActive ? "▲" : "▼"}</span>
                    </div>
                  </button>

                  {isActive && (
                    <div className="border-t border-slate-100 p-3">
                      <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {groupFields.map((field) => (
                          <label key={field.key} className="flex items-center gap-2">
                            <div className="w-24 shrink-0 text-xs font-medium text-slate-500">{field.label}</div>
                            {field.type === "select" && field.options ? (
                              <select
                                value={values[field.key] || ""}
                                onChange={(e) => updateValue(field.key, e.target.value)}
                                className="h-8 flex-1 rounded-lg border border-slate-200 px-2 text-xs outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-100"
                              >
                                <option value="">--</option>
                                {field.options.filter((o) => o).map((opt) => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            ) : field.type === "number" ? (
                              <input
                                type="number"
                                value={values[field.key] || ""}
                                onChange={(e) => updateValue(field.key, e.target.value)}
                                className="h-8 flex-1 rounded-lg border border-slate-200 px-2 text-xs outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-100"
                              />
                            ) : field.type === "textarea" ? (
                              <textarea
                                value={values[field.key] || ""}
                                onChange={(e) => updateValue(field.key, e.target.value)}
                                rows={1}
                                className="flex-1 resize-none rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-100"
                              />
                            ) : (
                              <input
                                value={values[field.key] || ""}
                                onChange={(e) => updateValue(field.key, e.target.value)}
                                className="h-8 flex-1 rounded-lg border border-slate-200 px-2 text-xs outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-100"
                              />
                            )}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* 底部空间 */}
            <div className="h-20" />
          </div>
        </main>

        {/* ── 右栏：320px 固定宽度 校验预览 ── */}
        <aside className="flex w-[320px] shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white px-4 py-4">
          {/* 覆盖率 */}
          <div className="mb-3">
            <div className="mb-2 text-xs font-semibold text-slate-700">规则覆盖</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-center">
                <div className="text-xl font-bold text-emerald-600">{filledCount}</div>
                <div className="text-[10px] text-emerald-600">已配置</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-center">
                <div className="text-xl font-bold text-slate-400">{emptyCount}</div>
                <div className="text-[10px] text-slate-400">未填写</div>
              </div>
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-center">
                <div className="text-xl font-bold text-rose-600">{manualEmptyCount}</div>
                <div className="text-[10px] text-rose-600">人工必填缺失</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-center">
                <div className="text-xl font-bold text-slate-400">{allFieldEntries.length}</div>
                <div className="text-[10px] text-slate-400">字段总数</div>
              </div>
            </div>
          </div>

          {/* 导出时将自动补齐 */}
          <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 text-xs font-semibold text-slate-700">导出时自动补齐</div>
            <div className="space-y-1 text-[11px] text-slate-500">
              <div className="flex items-center gap-1.5">
                <span className="text-emerald-500">✓</span>
                <span>站点、仓库、币种、库存、尺寸重量</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-emerald-500">✓</span>
                <span>镀层、主体材质、风格、场合</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-blue-500">✓</span>
                <span>图片、视频（从商品资产）</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-blue-500">✓</span>
                <span>商品名称、英文名称、货号（AI生成）</span>
              </div>
            </div>
          </div>

          {/* 已配置字段预览 */}
          <div className="flex-1">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-semibold text-slate-700">已配置字段</div>
              <span className="text-[10px] text-slate-400">{previewFilled.length}/{filledCount}</span>
            </div>
            <div className="space-y-1">
              {previewFilled.map((entry) => {
                const def = Object.values(ALL_FIELD_DEFS).find((d) => d.key === entry.key);
                return (
                  <div key={entry.key} className="flex items-start justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] font-medium text-slate-700">{entry.key}</div>
                      <div className="truncate text-[10px] text-slate-400">{entry.value}</div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-0.5">
                      <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${getLayerBadgeClass(entry.layer)}`}>
                        {entry.layer === "uniform" ? "L2" : entry.layer === "category" ? "L3" : "L4"}
                      </span>
                    </div>
                  </div>
                );
              })}
              {filledCount > 20 && (
                <div className="py-2 text-center text-[10px] text-slate-400">
                  ...还有 {filledCount - 20} 个字段未显示
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
