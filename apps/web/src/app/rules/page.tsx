"use client";

import { apiBaseUrl } from "@/lib/api";
import { ALL_FIELD_DEFS } from "@/features/default-rules/field-definitions";
import { RuleEditor } from "@/features/default-rules/components/rule-editor";
import { RuleList } from "@/features/default-rules/components/rule-list";
import { QUICK_TEMPLATES } from "@/features/default-rules/quick-templates";
import type { CategorySearchItem, DefaultRule, FieldEntry, QuickTemplate } from "@/features/default-rules/types";
import { useEffect, useRef, useState } from "react";

/* ───────────────── utils ───────────────── */
function toTextMap(input: Record<string, unknown> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input || {})) {
    out[key] = value == null ? "" : String(value);
  }
  return out;
}

function getLayerBadgeClass(layer: string): string {
  if (layer === "manual") return "bg-rose-100 text-rose-700";
  if (layer === "category") return "bg-blue-100 text-blue-700";
  return "bg-slate-100 text-slate-600";
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
  const [adapterKey, setAdapterKey] = useState("miaoshou_temu_non_apparel");
  const [templateKind, setTemplateKind] = useState("product_template");
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
  const categoryPickerRef = useRef<HTMLDivElement | null>(null);

  // Collapsed groups - 默认只展开"经营配置"和"商品与SKU默认"
  const [activeGroups, setActiveGroups] = useState<Set<string>>(
    new Set(["经营配置", "商品与SKU默认"])
  );

  // Template selection
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [kindFilter, setKindFilter] = useState("all");

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

  useEffect(() => {
    function handlePointerDown(event: MouseEvent): void {
      if (!categoryPickerRef.current?.contains(event.target as Node)) {
        setShowCategoryDropdown(false);
      }
    }

    function handleEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setShowCategoryDropdown(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
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
    setAdapterKey(tmpl.adapter_key || "miaoshou_temu_non_apparel");
    setTemplateKind(tmpl.template_kind || "product_template");
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
    setAdapterKey(String((rule.conditions_json || {}).adapter_key || "miaoshou_temu_non_apparel"));
    setTemplateKind(String((rule.conditions_json || {}).template_kind || "product_template"));
    setCategoryPath(rule.category_path || "");
    setCategoryQuery(rule.category_path || "");
    setPriority(rule.priority);
    setEnabled(rule.enabled);
    setValues(toTextMap(Object.keys(rule.values_json || {}).length > 0 ? rule.values_json : rule.output_json));
    setSelectedTemplate("");
    setShowCategoryDropdown(false);
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
    setAdapterKey("miaoshou_temu_non_apparel");
    setTemplateKind("product_template");
    setCategoryPath("");
    setCategoryQuery("");
    setPriority(100);
    setEnabled(true);
    setValues({});
    setSelectedTemplate("");
    setShowCategoryDropdown(false);
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
        category_path: categoryQuery.trim() || categoryPath.trim() || null,
        priority: Number(priority) || 0,
        enabled,
        conditions_json: {
          adapter_key: adapterKey,
          template_kind: templateKind,
        },
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
      const savedRule = (await res.json()) as DefaultRule;
      setItems((current) => {
        if (editingRuleId) {
          return current.map((item) => (item.id === savedRule.id ? savedRule : item));
        }
        return [savedRule, ...current];
      });
      fillFormFromRule(savedRule, false);
      setNotice(editingRuleId ? "规则已更新" : "规则已创建");
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
      setItems((current) => current.map((item) => (item.id === ruleId ? { ...item, enabled: false } : item)));
      if (editingRuleId === ruleId) {
        resetForm();
      }
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
  const manualEmptyCount = allFieldEntries.filter((e) => e.layer === "manual" && e.status === "empty").length;

  const previewFilled = allFieldEntries.filter((e) => e.status === "filled").slice(0, 20);
  const visibleItems = items.filter((item) => {
    if (!item.enabled) return false;
    const itemAdapter = String((item.conditions_json || {}).adapter_key || "miaoshou_temu_non_apparel");
    const itemKind = String((item.conditions_json || {}).template_kind || "product_template");
    if (adapterKey && itemAdapter !== adapterKey) return false;
    if (kindFilter !== "all" && itemKind !== kindFilter) return false;
    return true;
  });

  /* ─────────── render ─────────── */
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50">

      {/* ── Top Toolbar ── */}
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5 py-3 shadow-sm">
        <div className="flex items-center gap-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-orange-500">Listing Center</div>
            <div className="text-base font-bold text-slate-950">上架模板管理</div>
          </div>
          <div className="flex items-center gap-2">
            <select value={adapterKey} onChange={(e) => setAdapterKey(e.target.value)} className="h-8 rounded-lg border border-slate-200 px-2 text-xs">
              <option value="miaoshou_temu_non_apparel">Temu-妙手非服饰导入模板</option>
              <option value="temu_half_managed_jewelry_upload">Temu-半托饰品上传模板</option>
            </select>
            <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} className="h-8 rounded-lg border border-slate-200 px-2 text-xs">
              <option value="all">全部模板类型</option>
              <option value="product_template">产品模板</option>
              <option value="sku_template">SKU模板</option>
              <option value="shipping_template">发货模板</option>
              <option value="price_dimension_template">价格尺寸模板</option>
              <option value="image_video_template">图片视频模板</option>
              <option value="sensitive_template">敏感属性模板</option>
              <option value="packaging_template">包装模板</option>
            </select>
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
        <RuleList
          templates={templates}
          selectedTemplate={selectedTemplate}
          onApplyTemplate={applyTemplateItem}
          visibleItems={visibleItems}
          editingRuleId={editingRuleId}
          loading={loading}
          onReload={() => void loadRules()}
          onSelectRule={(rule) => fillFormFromRule(rule, false)}
          onCopyRule={(rule) => fillFormFromRule(rule, true)}
          onToggleRule={(rule) => void patchRule(rule.id, { enabled: !rule.enabled })}
          onDeleteRule={(rule) => void deleteRule(rule.id)}
        />

        <RuleEditor
          editingRuleId={editingRuleId}
          name={name}
          platform={platform}
          site={site}
          fulfillmentMode={fulfillmentMode}
          priority={priority}
          enabled={enabled}
          categoryPath={categoryPath}
          categoryQuery={categoryQuery}
          categorySearching={categorySearching}
          categorySuggestions={categorySuggestions}
          showCategoryDropdown={showCategoryDropdown}
          categoryPickerRef={categoryPickerRef}
          setName={setName}
          setPlatform={setPlatform}
          setSite={setSite}
          setFulfillmentMode={setFulfillmentMode}
          templateKind={templateKind}
          setTemplateKind={setTemplateKind}
          setPriority={setPriority}
          setEnabled={setEnabled}
          setCategoryQuery={setCategoryQuery}
          setCategoryPath={setCategoryPath}
          setCategorySuggestions={setCategorySuggestions}
          setShowCategoryDropdown={setShowCategoryDropdown}
          activeGroups={activeGroups}
          toggleGroup={toggleGroup}
          values={values}
          updateValue={updateValue}
          manualEmptyCount={manualEmptyCount}
        />

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
            <div className="mb-2 text-xs font-semibold text-slate-700">规则怎么生效</div>
            <div className="space-y-1 text-[11px] text-slate-500">
              <div className="flex items-center gap-1.5">
                <span className="text-emerald-500">✓</span>
                <span>保存的是字段默认值，不会立即改商品任务</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-emerald-500">✓</span>
                <span>工作台“生成/刷新导出草稿”时写入导出字段</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-blue-500">✓</span>
                <span>下拉字段只是推荐值，也可以直接输入模板外的值</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-blue-500">✓</span>
                <span>人工覆盖过的导出字段会优先保留</span>
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
