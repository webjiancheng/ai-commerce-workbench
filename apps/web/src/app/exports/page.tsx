"use client";

import { apiBaseUrl } from "@/lib/api";
import { useEffect, useMemo, useState } from "react";

type ExportBatch = {
  id: number;
  batch_no: string;
  template_id: number | null;
  template_version: string;
  total_count: number;
  success_count: number;
  failed_count: number;
  exported_file_path: string | null;
  status: string;
  created_at: string;
};

type PreviewRow = {
  product_task_id: number;
  export_fields: Record<string, unknown>;
  validation_result: { errors?: unknown[]; warnings?: unknown[] };
};

type TemplateField = { field_key: string; field_name: string; column_index: number; required: boolean };
type Mapping = {
  id: number;
  field_key: string;
  field_name: string;
  column_index: number;
  required: boolean;
  source_type: string | null;
  source_path: string | null;
  default_value: string | null;
  enabled: boolean;
};

function parseIds(text: string): number[] {
  return text
    .split(/[,\\s]+/g)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x) && x > 0);
}

export default function ExportsPage() {
  const [taskIdsText, setTaskIdsText] = useState("");
  const taskIds = useMemo(() => parseIds(taskIdsText), [taskIdsText]);

  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const [history, setHistory] = useState<ExportBatch[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [templateFields, setTemplateFields] = useState<TemplateField[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [mappingError, setMappingError] = useState<string | null>(null);

  async function loadHistory(): Promise<void> {
    setHistoryError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/exports/history?limit=30`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ExportBatch[];
      setHistory(data || []);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "加载导出历史失败");
    }
  }

  async function loadTemplateAndMappings(): Promise<void> {
    setMappingError(null);
    try {
      const fieldsRes = await fetch(`${apiBaseUrl}/api/export-template/fields`, { cache: "no-store" });
      if (!fieldsRes.ok) throw new Error(`HTTP ${fieldsRes.status}`);
      const fieldsData = (await fieldsRes.json()) as { template_id: number; fields: TemplateField[] };
      setTemplateFields(fieldsData.fields || []);

      const mapRes = await fetch(`${apiBaseUrl}/api/export-field-mappings?template_id=${fieldsData.template_id}`, {
        cache: "no-store",
      });
      if (!mapRes.ok) throw new Error(`HTTP ${mapRes.status}`);
      const mapData = (await mapRes.json()) as Mapping[];
      setMappings(mapData || []);
    } catch (err) {
      setMappingError(err instanceof Error ? err.message : "加载模板字段/映射失败");
    }
  }

  useEffect(() => {
    void loadHistory();
    void loadTemplateAndMappings();
  }, []);

  async function runPreview(): Promise<void> {
    setPreviewError(null);
    setDownloadUrl(null);
    setRunning(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/exports/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ product_task_ids: taskIds }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { rows: PreviewRow[] };
      setPreview(data.rows || []);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "预览失败");
    } finally {
      setRunning(false);
    }
  }

  async function runExport(): Promise<void> {
    setPreviewError(null);
    setDownloadUrl(null);
    setRunning(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/exports/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ product_task_ids: taskIds }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { download_url: string };
      setDownloadUrl(data.download_url || null);
      await loadHistory();
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "导出失败");
    } finally {
      setRunning(false);
    }
  }

  async function patchMapping(id: number, patch: Partial<Mapping>): Promise<void> {
    setMappingError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/export-field-mappings/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadTemplateAndMappings();
    } catch (err) {
      setMappingError(err instanceof Error ? err.message : "更新映射失败");
    }
  }

  return (
    <div className="min-h-screen px-4 py-6 md:px-6">
      <section className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-[28px] border border-[var(--card-border)] bg-[var(--card)] p-6 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="text-sm text-slate-500">导出与模板设置</div>
          <h1 className="mt-1 text-3xl font-semibold">导出中心</h1>
          <div className="mt-2 text-sm text-slate-600">先选商品，再预览校验，确认后生成 Excel。</div>
        </header>

        <div className="rounded-[24px] border border-slate-200 bg-white p-6">
          <div className="text-sm font-semibold text-slate-900">选择商品并导出</div>
          <div className="mt-3 text-sm text-slate-600">输入商品任务 ID，多个可用逗号或空格分隔。</div>
          <textarea
            value={taskIdsText}
            onChange={(e) => setTaskIdsText(e.target.value)}
            className="mt-3 h-[90px] w-full resize-none rounded-[18px] border border-slate-200 bg-white p-3 text-sm font-mono outline-none focus:border-slate-400"
            placeholder="例如：1,2,3"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void runPreview()}
              className="h-11 rounded-full border border-slate-900 bg-slate-900 px-5 text-sm font-medium text-white hover:bg-slate-800"
              disabled={!taskIds.length || running}
            >
              预览校验
            </button>
            <button
              type="button"
              onClick={() => void runExport()}
              className="h-11 rounded-full border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              disabled={!taskIds.length || running}
            >
              生成 Excel
            </button>
            <span className="text-sm text-slate-500">共 {taskIds.length} 条</span>
          </div>
          {previewError ? (
            <div className="mt-3 rounded-[18px] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              {previewError}
            </div>
          ) : null}
          {downloadUrl ? (
            <div className="mt-3 rounded-[18px] border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
              已生成：{" "}
              <a href={downloadUrl} target="_blank" rel="noreferrer" className="underline">
                下载 Excel
              </a>
            </div>
          ) : null}

          {preview.length ? (
            <div className="mt-4 overflow-hidden rounded-[18px] border border-slate-200">
              <div className="grid grid-cols-[140px_1fr_1fr] gap-0 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-700">
              <div>任务 ID</div>
              <div>错误数</div>
              <div>警告数</div>
              </div>
              <div className="divide-y divide-slate-100 bg-white">
                {preview.map((row) => (
                  <div key={row.product_task_id} className="grid grid-cols-[140px_1fr_1fr] px-4 py-3 text-sm">
                    <div className="font-mono text-xs text-slate-900">{row.product_task_id}</div>
                    <div className="text-xs text-rose-700">
                      {Array.isArray(row.validation_result?.errors) ? row.validation_result.errors.length : 0}
                    </div>
                    <div className="text-xs text-amber-700">
                      {Array.isArray(row.validation_result?.warnings) ? row.validation_result.warnings.length : 0}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">模板字段映射</div>
              <div className="mt-1 text-sm text-slate-600">用中文理解就是：每个导出列，来自哪里，默认写什么，是否启用。</div>
            </div>
            <button
              type="button"
              onClick={() => void loadTemplateAndMappings()}
              className="h-10 rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50"
            >
              刷新
            </button>
          </div>
          {mappingError ? (
            <div className="mt-3 rounded-[18px] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              {mappingError}
            </div>
          ) : null}

          <div className="mt-4 overflow-hidden rounded-[18px] border border-slate-200">
            <div className="grid grid-cols-[70px_220px_1fr_110px_140px_1fr_160px_90px] gap-0 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-700">
              <div>列号</div>
              <div>字段键</div>
              <div>字段名称</div>
              <div>必填</div>
              <div>取值方式</div>
              <div>取值路径</div>
              <div>默认值</div>
              <div>启用</div>
            </div>
            <div className="divide-y divide-slate-100 bg-white">
              {mappings.map((m) => (
                <div
                  key={m.id}
                  className="grid grid-cols-[70px_220px_1fr_110px_140px_1fr_160px_90px] items-center gap-0 px-4 py-2 text-xs"
                >
                  <div className="font-mono">{m.column_index}</div>
                  <div className="truncate font-mono">{m.field_key}</div>
                  <div className="truncate">{m.field_name}</div>
                  <div>
                    <input
                      type="checkbox"
                      checked={m.required}
                      onChange={(e) => void patchMapping(m.id, { required: e.target.checked })}
                    />
                  </div>
                  <div>
                    <select
                      value={m.source_type || ""}
                      onChange={(e) => void patchMapping(m.id, { source_type: e.target.value || null })}
                      className="h-8 w-full rounded-[10px] border border-slate-200 bg-white px-2 text-xs"
                    >
                      <option value="">未设置</option>
                      <option value="draft">草稿字段</option>
                      <option value="asset">图片资源</option>
                      <option value="task">任务字段</option>
                      <option value="fixed">固定值</option>
                    </select>
                  </div>
                  <div>
                    <input
                      value={m.source_path || ""}
                      onChange={(e) => void patchMapping(m.id, { source_path: e.target.value })}
                      className="h-8 w-full rounded-[10px] border border-slate-200 bg-white px-2 font-mono text-xs"
                      placeholder="例如 product_title_cn / carousel_1,..."
                    />
                  </div>
                  <div>
                    <input
                      value={m.default_value || ""}
                      onChange={(e) => void patchMapping(m.id, { default_value: e.target.value })}
                      className="h-8 w-full rounded-[10px] border border-slate-200 bg-white px-2 font-mono text-xs"
                      placeholder="可选"
                    />
                  </div>
                  <div>
                    <input
                      type="checkbox"
                      checked={m.enabled}
                      onChange={(e) => void patchMapping(m.id, { enabled: e.target.checked })}
                    />
                  </div>
                </div>
              ))}
              {mappings.length ? null : (
                <div className="px-4 py-4 text-sm text-slate-600">暂无 mappings</div>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-900">导出历史</div>
            <button
              type="button"
              onClick={() => void loadHistory()}
              className="h-10 rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50"
            >
              刷新
            </button>
          </div>
          {historyError ? (
            <div className="mt-3 rounded-[18px] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              {historyError}
            </div>
          ) : null}

          <div className="mt-4 space-y-3">
            {history.map((b) => (
              <div key={b.id} className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">batch {b.batch_no}</div>
                    <div className="mt-1 text-xs text-slate-600">
                      {b.status} · total={b.total_count} · success={b.success_count} · failed={b.failed_count}
                    </div>
                  </div>
                  {b.exported_file_path ? (
                    <a
                      href={`${apiBaseUrl}/storage/${b.exported_file_path}`}
                      target="_blank"
                      rel="noreferrer"
                      className="h-9 rounded-full border border-slate-200 bg-white px-4 text-xs leading-9 text-slate-700 hover:bg-slate-50"
                    >
                      下载
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
            {history.length ? null : (
              <div className="rounded-[18px] border border-slate-200 bg-white p-4 text-sm text-slate-600">
                暂无导出历史
              </div>
            )}
          </div>
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-white p-6">
          <div className="text-sm font-semibold text-slate-900">模板字段（只读）</div>
          <div className="mt-3 overflow-hidden rounded-[18px] border border-slate-200">
            <div className="grid grid-cols-[80px_240px_1fr_90px] border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-700">
              <div>列</div>
              <div>field_key</div>
              <div>field_name</div>
              <div>必填</div>
            </div>
            <div className="divide-y divide-slate-100 bg-white">
              {templateFields.map((f) => (
                <div key={f.field_key} className="grid grid-cols-[80px_240px_1fr_90px] px-4 py-2 text-xs">
                  <div className="font-mono">{f.column_index}</div>
                  <div className="truncate font-mono">{f.field_key}</div>
                  <div className="truncate">{f.field_name}</div>
                  <div>{f.required ? "✅" : ""}</div>
                </div>
              ))}
              {templateFields.length ? null : (
                <div className="px-4 py-4 text-sm text-slate-600">暂无字段</div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
