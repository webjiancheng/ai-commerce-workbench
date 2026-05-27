import type { DefaultRule, QuickTemplate } from "@/features/default-rules/types";

export function RuleList({
  templates,
  selectedTemplate,
  onApplyTemplate,
  visibleItems,
  editingRuleId,
  loading,
  onReload,
  onSelectRule,
  onCopyRule,
  onToggleRule,
  onDeleteRule,
}: {
  templates: QuickTemplate[];
  selectedTemplate: string;
  onApplyTemplate: (id: string) => void;
  visibleItems: DefaultRule[];
  editingRuleId: number | null;
  loading: boolean;
  onReload: () => void;
  onSelectRule: (rule: DefaultRule) => void;
  onCopyRule: (rule: DefaultRule) => void;
  onToggleRule: (rule: DefaultRule) => void;
  onDeleteRule: (rule: DefaultRule) => void;
}) {
  return (
    <aside className="flex w-[260px] shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-white">
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
                onClick={() => onApplyTemplate(tmpl.id)}
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

      <div className="flex-1 px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
            <span>📋</span> 规则列表
          </div>
          <button type="button" onClick={onReload} className="text-[10px] text-slate-400 hover:text-slate-600">
            {loading ? "..." : "刷新"}
          </button>
        </div>
        <div className="space-y-1">
          {visibleItems.length === 0 && <div className="py-6 text-center text-xs text-slate-400">暂无规则</div>}
          {visibleItems.map((rule) => (
            <div
              key={rule.id}
              className={`group cursor-pointer rounded-lg px-3 py-2.5 transition-all ${
                editingRuleId === rule.id ? "bg-orange-50 ring-1 ring-orange-200" : "hover:bg-slate-50"
              } ${rule.enabled ? "" : "opacity-50"}`}
              onClick={() => onSelectRule(rule)}
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
                  <button type="button" onClick={(e) => { e.stopPropagation(); onCopyRule(rule); }} className="rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-slate-200" title="复制">⧉</button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); onToggleRule(rule); }} className="rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-slate-200" title={rule.enabled ? "停用" : "启用"}>{rule.enabled ? "○" : "●"}</button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); onDeleteRule(rule); }} className="rounded px-1.5 py-0.5 text-[10px] text-rose-400 hover:bg-rose-100" title="删除">×</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
