import { apiBaseUrl } from "@/lib/api";
import type { AiImportBatch, AiImportDraft, DefaultRule, ExportAdapter, ExportBatch, TemplateMeta } from "@/features/exports/types";

export async function loadExportBasics(): Promise<{
  rules: DefaultRule[];
  adapters: ExportAdapter[];
  history: ExportBatch[];
  aiImports: AiImportBatch[];
  meta: TemplateMeta | null;
}> {
  const [rulesRes, adaptersRes, historyRes, importsRes, metaRes] = await Promise.all([
    fetch(`${apiBaseUrl}/api/default-rules?enabled=true&limit=200&offset=0`, { cache: "no-store" }),
    fetch(`${apiBaseUrl}/api/exports/adapters`, { cache: "no-store" }),
    fetch(`${apiBaseUrl}/api/exports/history?limit=30`, { cache: "no-store" }),
    fetch(`${apiBaseUrl}/api/exports/ai-imports?limit=20`, { cache: "no-store" }),
    fetch(`${apiBaseUrl}/api/exports/ai-imports/template-meta`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
  ]);

  const rules = rulesRes.ok ? ((((await rulesRes.json()) as { items: DefaultRule[] }).items || []).filter((x) => x.enabled)) : [];
  const adapters = adaptersRes.ok ? (((await adaptersRes.json()) as { items: ExportAdapter[] }).items || []) : [];
  const history = historyRes.ok ? ((await historyRes.json()) as ExportBatch[]) : [];
  const aiImports = importsRes.ok ? ((await importsRes.json()) as AiImportBatch[]) : [];
  const meta = metaRes.ok ? (((await metaRes.json()) as { meta: TemplateMeta }).meta || null) : null;

  return { rules, adapters, history, aiImports, meta };
}

export async function runExportApi(payload: {
  product_task_ids: number[];
  default_rule_id: number | null;
  adapter_key: string;
  export_only_valid: boolean;
}): Promise<{ download_url: string }> {
  const res = await fetch(`${apiBaseUrl}/api/exports/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { download_url: string };
}

export async function parseAiImportApi(name: string, raw_json_text: string): Promise<{ batch: AiImportBatch; draft: AiImportDraft }> {
  const res = await fetch(`${apiBaseUrl}/api/exports/ai-imports/parse`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, raw_json_text }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { batch: AiImportBatch; draft: AiImportDraft };
}

export async function saveAiDraftApi(batchId: number, draft: AiImportDraft): Promise<void> {
  const res = await fetch(`${apiBaseUrl}/api/exports/ai-imports/${batchId}/draft`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      common_fields_json: draft.common_fields_json,
      headers_json: draft.headers_json,
      rows_json: draft.rows_json,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function supplementAiDraftApi(batchId: number, defaultRuleId: number | null): Promise<AiImportDraft> {
  const res = await fetch(`${apiBaseUrl}/api/exports/ai-imports/${batchId}/supplement`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ default_rule_id: defaultRuleId }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { draft: AiImportDraft }).draft;
}

export async function exportAiDraftApi(batchId: number): Promise<{ download_url: string }> {
  const res = await fetch(`${apiBaseUrl}/api/exports/ai-imports/${batchId}/export`, { method: "POST" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { download_url: string };
}

export async function loadExportHistoryApi(): Promise<ExportBatch[]> {
  const res = await fetch(`${apiBaseUrl}/api/exports/history?limit=30`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as ExportBatch[];
}

export async function loadAiImportBatchesApi(): Promise<AiImportBatch[]> {
  const res = await fetch(`${apiBaseUrl}/api/exports/ai-imports?limit=20`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as AiImportBatch[];
}
