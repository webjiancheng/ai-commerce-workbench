import { FIELD_GROUPS_ORDER, getGroupFields } from "@/features/default-rules/field-definitions";

export function RuleEditor({
  editingRuleId,
  name,
  platform,
  site,
  fulfillmentMode,
  templateKind,
  priority,
  enabled,
  categoryPath,
  categoryQuery,
  categorySearching,
  categorySuggestions,
  showCategoryDropdown,
  categoryPickerRef,
  setName,
  setPlatform,
  setSite,
  setFulfillmentMode,
  setTemplateKind,
  setPriority,
  setEnabled,
  setCategoryQuery,
  setCategoryPath,
  setCategorySuggestions,
  setShowCategoryDropdown,
  activeGroups,
  toggleGroup,
  values,
  updateValue,
  manualEmptyCount,
}: {
  editingRuleId: number | null;
  name: string;
  platform: string;
  site: string;
  fulfillmentMode: string;
  templateKind: string;
  priority: number;
  enabled: boolean;
  categoryPath: string;
  categoryQuery: string;
  categorySearching: boolean;
  categorySuggestions: { path: string; leaf: string }[];
  showCategoryDropdown: boolean;
  categoryPickerRef: React.RefObject<HTMLDivElement | null>;
  setName: (value: string) => void;
  setPlatform: (value: string) => void;
  setSite: (value: string) => void;
  setFulfillmentMode: (value: string) => void;
  setTemplateKind: (value: string) => void;
  setPriority: (value: number) => void;
  setEnabled: (value: boolean) => void;
  setCategoryQuery: (value: string) => void;
  setCategoryPath: (value: string) => void;
  setCategorySuggestions: (value: { path: string; leaf: string }[]) => void;
  setShowCategoryDropdown: (value: boolean) => void;
  activeGroups: Set<string>;
  toggleGroup: (title: string) => void;
  values: Record<string, string>;
  updateValue: (key: string, value: string) => void;
  manualEmptyCount: number;
}) {
  const getOptionListId = (fieldKey: string): string => `field-options-${encodeURIComponent(fieldKey)}`;

  return (
    <main className="flex-1 overflow-y-auto px-5 py-4">
      <div className="mx-auto max-w-5xl space-y-2">
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-2.5">
            <span className="text-sm font-semibold text-slate-800">规则基础信息</span>
            {editingRuleId && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">编辑中 #{editingRuleId}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
            <label className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-xs font-medium text-slate-500">规则名称</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className="h-8 w-52 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-100" />
            </label>
            <label className="flex items-center gap-2">
              <span className="w-12 shrink-0 text-xs font-medium text-slate-500">平台</span>
              <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="h-8 rounded-lg border border-slate-200 px-2 text-sm outline-none focus:border-orange-400"><option value="Temu">Temu</option></select>
            </label>
            <label className="flex items-center gap-2">
              <span className="w-12 shrink-0 text-xs font-medium text-slate-500">站点</span>
              <select value={site} onChange={(e) => setSite(e.target.value)} className="h-8 rounded-lg border border-slate-200 px-2 text-sm outline-none focus:border-orange-400"><option value="美国站">美国站</option></select>
            </label>
            <label className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-xs font-medium text-slate-500">履约模式</span>
              <select value={fulfillmentMode} onChange={(e) => setFulfillmentMode(e.target.value)} className="h-8 rounded-lg border border-slate-200 px-2 text-sm outline-none focus:border-orange-400"><option value="半托">半托</option></select>
            </label>
            <label className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-xs font-medium text-slate-500">模板类型</span>
              <select value={templateKind} onChange={(e) => setTemplateKind(e.target.value)} className="h-8 rounded-lg border border-slate-200 px-2 text-sm outline-none focus:border-orange-400">
                <option value="product_template">产品模板</option>
                <option value="sku_template">SKU模板</option>
                <option value="shipping_template">发货模板</option>
                <option value="price_dimension_template">价格尺寸模板</option>
                <option value="image_video_template">图片视频模板</option>
                <option value="sensitive_template">敏感属性模板</option>
                <option value="packaging_template">包装模板</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="w-12 shrink-0 text-xs font-medium text-slate-500">优先级</span>
              <input type="number" value={priority} onChange={(e) => setPriority(Number(e.target.value))} className="h-8 w-16 rounded-lg border border-slate-200 px-2 text-sm outline-none focus:border-orange-400" />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" id="enabled-check" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              <label htmlFor="enabled-check" className="text-xs font-medium text-slate-700">启用</label>
            </label>
          </div>
          <div className="border-t border-slate-100 px-4 py-2.5">
            <div className="mb-2 text-[11px] text-slate-500">当前仅支持 Temu / 美国站 / 半托 / 饰品类目规则编辑。</div>
            <label className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-xs font-medium text-slate-500">适用类目</span>
              <div ref={categoryPickerRef} className="relative flex-1">
                <input
                  value={categoryQuery}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    setCategoryQuery(nextValue);
                    if (nextValue !== categoryPath) setCategoryPath("");
                  }}
                  onFocus={() => categorySuggestions.length > 0 && setShowCategoryDropdown(true)}
                  onBlur={() => window.setTimeout(() => setShowCategoryDropdown(false), 120)}
                  placeholder="搜索类目关键词"
                  className="h-8 w-full rounded-lg border border-slate-200 px-3 pr-16 text-sm outline-none focus:border-orange-400"
                />
                {categoryQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setCategoryPath("");
                      setCategoryQuery("");
                      setCategorySuggestions([]);
                      setShowCategoryDropdown(false);
                    }}
                    className="absolute right-8 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600"
                    aria-label="清空类目"
                  >×</button>
                )}
                {categorySearching && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">...</span>}
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
              {categoryPath && <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">✅ 已设置</span>}
            </label>
          </div>
        </div>

        {FIELD_GROUPS_ORDER.map((groupName) => {
          const groupFields = getGroupFields(groupName);
          if (groupFields.length === 0) return null;
          const isActive = activeGroups.has(groupName);
          const filledInGroup = groupFields.filter((f) => values[f.key]).length;
          const groupBg = groupName === "人工必填" ? "border-rose-200" : groupName === "类目属性" || groupName === "风格与场合" ? "border-blue-200" : "";
          const groupHeaderBg = groupName === "人工必填" ? "bg-rose-50" : groupName === "类目属性" || groupName === "风格与场合" ? "bg-blue-50" : "bg-slate-50";
          return (
            <div key={groupName} className={`rounded-xl border border-slate-200 bg-white ${groupBg}`}>
              <button type="button" onClick={() => toggleGroup(groupName)} className={`flex w-full items-center justify-between px-4 py-2.5 text-left ${groupHeaderBg}`}>
                <div className="flex items-center gap-2">
                  <div className={`h-5 w-5 shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold ${filledInGroup === groupFields.length ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>
                    {filledInGroup}/{groupFields.length}
                  </div>
                  <span className="text-sm font-semibold text-slate-800">{groupName}</span>
                </div>
                <div className="flex items-center gap-2">
                  {groupName === "人工必填" && manualEmptyCount > 0 && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700">{manualEmptyCount} 必填未填</span>}
                  <span className="text-xs text-slate-400">{isActive ? "▲" : "▼"}</span>
                </div>
              </button>
              {isActive && (
                <div className="border-t border-slate-100 p-3">
                  <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {groupFields.map((field) => {
                      const optionListId = field.options?.length ? getOptionListId(field.key) : undefined;
                      return (
                        <label key={field.key} className="flex items-center gap-2" title={field.hint || ""}>
                          <div className="w-24 shrink-0 text-xs font-medium text-slate-500">{field.label}</div>
                          {field.type === "number" ? (
                            <input type="number" value={values[field.key] || ""} onChange={(e) => updateValue(field.key, e.target.value)} placeholder={field.hint || ""} className="h-8 flex-1 rounded-lg border border-slate-200 px-2 text-xs outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-100" />
                          ) : field.type === "textarea" ? (
                            <textarea value={values[field.key] || ""} onChange={(e) => updateValue(field.key, e.target.value)} rows={1} placeholder={field.hint || "可输入多个值，用逗号分隔"} className="flex-1 resize-none rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-100" />
                          ) : (
                            <>
                              <input value={values[field.key] || ""} onChange={(e) => updateValue(field.key, e.target.value)} list={optionListId} placeholder={field.options?.length ? "选择或直接输入" : field.hint || ""} className="h-8 flex-1 rounded-lg border border-slate-200 px-2 text-xs outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-100" />
                              {optionListId ? (
                                <datalist id={optionListId}>
                                  {(field.options || []).filter((o) => o).map((opt) => <option key={opt} value={opt} />)}
                                </datalist>
                              ) : null}
                            </>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <div className="h-20" />
      </div>
    </main>
  );
}
