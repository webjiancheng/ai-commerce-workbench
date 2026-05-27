import type { AiImportDraft } from "@/features/exports/types";

export function AiImportTab({
  aiPrompt,
  aiName,
  onAiNameChange,
  rawJson,
  onRawJsonChange,
  aiErr,
  aiDraft,
  aiDownload,
  aiErrors,
  onParseAi,
  onSaveAiDraft,
  onSupplementAiDraft,
  onExportAiDraft,
  onDraftChange,
}: {
  aiPrompt: string;
  aiName: string;
  onAiNameChange: (value: string) => void;
  rawJson: string;
  onRawJsonChange: (value: string) => void;
  aiErr: string | null;
  aiDraft: AiImportDraft | null;
  aiDownload: string | null;
  aiErrors: number;
  onParseAi: () => void;
  onSaveAiDraft: () => void;
  onSupplementAiDraft: () => void;
  onExportAiDraft: () => void;
  onDraftChange: (draft: AiImportDraft) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-white p-4 space-y-2">
        <div className="text-sm font-semibold">固定提示词（外部 AI JSON）</div>
        <textarea readOnly value={aiPrompt} className="w-full h-44 border rounded p-2 font-mono text-xs bg-slate-50" />
      </div>
      <div className="rounded-xl border bg-white p-4 space-y-2">
        <input value={aiName} onChange={(e) => onAiNameChange(e.target.value)} className="w-full h-10 border rounded px-3" placeholder="导入批次名称" />
        <textarea value={rawJson} onChange={(e) => onRawJsonChange(e.target.value)} className="w-full h-44 border rounded p-2 font-mono text-xs" placeholder="粘贴外部 AI 返回 JSON" />
        {aiErr && <div className="text-sm text-rose-600">{aiErr}</div>}
        <button type="button" onClick={onParseAi} className="h-10 px-4 rounded-full bg-slate-900 text-white">解析 JSON</button>
      </div>
      {aiDraft && (
        <div className="rounded-xl border bg-white p-4 space-y-3">
          <div className="text-sm">草稿校验：错误 {aiErrors}</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {Object.entries(aiDraft.common_fields_json).map(([k, v]) => (
              <label key={k} className="text-xs">
                <div className="mb-1">{k}</div>
                <input
                  value={v || ""}
                  onChange={(e) => onDraftChange({ ...aiDraft, common_fields_json: { ...aiDraft.common_fields_json, [k]: e.target.value } })}
                  className="w-full h-9 border rounded px-2"
                />
              </label>
            ))}
          </div>
          <div className="overflow-auto border rounded">
            <table className="w-full text-xs">
              <thead><tr>{aiDraft.headers_json.map((h) => <th key={h} className="text-left p-2 border-b">{h}</th>)}</tr></thead>
              <tbody>
                {aiDraft.rows_json.slice(0, 20).map((row, i) => (
                  <tr key={i}>
                    {aiDraft.headers_json.map((h) => (
                      <td key={`${i}-${h}`} className="p-1 border-b">
                        <input
                          value={row[h] || ""}
                          onChange={(e) => {
                            const nextRows = aiDraft.rows_json.map((r, idx) => idx === i ? { ...r, [h]: e.target.value } : r);
                            onDraftChange({ ...aiDraft, rows_json: nextRows });
                          }}
                          className="w-full h-8 border rounded px-2"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onSaveAiDraft} className="h-9 px-3 rounded-full border">保存草稿</button>
            <button type="button" onClick={onSupplementAiDraft} className="h-9 px-3 rounded-full border">系统补齐</button>
            <button type="button" disabled={aiErrors > 0} onClick={onExportAiDraft} className="h-9 px-3 rounded-full bg-slate-900 text-white disabled:opacity-60">导出 Excel</button>
          </div>
          {aiDownload && <a href={aiDownload} target="_blank" rel="noreferrer" className="text-sm text-emerald-700 underline">下载 AI 导出文件</a>}
        </div>
      )}
    </div>
  );
}
