import type { DefaultRule, ExportAdapter } from "@/features/exports/types";

export function FixedExportTab({
  taskIdsText,
  onTaskIdsTextChange,
  adapterKey,
  onAdapterKeyChange,
  ruleId,
  onRuleIdChange,
  exportOnlyValid,
  onExportOnlyValidChange,
  fixedErr,
  fixedDownload,
  running,
  canRun,
  onRunExport,
  adapters,
  rules,
}: {
  taskIdsText: string;
  onTaskIdsTextChange: (value: string) => void;
  adapterKey: string;
  onAdapterKeyChange: (value: string) => void;
  ruleId: number | "";
  onRuleIdChange: (value: number | "") => void;
  exportOnlyValid: boolean;
  onExportOnlyValidChange: (value: boolean) => void;
  fixedErr: string | null;
  fixedDownload: string | null;
  running: boolean;
  canRun: boolean;
  onRunExport: () => void;
  adapters: ExportAdapter[];
  rules: DefaultRule[];
}) {
  return (
    <div className="rounded-xl border bg-white p-4 space-y-3">
      <div className="text-sm text-slate-500">默认导出模板为妙手Temu非服饰导入模板，支持在下拉中切换其他导出适配器。</div>
      <textarea value={taskIdsText} onChange={(e) => onTaskIdsTextChange(e.target.value)} className="w-full h-20 border rounded p-2 font-mono text-sm" placeholder="任务ID，如 12,18,24" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <select value={adapterKey} onChange={(e) => onAdapterKeyChange(e.target.value)} className="h-10 border rounded px-2">
          {adapters.filter((x) => x.enabled).map((a) => <option key={a.adapter_key} value={a.adapter_key}>{a.display_name}</option>)}
        </select>
        <select value={ruleId} onChange={(e) => onRuleIdChange(e.target.value ? Number(e.target.value) : "")} className="h-10 border rounded px-2">
          <option value="">不套用默认值规则</option>
          {rules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <label className="h-10 border rounded px-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={exportOnlyValid} onChange={(e) => onExportOnlyValidChange(e.target.checked)} />
          只导出校验通过行
        </label>
      </div>
      {fixedErr && <div className="text-sm text-rose-600">{fixedErr}</div>}
      {fixedDownload && <a href={fixedDownload} target="_blank" rel="noreferrer" className="text-sm text-emerald-700 underline">下载导出文件</a>}
      <button type="button" disabled={!canRun || running} onClick={onRunExport} className="h-10 px-4 rounded-full bg-slate-900 text-white disabled:opacity-60">
        {running ? "导出中..." : "执行导出"}
      </button>
    </div>
  );
}
