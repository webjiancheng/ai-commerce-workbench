import type { AiImportBatch, ExportBatch } from "@/features/exports/types";
import { apiBaseUrl } from "@/lib/api";

export function ExportHistoryTab({
  history,
  aiImports,
}: {
  history: ExportBatch[];
  aiImports: AiImportBatch[];
}) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="overflow-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="text-left p-2 border-b">批次</th>
              <th className="text-left p-2 border-b">状态</th>
              <th className="text-left p-2 border-b">成功/失败</th>
              <th className="text-left p-2 border-b">文件</th>
            </tr>
          </thead>
          <tbody>
            {history.map((b) => (
              <tr key={b.id}>
                <td className="p-2 border-b">{b.batch_no}</td>
                <td className="p-2 border-b">{b.status}</td>
                <td className="p-2 border-b">{b.success_count}/{b.failed_count}</td>
                <td className="p-2 border-b">
                  {b.exported_file_path ? <a href={`${apiBaseUrl}/storage/${b.exported_file_path}`} target="_blank" rel="noreferrer" className="underline">下载</a> : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 text-xs text-slate-500">AI 导入批次：{aiImports.length}</div>
    </div>
  );
}
