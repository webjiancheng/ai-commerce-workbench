"use client";

import { apiBaseUrl } from "@/lib/api";
import { ChangeEvent, useEffect, useMemo, useState } from "react";

/* ───────────────── types ───────────────── */
type TabKey = "fixed" | "ai" | "history";

type ExportBatch = {
  id: number;
  batch_no: string;
  export_mode: string;
  default_rule_name: string | null;
  total_count: number;
  sku_row_count: number;
  success_count: number;
  failed_count: number;
  exported_file_path: string | null;
  status: string;
  created_at: string;
};

type DefaultRule = {
  id: number;
  name: string;
  enabled: boolean;
  site: string | null;
  fulfillment_mode: string | null;
};

type ExportTemplate = {
  id: number;
  name: string;
  version: string;
  platform: string;
  template_type: string;
  file_path: string;
  header_row_index: number;
  enabled: boolean;
  is_default: boolean;
};

type AiImportBatch = {
  id: number;
  name: string;
  original_filename: string | null;
  parsed_headers_json: string[];
  parsed_rows_json: Array<Record<string, string>>;
  status: string;
  export_file_path: string | null;
  created_at: string;
};

type AiImportDraft = {
  batch_id: number;
  common_fields_json: Record<string, string>;
  headers_json: string[];
  rows_json: Array<Record<string, string>>;
  field_settings_json: Record<string, { export?: boolean }>;
  validation_result_json: { errors?: unknown[]; warnings?: unknown[] };
};

type TemplateMeta = {
  sheet_name: string;
  common_row: number;
  common_values_row: number;
  header_row: number;
  hint_row: number;
  data_start_row: number;
  common_fields: string[];
  detail_headers: string[];
  required_hints: string[];
  default_values: Record<string, string>;
};

type Mapping = {
  id: number;
  field_key: string;
  field_name: string;
  column_index: number;
  required: boolean;
  source_type: string | null;
  source_path: string | null;
  default_value: string | null;
  transform_rule_json?: Record<string, unknown> | null;
  enabled: boolean;
};

/* ───────────────── Step 指示器 ───────────────── */
const AI_STEPS = [
  { n: 1, label: "下载模板" },
  { n: 2, label: "复制提示词" },
  { n: 3, label: "粘贴AI结果" },
  { n: 4, label: "检查草稿" },
  { n: 5, label: "导出Excel" },
];

type AiStep = 1 | 2 | 3 | 4 | 5;

/* ───────────────── AI 提示词（模板元数据驱动） ───────────────── */
function buildPrompt(params?: {
  commonFields?: string[];
  detailHeaders?: string[];
  requiredHints?: string[];
  defaultValues?: string;
}): string {
  const {
    commonFields = ["经营站点", "发货仓", "类目", "运费模版", "承诺发货时效", "素材语言"],
    detailHeaders = ["商品层级", "SPU货号", "商品名称", "英文名称", "申报价格-美国站"],
    requiredHints = ["字段必填信息以 Temu 模板说明行为准。"],
    defaultValues = "默认值为空时请留空，后续由系统补齐。",
  } = params || {};

  return `你是 Temu 平台商品上传模板结构化助手。

我会给你一个 Temu 平台商品上传模板结构说明。这个说明包含公共字段、商品明细字段和字段必填提示。

你的任务：
严格按照我提供的字段结构，生成可导入系统的结构化 JSON 数据。

重要规则：

1. 字段名必须和我提供的模板字段完全一致。
2. 不允许改字段名。
3. 不允许翻译字段名。
4. 不允许合并字段。
5. 不允许删除字段。
6. 必须返回我提供的所有明细字段。
7. headers 必须包含我提供的全部商品明细字段。
8. rows 中每一行都必须包含 headers 中的所有字段。
9. 如果某个字段在示例中为空，返回空字符串 ""。
10. 所有字段值都以字符串形式返回。
11. 不要推测图片、视频、详情图文相关字段。
12. 以下字段如果存在，请保留字段名，但字段值统一返回空字符串：
   - SKU预览图-英语
   - 商品轮播图1-英语
   - 商品轮播图2-英语
   - 商品轮播图3-英语
   - 商品轮播图4-英语
   - 商品轮播图5-英语
   - 商品轮播图6-英语
   - 商品轮播图7-英语
   - 商品轮播图8-英语
   - 商品轮播图9-英语
   - 商品轮播图10-英语
   - 详情图文-英语
   - SPU主图视频
   - SPU详情视频
13. 如果模板里还有其他图片、视频、详情图文字段，也只保留字段名，字段值返回空字符串。
14. 不要自行补充模板里没有的字段。
15. 不要返回解释文字。
16. 不要使用 Markdown。
17. 不要把 JSON 包在代码块里。
18. 只返回一个合法 JSON 对象。

模板公共字段（common_fields）：
${commonFields.join("、")}

模板商品明细字段（headers，顺序保持一致）：
${detailHeaders.join("、")}

字段必填/条件必填提示：
${requiredHints.join("\n")}

当前默认值参考（可留空，系统会二次补齐）：
${defaultValues}

返回格式必须严格如下：

{
  "version": "1.0",
  "source": "external_ai_temu_template",
  "sheet_name": "",
  "common_fields": {
    "经营站点": "",
    "发货仓": "",
    "类目": "",
    "运费模版": "",
    "承诺发货时效": "",
    "素材语言": ""
  },
  "headers": [],
  "rows": [],
  "warnings": []
}

字段说明：

1. version 固定返回 "1.0"。
2. source 固定返回 "external_ai_temu_template"。
3. sheet_name 返回模板工作表名称；如果无法判断，返回空字符串。
4. common_fields 返回模板顶部公共字段。
5. headers 返回我提供的所有商品明细字段名，顺序必须保持一致。
6. rows 返回商品明细行数据。
7. warnings 返回你发现的问题；没有问题返回空数组 []。

处理 rows 时必须遵守：

1. 每一行都必须是一个 JSON 对象。
2. 每一行的 key 必须和 headers 中的字段名一致。
3. 如果 headers 中有字段，但该行没有值，填 ""。
4. 如果有多行商品或 SKU，就按实际行数返回多行。
5. 不要把 common_fields 混入 rows。
6. 不要把说明文字、字段注释、表头备注放进 rows。
7. 不要返回 Excel 单元格坐标。
8. 不要返回公式。
9. 不要返回图片文件本身。
10. 不要返回视频文件本身。

现在请根据我提供的 Temu 模板字段结构，返回结构化 JSON。`;
}

/* ───────────────── utils ───────────────── */
function parseIds(text: string): number[] {
  return text.split(/[,\s]+/g).map((p) => Number(p.trim())).filter((v) => Number.isFinite(v) && v > 0);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function getAiStep(batch: AiImportBatch | null): AiStep {
  if (!batch) return 1;
  if (batch.status === "exported" && batch.export_file_path) return 5;
  if (batch.status === "confirmed" || batch.status === "exported") return 4;
  return 3;
}

function sourceBadge(source?: string): { label: string; cls: string } {
  switch ((source || "").toLowerCase()) {
    case "rule":
      return { label: "默认值", cls: "bg-slate-100 text-slate-700" };
    case "task":
      return { label: "任务", cls: "bg-emerald-100 text-emerald-700" };
    case "asset":
      return { label: "资产", cls: "bg-violet-100 text-violet-700" };
    case "manual":
    case "manual_override":
      return { label: "人工", cls: "bg-amber-100 text-amber-700" };
    case "default":
      return { label: "系统", cls: "bg-blue-100 text-blue-700" };
    default:
      return { label: "AI", cls: "bg-sky-100 text-sky-700" };
  }
}

/* ───────────────── component ───────────────── */
export default function ExportsPage() {
  const [tab, setTab] = useState<TabKey>("fixed");
  const [taskIdsText, setTaskIdsText] = useState("");
  const taskIds = useMemo(() => parseIds(taskIdsText), [taskIdsText]);
  const [selectedRuleId, setSelectedRuleId] = useState<number | "">("");
  const [defaultRules, setDefaultRules] = useState<DefaultRule[]>([]);
  const [exportTemplates, setExportTemplates] = useState<ExportTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | "">("");
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [runningFixed, setRunningFixed] = useState(false);
  const [fixedError, setFixedError] = useState<string | null>(null);
  const [fixedDownloadUrl, setFixedDownloadUrl] = useState<string | null>(null);
  const [history, setHistory] = useState<ExportBatch[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [aiImports, setAiImports] = useState<AiImportBatch[]>([]);

  // AI 导入专用
  const [templateFilePath, setTemplateFilePath] = useState<string | null>(null);
  const [originalFilename, setOriginalFilename] = useState<string | null>(null);
  const [aiImportName, setAiImportName] = useState("Temu AI 模板导入");
  const [rawJsonText, setRawJsonText] = useState("");
  const [aiBatch, setAiBatch] = useState<AiImportBatch | null>(null);
  const [aiDraft, setAiDraft] = useState<AiImportDraft | null>(null);
  const [uploadingTemplate, setUploadingTemplate] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [aiDownloadUrl, setAiDownloadUrl] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [newHeader, setNewHeader] = useState("");
  const [batchFillValue, setBatchFillValue] = useState("");
  const [batchFillHeader, setBatchFillHeader] = useState("");
  const [dragHeaderIndex, setDragHeaderIndex] = useState<number | null>(null);

  // AI 步骤内切换
  const [aiSubView, setAiSubView] = useState<"input" | "table">("input");
  const [supplementingDraft, setSupplementingDraft] = useState(false);
  const [supplementTaskIdsText, setSupplementTaskIdsText] = useState("");
  const [supplementResult, setSupplementResult] = useState<{
    filled_count: number;
    rule_name: string;
    sources: Record<string, string>;
  } | null>(null);

  /* ─────────── load data ─────────── */
  async function loadDefaultRules(): Promise<void> {
    try {
      const res = await fetch(`${apiBaseUrl}/api/default-rules?enabled=true&limit=200&offset=0`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { items: DefaultRule[] };
      setDefaultRules((data.items || []).filter((item) => item.enabled));
    } catch { setDefaultRules([]); }
  }

  async function loadHistory(): Promise<void> {
    setHistoryError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/exports/history?limit=30`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setHistory((await res.json()) as ExportBatch[]);
    } catch (err) { setHistoryError(err instanceof Error ? err.message : "加载历史失败"); }
  }

  async function loadTemplates(): Promise<number | null> {
    setTemplateError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/export-templates`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ExportTemplate[];
      const enabledTemplates = data.filter((item) => item.enabled);
      setExportTemplates(enabledTemplates);
      const current = enabledTemplates.find((item) => item.id === selectedTemplateId) || enabledTemplates.find((item) => item.is_default) || enabledTemplates[0] || null;
      setSelectedTemplateId(current ? current.id : "");
      return current ? current.id : null;
    } catch (err) {
      setExportTemplates([]);
      setTemplateError(err instanceof Error ? err.message : "加载模板失败");
      return null;
    }
  }

  async function loadMappings(templateId?: number | null): Promise<void> {
    setMappingError(null);
    try {
      const tid = templateId ?? (selectedTemplateId === "" ? null : selectedTemplateId);
      if (!tid) { setMappings([]); return; }
      const res = await fetch(`${apiBaseUrl}/api/export-field-mappings?template_id=${tid}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMappings((await res.json()) as Mapping[]);
    } catch (err) { setMappingError(err instanceof Error ? err.message : "加载映射失败"); }
  }

  async function loadAiImports(): Promise<void> {
    try {
      const res = await fetch(`${apiBaseUrl}/api/exports/ai-imports?limit=20`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAiImports((await res.json()) as AiImportBatch[]);
    } catch { setAiImports([]); }
  }

  // Template download for AI step 1 (reuse export_templates)
  const [aiTemplateId, setAiTemplateId] = useState<number | "">("");
  const [templateDownloadUrl, setTemplateDownloadUrl] = useState<string | null>(null);
  const [templateDownloadName, setTemplateDownloadName] = useState<string | null>(null);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [templateDownloadError, setTemplateDownloadError] = useState<string | null>(null);
  const [templateMeta, setTemplateMeta] = useState<TemplateMeta | null>(null);

  async function downloadTemplateExcel(): Promise<void> {
    if (aiTemplateId === "") return;
    setDownloadingTemplate(true);
    setTemplateDownloadError(null);
    setTemplateDownloadUrl(null);
    try {
      const tmpl = exportTemplates.find((t) => t.id === aiTemplateId);
      if (!tmpl) throw new Error("未找到导出模板");
      setTemplateDownloadUrl(`${apiBaseUrl}/storage/${tmpl.file_path}`);
      setTemplateDownloadName(`${tmpl.name}.xlsx`);
    } catch (err) { setTemplateDownloadError(err instanceof Error ? err.message : "下载模板失败"); }
    finally { setDownloadingTemplate(false); }
  }

  /* ─────────── fixed export ─────────── */
  async function runExport(): Promise<void> {
    if (!taskIds.length) return;
    setFixedError(null);
    setFixedDownloadUrl(null);
    setRunningFixed(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/exports/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ product_task_ids: taskIds, template_id: selectedTemplateId === "" ? null : selectedTemplateId, default_rule_id: selectedRuleId === "" ? null : selectedRuleId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { download_url: string };
      setFixedDownloadUrl(data.download_url || null);
      await loadHistory();
      setTab("history");
    } catch (err) { setFixedError(err instanceof Error ? err.message : "导出失败"); }
    finally { setRunningFixed(false); }
  }

  async function patchMapping(id: number, patch: Partial<Mapping>): Promise<void> {
    try {
      const res = await fetch(`${apiBaseUrl}/api/export-field-mappings/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadMappings();
    } catch (err) { setMappingError(err instanceof Error ? err.message : "更新映射失败"); }
  }

  /* ─────────── AI import ─────────── */
  async function uploadTemplate(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadingTemplate(true);
    setAiError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${apiBaseUrl}/api/exports/ai-imports/upload-template`, { method: "POST", body: formData });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { template_file_path: string; original_filename: string };
      setTemplateFilePath(data.template_file_path);
      setOriginalFilename(data.original_filename);
      const metaRes = await fetch(`${apiBaseUrl}/api/exports/ai-imports/template-meta`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ template_file_path: data.template_file_path }),
      });
      if (metaRes.ok) {
        const metaData = (await metaRes.json()) as { meta: TemplateMeta };
        setTemplateMeta(metaData.meta);
      } else {
        setTemplateMeta(null);
      }
    } catch (err) { setAiError(err instanceof Error ? err.message : "上传模板失败"); }
    finally { setUploadingTemplate(false); }
  }

  async function parseAiJson(): Promise<void> {
    if (!rawJsonText.trim()) return setAiError("请先粘贴外部 AI 返回的 JSON");
    setAiError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/exports/ai-imports/parse`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: aiImportName, raw_json_text: rawJsonText, template_file_path: templateFilePath, original_filename: originalFilename }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { batch: AiImportBatch; draft: AiImportDraft };
      setAiBatch(data.batch);
      setAiDraft(data.draft);
      setAiSubView("table");
      await loadAiImports();
    } catch (err) { setAiError(err instanceof Error ? err.message : "解析失败"); }
  }

  async function saveAiDraft(): Promise<void> {
    if (!aiBatch || !aiDraft) return;
    setSavingDraft(true);
    setAiError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/exports/ai-imports/${aiBatch.id}/draft`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          common_fields_json: aiDraft.common_fields_json,
          headers_json: aiDraft.headers_json,
          rows_json: aiDraft.rows_json,
          field_settings_json: aiDraft.field_settings_json,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { batch: AiImportBatch; draft: AiImportDraft };
      setAiBatch(data.batch);
      setAiDraft(data.draft);
      await loadAiImports();
    } catch (err) { setAiError(err instanceof Error ? err.message : "保存草稿失败"); }
    finally { setSavingDraft(false); }
  }

  async function exportAiDraft(): Promise<void> {
    if (!aiBatch) return;
    if (!templateFilePath) {
      setAiError("请先上传 Temu 官方模板文件，再执行导出。");
      return;
    }
    setAiError(null);
    setAiDownloadUrl(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/exports/ai-imports/${aiBatch.id}/export`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { download_url: string };
      setAiDownloadUrl(data.download_url || null);
      await loadAiImports();
      setTab("history");
    } catch (err) { setAiError(err instanceof Error ? err.message : "导出失败"); }
  }

  async function supplementDraft(): Promise<void> {
    if (!aiBatch) return;
    setSupplementingDraft(true);
    setAiError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/exports/ai-imports/${aiBatch.id}/supplement`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          default_rule_id: selectedRuleId === "" ? null : selectedRuleId,
          product_task_ids: parseIds(supplementTaskIdsText),
          selected_template_id: aiTemplateId === "" ? null : aiTemplateId,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { draft: AiImportDraft };
      setAiDraft(data.draft);
      // 统计补齐情况
      const headers = data.draft.headers_json as string[];
      const rows = data.draft.rows_json as Array<Record<string, string>>;
      const sources = data.draft.field_settings_json as Record<string, { source?: string }>;
      const ruleName = defaultRules.find((r) => r.id === selectedRuleId)?.name || "系统默认值";
      let filledCount = 0;
      for (const h of headers) {
        if (sources[h]?.source !== "external_ai" && sources[h]?.source !== "existing") {
          const hasValue = rows.some((row) => (row[h] || "").trim());
          if (hasValue) filledCount++;
        }
      }
      setSupplementResult({ filled_count: filledCount, rule_name: ruleName, sources: {} });
      setAiSubView("table");
    } catch (err) { setAiError(err instanceof Error ? err.message : "补齐失败"); }
    finally { setSupplementingDraft(false); }
  }

  function updateCommonField(key: string, value: string): void {
    if (!aiDraft) return;
    setAiDraft({ ...aiDraft, common_fields_json: { ...aiDraft.common_fields_json, [key]: value } });
  }

  function renameHeader(index: number, nextName: string): void {
    if (!aiDraft) return;
    const currentName = aiDraft.headers_json[index];
    const trimmed = nextName.trim();
    if (!trimmed || trimmed === currentName) return;
    const nextHeaders = [...aiDraft.headers_json];
    nextHeaders[index] = trimmed;
    const nextRows = aiDraft.rows_json.map((row) => {
      const nextRow = { ...row };
      nextRow[trimmed] = nextRow[currentName] || "";
      delete nextRow[currentName];
      return nextRow;
    });
    const nextFieldSettings = { ...aiDraft.field_settings_json };
    nextFieldSettings[trimmed] = nextFieldSettings[currentName] || { export: true };
    delete nextFieldSettings[currentName];
    setAiDraft({ ...aiDraft, headers_json: nextHeaders, rows_json: nextRows, field_settings_json: nextFieldSettings });
  }

  function removeHeader(index: number): void {
    if (!aiDraft) return;
    const header = aiDraft.headers_json[index];
    setAiDraft({
      ...aiDraft,
      headers_json: aiDraft.headers_json.filter((_, i) => i !== index),
      rows_json: aiDraft.rows_json.map((row) => { const next = { ...row }; delete next[header]; return next; }),
      field_settings_json: Object.fromEntries(Object.entries(aiDraft.field_settings_json).filter(([k]) => k !== header)),
    });
  }

  function addHeader(): void {
    if (!aiDraft) return;
    const trimmed = newHeader.trim();
    if (!trimmed || aiDraft.headers_json.includes(trimmed)) return;
    setAiDraft({
      ...aiDraft,
      headers_json: [...aiDraft.headers_json, trimmed],
      rows_json: aiDraft.rows_json.map((row) => ({ ...row, [trimmed]: "" })),
      field_settings_json: { ...aiDraft.field_settings_json, [trimmed]: { export: true } },
    });
    setNewHeader("");
  }

  function updateCell(rowIndex: number, header: string, value: string): void {
    if (!aiDraft) return;
    setAiDraft({ ...aiDraft, rows_json: aiDraft.rows_json.map((row, i) => i === rowIndex ? { ...row, [header]: value } : row) });
  }

  function moveHeader(index: number, dir: -1 | 1): void {
    if (!aiDraft) return;
    const target = index + dir;
    if (target < 0 || target >= aiDraft.headers_json.length) return;
    const next = [...aiDraft.headers_json];
    [next[index], next[target]] = [next[target], next[index]];
    setAiDraft({ ...aiDraft, headers_json: next });
  }

  function reorderHeader(from: number, to: number): void {
    if (!aiDraft || from === to || from < 0 || to < 0 || from >= aiDraft.headers_json.length || to >= aiDraft.headers_json.length) return;
    const next = [...aiDraft.headers_json];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setAiDraft({ ...aiDraft, headers_json: next });
  }

  function addRow(): void {
    if (!aiDraft) return;
    const newRow: Record<string, string> = {};
    for (const h of aiDraft.headers_json) newRow[h] = "";
    setAiDraft({ ...aiDraft, rows_json: [...aiDraft.rows_json, newRow] });
  }

  function removeRow(index: number): void {
    if (!aiDraft) return;
    setAiDraft({ ...aiDraft, rows_json: aiDraft.rows_json.filter((_, i) => i !== index) });
  }

  async function copyPrompt(): Promise<void> {
    try {
      await navigator.clipboard.writeText(buildPrompt());
    } catch { setAiError("复制失败，请手动复制"); }
  }

  function getExtraHeaderCandidates(): string[] {
    if (!aiDraft) return [];
    const warnings = Array.isArray(aiDraft.validation_result_json?.warnings) ? aiDraft.validation_result_json.warnings as Array<Record<string, unknown>> : [];
    const candidates = new Set<string>();
    for (const w of warnings) {
      const extraFields = w?.extra_fields;
      if (Array.isArray(extraFields)) {
        for (const field of extraFields) {
          const name = String(field || "").trim();
          if (name && !aiDraft.headers_json.includes(name)) candidates.add(name);
        }
      }
    }
    return Array.from(candidates);
  }

  function addExtraHeaders(): void {
    if (!aiDraft) return;
    const candidates = getExtraHeaderCandidates();
    if (!candidates.length) return;
    setAiDraft({
      ...aiDraft,
      headers_json: [...aiDraft.headers_json, ...candidates],
      rows_json: aiDraft.rows_json.map((row) => { const next = { ...row }; for (const h of candidates) next[h] = next[h] || ""; return next; }),
      field_settings_json: { ...aiDraft.field_settings_json, ...Object.fromEntries(candidates.map((h) => [h, { export: true }])) },
    });
  }

  function batchFillColumn(): void {
    if (!aiDraft || !batchFillHeader) return;
    setAiDraft({ ...aiDraft, rows_json: aiDraft.rows_json.map((row) => ({ ...row, [batchFillHeader]: batchFillValue })) });
  }

  function batchClearColumn(header: string): void {
    if (!aiDraft) return;
    setAiDraft({ ...aiDraft, rows_json: aiDraft.rows_json.map((row) => ({ ...row, [header]: "" })) });
  }

  function getAssetOutputMode(m: Mapping): "url" | "asset_id" {
    return String(m.transform_rule_json?.asset_output || "url").trim().toLowerCase() === "asset_id" ? "asset_id" : "url";
  }

  function updateAssetOutputMode(m: Mapping, mode: "url" | "asset_id"): void {
    void patchMapping(m.id, { transform_rule_json: { ...(m.transform_rule_json || {}), asset_output: mode } });
  }

  const currentAiStep = getAiStep(aiBatch);
  const defaultValuesText = useMemo(() => {
    if (!templateMeta) return undefined;
    const entries = Object.entries(templateMeta.default_values || {}).filter(([_, v]) => String(v || "").trim());
    if (!entries.length) return undefined;
    return entries.map(([k, v]) => `${k}=${v}`).join(" / ");
  }, [templateMeta]);

  const aiPrompt = buildPrompt({
    commonFields: templateMeta?.common_fields,
    detailHeaders: templateMeta?.detail_headers,
    requiredHints: templateMeta?.required_hints,
    defaultValues: defaultValuesText,
  });

  const errorsCount = Array.isArray(aiDraft?.validation_result_json?.errors) ? (aiDraft.validation_result_json.errors as unknown[]).length : 0;
  const warningsCount = Array.isArray(aiDraft?.validation_result_json?.warnings) ? (aiDraft.validation_result_json.warnings as unknown[]).length : 0;
  const issueErrors = useMemo(() => {
    if (!Array.isArray(aiDraft?.validation_result_json?.errors)) return [] as Array<Record<string, unknown>>;
    return aiDraft.validation_result_json.errors as Array<Record<string, unknown>>;
  }, [aiDraft]);
  const issueWarnings = useMemo(() => {
    if (!Array.isArray(aiDraft?.validation_result_json?.warnings)) return [] as Array<Record<string, unknown>>;
    return aiDraft.validation_result_json.warnings as Array<Record<string, unknown>>;
  }, [aiDraft]);

  /* ─────────── render ─────────── */
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50">

      {/* ── Header ── */}
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5 py-3 shadow-sm">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-sky-600">Export Center</div>
          <div className="text-base font-bold text-slate-950">导出中心</div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex gap-4 text-xs text-slate-500">
            <span>历史 <strong className="text-slate-800">{history.length}</strong></span>
            <span>规则 <strong className="text-slate-800">{defaultRules.length}</strong></span>
            <span>AI批次 <strong className="text-slate-800">{aiImports.length}</strong></span>
          </div>
        </div>
      </header>

      {/* ── Tab Bar ── */}
      <div className="flex shrink-0 items-center gap-1 border-b border-slate-200 bg-white px-5 py-2">
        {[{ key: "fixed" as const, label: "固定规则导出" }, { key: "ai" as const, label: "AI填表导入" }, { key: "history" as const, label: "导出历史" }].map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`h-9 rounded-full px-5 text-sm font-medium transition-all ${tab === item.key ? "bg-slate-950 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50"}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* ── Body ── */}
      <div className="flex min-h-0 flex-1">

        {/* ══════════════ 固定规则导出 ══════════════ */}
        {tab === "fixed" && (
          <>
            {/* 左：配置区 */}
            <div className="flex w-[400px] shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-white px-4 py-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
                <span>📤</span> 固定规则导出
              </div>
              <div className="space-y-3">
                <label className="space-y-1">
                  <div className="text-xs font-medium text-slate-500">商品任务 ID（逗号分隔）</div>
                  <textarea
                    value={taskIdsText}
                    onChange={(e) => setTaskIdsText(e.target.value)}
                    className="h-20 w-full resize-none rounded-xl border border-slate-200 p-2.5 text-sm font-mono outline-none focus:border-slate-400"
                    placeholder="12, 18, 24"
                  />
                </label>
                <label className="space-y-1">
                  <div className="text-xs font-medium text-slate-500">导出模板</div>
                  <select
                    value={selectedTemplateId}
                    onChange={(e) => { const n = e.target.value ? Number(e.target.value) : ""; setSelectedTemplateId(n); void loadMappings(n === "" ? null : n); }}
                    className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
                  >
                    <option value="">请选择模板</option>
                    {exportTemplates.map((t) => <option key={t.id} value={t.id}>{t.name} {t.is_default ? "· 默认" : ""}</option>)}
                  </select>
                </label>
                <label className="space-y-1">
                  <div className="text-xs font-medium text-slate-500">默认值规则</div>
                  <select
                    value={selectedRuleId}
                    onChange={(e) => setSelectedRuleId(e.target.value ? Number(e.target.value) : "")}
                    className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
                  >
                    <option value="">全局规则 / 当前草稿</option>
                    {defaultRules.map((r) => <option key={r.id} value={r.id}>{r.name} {r.site ? `· ${r.site}` : ""}</option>)}
                  </select>
                </label>
                {fixedError && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{fixedError}</div>}
                {fixedDownloadUrl && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                    文件已生成 <a href={fixedDownloadUrl} target="_blank" rel="noreferrer" className="ml-1 underline">下载</a>
                  </div>
                )}
                <div className="flex gap-2">
                  <button type="button" onClick={() => void runExport()} disabled={!taskIds.length || runningFixed}
                    className="h-10 flex-1 rounded-full bg-slate-950 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
                    {runningFixed ? "生成中..." : "导出 Excel"}
                  </button>
                </div>
              </div>

              {/* AI 快捷入口 */}
              <div className="mt-6 rounded-xl border border-dashed border-slate-200 p-4">
                <div className="text-xs font-semibold text-slate-600">需要 AI 辅助填表？</div>
                <button type="button" onClick={() => setTab("ai")}
                  className="mt-2 h-9 w-full rounded-full border border-blue-200 bg-blue-50 text-sm font-medium text-blue-700 hover:bg-blue-100">
                  切换到 AI 填表导入
                </button>
              </div>
            </div>

            {/* 中：字段映射 */}
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <span>🗺️</span> 字段映射
                  <span className="text-xs font-normal text-slate-400">{mappings.length} 个字段</span>
                </div>
                <button type="button" onClick={() => void loadMappings()} className="h-8 rounded-full border border-slate-200 px-3 text-xs text-slate-500 hover:bg-slate-50">
                  刷新
                </button>
              </div>
              {mappingError && <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{mappingError}</div>}
              <div className="flex-1 overflow-auto rounded-xl border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-100 text-slate-600">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">#</th>
                      <th className="px-3 py-2 text-left font-semibold">字段</th>
                      <th className="px-3 py-2 text-left font-semibold">取值方式</th>
                      <th className="px-3 py-2 text-left font-semibold">资源输出</th>
                      <th className="px-3 py-2 text-left font-semibold">取值路径</th>
                      <th className="px-3 py-2 text-left font-semibold">默认值</th>
                      <th className="px-3 py-2 text-center font-semibold">启用</th>
                      <th className="px-3 py-2 text-center font-semibold">必填</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {mappings.map((m) => (
                      <tr key={m.id} className="hover:bg-slate-50">
                        <td className="px-3 py-1.5 font-mono text-slate-400">{m.column_index}</td>
                        <td className="px-3 py-1.5">
                          <div className="font-medium text-slate-800">{m.field_key}</div>
                          <div className="text-slate-400">{m.field_name}</div>
                        </td>
                        <td className="px-3 py-1.5">
                          <select value={m.source_type || ""} onChange={(e) => void patchMapping(m.id, { source_type: e.target.value || null })}
                            className="h-7 w-full rounded-lg border border-slate-200 px-1.5 text-xs outline-none focus:border-slate-400">
                            <option value="">未设置</option>
                            <option value="draft">草稿</option>
                            <option value="asset">资源</option>
                            <option value="task">任务</option>
                            <option value="fixed">固定值</option>
                          </select>
                        </td>
                        <td className="px-3 py-1.5">
                          <select value={getAssetOutputMode(m)} onChange={(e) => updateAssetOutputMode(m, e.target.value === "asset_id" ? "asset_id" : "url")}
                            disabled={m.source_type !== "asset"}
                            className="h-7 w-full rounded-lg border border-slate-200 px-1.5 text-xs outline-none disabled:bg-slate-100">
                            <option value="url">URL</option>
                            <option value="asset_id">Asset ID</option>
                          </select>
                        </td>
                        <td className="px-3 py-1.5">
                          <input value={m.source_path || ""} onChange={(e) => void patchMapping(m.id, { source_path: e.target.value })} className="h-7 w-full rounded-lg border border-slate-200 px-1.5 text-xs font-mono outline-none focus:border-slate-400" />
                        </td>
                        <td className="px-3 py-1.5">
                          <input value={m.default_value || ""} onChange={(e) => void patchMapping(m.id, { default_value: e.target.value })} className="h-7 w-full rounded-lg border border-slate-200 px-1.5 text-xs font-mono outline-none focus:border-slate-400" />
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          <input type="checkbox" checked={m.enabled} onChange={(e) => void patchMapping(m.id, { enabled: e.target.checked })} />
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          <input type="checkbox" checked={m.required} onChange={(e) => void patchMapping(m.id, { required: e.target.checked })} />
                        </td>
                      </tr>
                    ))}
                    {!mappings.length && (
                      <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">选择模板后自动加载字段映射</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 右：历史 */}
            <div className="flex w-[280px] shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white px-4 py-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <span>📋</span> 导出历史
                </div>
                <button type="button" onClick={() => void loadHistory()} className="text-xs text-slate-400 hover:text-slate-600">刷新</button>
              </div>
              {historyError && <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{historyError}</div>}
              <div className="space-y-2">
                {history.map((b) => (
                  <div key={b.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs font-semibold text-slate-800">{b.batch_no}</div>
                    <div className="mt-1 text-[10px] text-slate-500">
                      {b.export_mode} · 商品 {b.total_count} · SKU {b.sku_row_count}
                    </div>
                    <div className="mt-1 text-[10px] text-slate-400">
                      成功 {b.success_count} · 失败 {b.failed_count}
                    </div>
                    {b.exported_file_path && (
                      <a href={`${apiBaseUrl}/storage/${b.exported_file_path}`} target="_blank" rel="noreferrer"
                        className="mt-2 inline-flex h-7 items-center gap-1 rounded-full border border-slate-200 bg-white px-3 text-xs text-slate-600 hover:bg-slate-50">
                        📥 下载
                      </a>
                    )}
                  </div>
                ))}
                {!history.length && <div className="py-6 text-center text-xs text-slate-400">暂无历史</div>}
              </div>
            </div>
          </>
        )}

        {/* ══════════════ AI 填表导入 ══════════════ */}
        {tab === "ai" && (
          <>
            {/* 左：步骤面板 280px */}
            <div className="flex w-[280px] shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-white px-4 py-4">
              <div className="mb-4 text-sm font-semibold text-slate-800">📥 AI 填表导入</div>
              <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-medium text-slate-600">当前批次</div>
                {aiBatch ? (
                  <div className="mt-1">
                    <div className="text-sm font-semibold text-slate-800">#{aiBatch.id} · {aiBatch.name}</div>
                    <div className="text-[10px] text-slate-400">状态：{aiBatch.status}</div>
                    {aiBatch.original_filename && <div className="text-[10px] text-slate-400">模板：{aiBatch.original_filename}</div>}
                  </div>
                ) : (
                  <div className="mt-1 text-xs text-slate-400">尚未生成草稿</div>
                )}
              </div>

              {/* 步骤指示 */}
              <div className="space-y-1">
                {AI_STEPS.map((step) => {
                  const isActive = step.n === currentAiStep;
                  const isPast = step.n < currentAiStep;
                  return (
                    <div key={step.n} className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs ${isActive ? "bg-orange-50 ring-1 ring-orange-200" : isPast ? "bg-emerald-50 text-emerald-700" : "bg-slate-50 text-slate-400"}`}>
                      <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${isActive ? "bg-orange-500 text-white" : isPast ? "bg-emerald-500 text-white" : "bg-slate-300 text-white"}`}>
                        {isPast ? "✓" : step.n}
                      </div>
                      <span className={isActive ? "font-semibold text-orange-700" : ""}>{step.label}</span>
                    </div>
                  );
                })}
              </div>

              {/* 当前选中规则信息 */}
              {selectedRuleId !== "" && (
                <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3">
                  <div className="text-xs font-medium text-blue-700">应用默认值规则</div>
                  <div className="mt-1 text-xs font-semibold text-blue-800">{defaultRules.find((r) => r.id === selectedRuleId)?.name || `#${selectedRuleId}`}</div>
                </div>
              )}
            </div>

            {/* 中：主操作区 */}
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">
              <div className="mb-4 flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-800">
                  {aiSubView === "input" ? "步骤 1-3：下载模板 → 复制提示词 → 粘贴 AI 结果" : "步骤 4：检查并修正草稿"}
                </div>
                <div className="flex gap-2">
                  {aiBatch && (
                    <button type="button" onClick={() => setAiSubView("input")} className="h-8 rounded-full border border-slate-200 px-3 text-xs text-slate-500 hover:bg-slate-50">
                      返回输入
                    </button>
                  )}
                  {aiDraft && (
                    <button type="button" onClick={() => setAiSubView("table")} className="h-8 rounded-full border border-slate-200 px-3 text-xs text-slate-500 hover:bg-slate-50">
                      查看草稿
                    </button>
                  )}
                </div>
              </div>

              {/* ── 输入视图 ── */}
              {aiSubView === "input" && (
                <div className="space-y-4">
                  {/* 步骤1：下载模板 */}
                  <div className="rounded-xl border border-slate-200 bg-white">
                    <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white">1</span>
                      <span className="text-sm font-semibold text-slate-800">下载类目模板</span>
                    </div>
                    <div className="p-4 space-y-4">
                      {/* A：从 listing_template 下载字段配置 */}
                      <div>
                        <div className="mb-2 text-xs font-medium text-slate-600">
                          A. 从系统上架模板下载（仅字段参考）：用于查看分层字段与默认值
                        </div>
                        <div className="flex gap-2">
                          <select
                            value={aiTemplateId}
                            onChange={(e) => { setAiTemplateId(e.target.value ? Number(e.target.value) : ""); setTemplateDownloadUrl(null); }}
                            className="h-9 flex-1 rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-slate-400"
                          >
                            <option value="">选择导出模板</option>
                            {exportTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                          <button
                            type="button"
                            onClick={() => void downloadTemplateExcel()}
                            disabled={aiTemplateId === "" || downloadingTemplate}
                            className="h-9 rounded-full bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                          >
                            {downloadingTemplate ? "生成中..." : "下载字段表"}
                          </button>
                        </div>
                        {templateDownloadError && <div className="mt-2 text-xs text-rose-600">{templateDownloadError}</div>}
                        {templateDownloadUrl && (
                          <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2">
                            <span className="text-xs text-emerald-700">✅ {templateDownloadName}</span>
                            <a href={templateDownloadUrl} target="_blank" rel="noreferrer" className="ml-auto text-xs font-semibold text-blue-600 underline">下载 Excel</a>
                          </div>
                        )}
                      </div>
                      <div className="relative flex items-center gap-3">
                        <div className="flex-1 border-t border-slate-300" />
                        <span className="text-[10px] text-slate-400">或</span>
                        <div className="flex-1 border-t border-slate-300" />
                      </div>
                      {/* B：上传 Temu 原模板 */}
                      <div>
                        <div className="mb-2 text-xs font-medium text-slate-600">
                          B. 上传 Temu 官方模板文件（导出必需）：提取真实字段结构并用于最终写回导出
                        </div>
                        <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-600 hover:bg-slate-50">
                          <span>📁 上传 Temu 原模板</span>
                          <input type="file" accept=".xlsx,.xls,.xlsm" onChange={(e) => void uploadTemplate(e)} className="hidden" />
                        </label>
                        {uploadingTemplate && <span className="ml-3 text-xs text-slate-400">上传中...</span>}
                        {originalFilename && <span className="ml-3 text-xs text-emerald-600">✅ {originalFilename}</span>}
                      </div>
                    </div>
                  </div>

                  {/* 步骤2：复制提示词 */}
                  <div className="rounded-xl border border-slate-200 bg-white">
                    <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white">2</span>
                      <span className="text-sm font-semibold text-slate-800">复制提示词给外部 AI</span>
                      <button type="button" onClick={() => void copyPrompt()} className="ml-auto h-7 rounded-full border border-orange-200 bg-orange-50 px-3 text-xs font-medium text-orange-700 hover:bg-orange-100">
                        一键复制
                      </button>
                    </div>
                    <div className="p-4">
                      <textarea readOnly value={aiPrompt} className="h-[280px] w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-mono outline-none" />
                      <div className="mt-2 text-[10px] text-slate-400">
                        提示：复制后粘贴给 ChatGPT / Claude / 其他 AI，将返回的 JSON 粘贴到下方。
                        系统会二次补齐默认值，AI 不确定时应留空。
                      </div>
                    </div>
                  </div>

                  {/* 步骤3：粘贴 AI 结果 */}
                  <div className="rounded-xl border border-slate-200 bg-white">
                    <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white">3</span>
                      <span className="text-sm font-semibold text-slate-800">粘贴外部 AI 返回的 JSON</span>
                    </div>
                    <div className="p-4 space-y-3">
                      <label className="space-y-1">
                        <div className="text-xs text-slate-500">导入名称</div>
                        <input value={aiImportName} onChange={(e) => setAiImportName(e.target.value)} className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400" />
                      </label>
                      <label className="space-y-1">
                        <div className="text-xs text-slate-500">粘贴 JSON（只粘贴 JSON，不要带 Markdown 标记）</div>
                        <textarea
                          value={rawJsonText}
                          onChange={(e) => setRawJsonText(e.target.value)}
                          className="h-[200px] w-full resize-none rounded-xl border border-slate-200 p-3 text-xs font-mono outline-none focus:border-slate-400"
                          placeholder={'{ "version": "1.0", "headers": [...], "rows": [...] }'}
                        />
                      </label>
                      {aiError && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{aiError}</div>}
                      <button type="button" onClick={() => void parseAiJson()} className="h-11 w-full rounded-full bg-slate-950 text-sm font-semibold text-white hover:bg-slate-800">
                        解析并生成草稿 →
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── 草稿表格视图 ── */}
              {aiSubView === "table" && aiDraft && (
                <div className="space-y-4">
                  {/* 校验状态条 */}
                  <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${errorsCount ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>
                        {errorsCount} 错误
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${warningsCount ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-400"}`}>
                        {warningsCount} 警告
                      </span>
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      <input
                        value={supplementTaskIdsText}
                        onChange={(e) => setSupplementTaskIdsText(e.target.value)}
                        placeholder="任务ID，如 12,18"
                        className="h-9 w-40 rounded-lg border border-slate-200 px-2 text-xs outline-none focus:border-slate-400"
                      />
                      <button type="button" onClick={() => void saveAiDraft()} disabled={savingDraft}
                        className="h-9 rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                        保存草稿
                      </button>
                      <button type="button" onClick={() => void supplementDraft()} disabled={!aiBatch || supplementingDraft}
                        className="h-9 rounded-full border border-blue-200 bg-blue-50 px-4 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-60">
                        {supplementingDraft ? "补齐中..." : "🔧 系统补齐"}
                      </button>
                      <button type="button" onClick={() => void exportAiDraft()} disabled={!aiBatch || !!errorsCount}
                        className="h-9 rounded-full bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
                        导出 Excel →
                      </button>
                    </div>
                  </div>

                  {/* common_fields */}
                  <div className="rounded-xl border border-slate-200 bg-white">
                    <div className="border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-700">公共字段 (common_fields)</div>
                    <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
                      {Object.entries(aiDraft.common_fields_json).map(([key, value]) => (
                        <label key={key} className="space-y-1">
                          <div className="text-xs font-medium text-slate-500">{key}</div>
                          <input value={value} onChange={(e) => updateCommonField(key, e.target.value)} className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-slate-400" />
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* headers 管理 */}
                  <div className="rounded-xl border border-slate-200 bg-white">
                    <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                      <span className="text-xs font-semibold text-slate-700">字段 (headers) · {aiDraft.headers_json.length} 个</span>
                      <input value={newHeader} onChange={(e) => setNewHeader(e.target.value)} placeholder="新字段名" className="h-8 flex-1 rounded-lg border border-slate-200 px-2.5 text-xs outline-none focus:border-slate-400" />
                      <button type="button" onClick={addHeader} className="h-8 rounded-full border border-slate-200 px-3 text-xs text-slate-600 hover:bg-slate-50">+ 列</button>
                      {getExtraHeaderCandidates().length > 0 && (
                        <button type="button" onClick={addExtraHeaders} className="h-8 rounded-full border border-amber-200 bg-amber-50 px-3 text-xs text-amber-700 hover:bg-amber-100">
                          + {getExtraHeaderCandidates().length} 额外字段
                        </button>
                      )}
                    </div>
                    <div className="max-h-[200px] overflow-auto p-3">
                      <div className="flex flex-wrap gap-2">
                        {aiDraft.headers_json.map((header, index) => (
                          <div key={`${header}-${index}`} className="flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1">
                            <span className="text-xs text-slate-700">{header}</span>
                            <button type="button" onClick={() => moveHeader(index, -1)} className="text-[10px] text-slate-400 hover:text-slate-600">◀</button>
                            <button type="button" onClick={() => moveHeader(index, 1)} className="text-[10px] text-slate-400 hover:text-slate-600">▶</button>
                            <button type="button" onClick={() => removeHeader(index)} className="text-[10px] text-rose-400 hover:text-rose-600">×</button>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 border-t border-slate-100 px-4 py-2">
                      <select value={batchFillHeader} onChange={(e) => setBatchFillHeader(e.target.value)} className="h-8 rounded-lg border border-slate-200 px-2 text-xs outline-none">
                        <option value="">整列填充</option>
                        {aiDraft.headers_json.map((h) => <option key={h} value={h}>{h}</option>)}
                      </select>
                      <input value={batchFillValue} onChange={(e) => setBatchFillValue(e.target.value)} placeholder="填入值" className="h-8 flex-1 rounded-lg border border-slate-200 px-2 text-xs outline-none" />
                      <button type="button" onClick={batchFillColumn} disabled={!batchFillHeader} className="h-8 rounded-full border border-slate-200 px-3 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40">
                        应用
                      </button>
                    </div>
                  </div>

                  {/* rows 表格 */}
                  <div className="rounded-xl border border-slate-200 bg-white">
                    <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                      <span className="text-xs font-semibold text-slate-700">数据行 (rows) · {aiDraft.rows_json.length} 行</span>
                      <button type="button" onClick={addRow} className="h-8 rounded-full border border-slate-200 px-3 text-xs text-slate-600 hover:bg-slate-50">+ 行</button>
                    </div>
                    <div className="overflow-auto max-h-[500px]">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-slate-100 text-slate-600">
                          <tr>
                            <th className="px-2 py-2 text-left font-semibold">#</th>
                            {aiDraft.headers_json.map((h) => {
                              const src = sourceBadge((aiDraft.field_settings_json?.[h] as { source?: string } | undefined)?.source);
                              return (
                                <th key={h} className="px-2 py-2 text-left font-semibold whitespace-nowrap">
                                  <div className="flex flex-col gap-1">
                                    <span>{h}</span>
                                    <span className={`inline-flex w-fit rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${src.cls}`}>{src.label}</span>
                                  </div>
                                </th>
                              );
                            })}
                            <th className="px-2 py-2 text-left">操作</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {aiDraft.rows_json.map((row, ri) => (
                            <tr key={`r-${ri}`} className={ri % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                              <td className="px-2 py-1.5 align-top text-slate-400">{ri + 1}</td>
                              {aiDraft.headers_json.map((h) => (
                                <td key={`${ri}-${h}`} className="px-1 py-1.5 align-top">
                                  <input
                                    value={row[h] || ""}
                                    onChange={(e) => updateCell(ri, h, e.target.value)}
                                    className="h-8 min-w-[120px] rounded-lg border border-slate-200 px-2 text-xs outline-none focus:border-slate-400"
                                  />
                                </td>
                              ))}
                              <td className="px-2 py-1.5 align-top">
                                <button type="button" onClick={() => removeRow(ri)} className="rounded-full border border-rose-200 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50">×</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {supplementResult && (
                        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
                          ✅ 补齐完成：来自「{supplementResult.rule_name}」填充了 {supplementResult.filled_count} 个字段的空值
                        </div>
                      )}

                  {aiDownloadUrl && (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
                      文件已生成 <a href={aiDownloadUrl} target="_blank" rel="noreferrer" className="ml-1 underline">下载 Excel</a>
                    </div>
                  )}
                </div>
              )}

              {!aiDraft && aiSubView === "table" && (
                <div className="flex flex-col items-center justify-center py-16">
                  <div className="text-4xl">📋</div>
                  <div className="mt-3 text-sm text-slate-500">先生成动态草稿，再查看和修正字段</div>
                </div>
              )}
            </div>

            {/* 右：问题面板 320px */}
            <div className="flex w-[320px] shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white px-4 py-4">
              <div className="mb-3 text-sm font-semibold text-slate-800">🔍 问题与提示</div>

              {/* 问题视图 */}
              <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs font-semibold text-slate-700">问题视图</div>
                  <div className="flex gap-1">
                    <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">{issueErrors.length} 错误</span>
                    <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">{issueWarnings.length} 警告</span>
                  </div>
                </div>
                <div className="max-h-48 space-y-1 overflow-auto">
                  {issueErrors.slice(0, 10).map((item, i) => (
                    <div key={`e-${i}`} className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-800">
                      {item.row_index != null ? `第 ${Number(item.row_index) + 1} 行 · ` : ""}{String(item.field || "字段")} · {String(item.message || "错误")}
                    </div>
                  ))}
                  {issueWarnings.slice(0, 10).map((item, i) => (
                    <div key={`w-${i}`} className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                      {item.row_index != null ? `第 ${Number(item.row_index) + 1} 行 · ` : ""}{String(item.field || "字段")} · {String(item.message || "警告")}
                    </div>
                  ))}
                  {!issueErrors.length && !issueWarnings.length && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] text-emerald-700">暂无问题</div>
                  )}
                </div>
              </div>

              {/* AI 历史 */}
              <div className="mb-4">
                <div className="mb-2 text-xs font-medium text-slate-600">AI 导入批次历史</div>
                <div className="space-y-1">
                  {aiImports.slice(0, 8).map((item) => (
                    <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-700">#{item.id} · {item.name}</span>
                        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${item.status === "exported" ? "bg-emerald-100 text-emerald-700" : item.status === "confirmed" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"}`}>
                          {item.status}
                        </span>
                      </div>
                      <div className="mt-1 text-[10px] text-slate-400">
                        headers {item.parsed_headers_json.length} · rows {item.parsed_rows_json.length}
                      </div>
                      {item.export_file_path && (
                        <a href={`${apiBaseUrl}/storage/${item.export_file_path}`} target="_blank" rel="noreferrer"
                          className="mt-1.5 inline-flex h-6 items-center gap-1 rounded-full border border-slate-200 bg-white px-2 text-[10px] text-slate-500 hover:bg-slate-50">
                          📥 下载
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* 注意事项 */}
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                <div className="mb-2 text-xs font-semibold text-amber-800">⚠️ 填写注意事项</div>
                <div className="space-y-1.5 text-[11px] text-amber-700">
                  <div>• 申报价格无法确定时请留空，系统会提示</div>
                  <div>• 图片字段只填素材 ID 或 URL，禁止填描述文字</div>
                  <div>• SPU/SKU 行结构必须正确，商品层级不能乱填</div>
                  <div>• 多选属性（风格/场合/节日）必须拆分到独立字段</div>
                  <div>• 导出前会进行必填校验，阻断错误必须修正</div>
                </div>
              </div>

              {/* 默认值规则提示 */}
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="mb-2 text-xs font-semibold text-slate-600">📌 应用默认值</div>
                <select
                  value={selectedRuleId}
                  onChange={(e) => setSelectedRuleId(e.target.value ? Number(e.target.value) : "")}
                  className="h-8 w-full rounded-lg border border-slate-200 px-2 text-xs outline-none"
                >
                  <option value="">不使用默认值</option>
                  {defaultRules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                <div className="mt-2 text-[10px] text-slate-400">
                  选择规则后，系统将在导出时自动补齐站点、仓库、币种、尺寸重量、类目属性等字段。
                </div>
              </div>
            </div>
          </>
        )}

        {/* ══════════════ 导出历史 ══════════════ */}
        {tab === "history" && (
          <>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">
              <div className="mb-4 text-sm font-semibold text-slate-800">📋 导出历史</div>
              {historyError && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{historyError}</div>}
              <div className="overflow-auto rounded-xl border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-100 text-slate-600">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">批次号</th>
                      <th className="px-4 py-3 text-left font-semibold">模式</th>
                      <th className="px-4 py-3 text-left font-semibold">规则</th>
                      <th className="px-4 py-3 text-center font-semibold">商品</th>
                      <th className="px-4 py-3 text-center font-semibold">SKU行</th>
                      <th className="px-4 py-3 text-center font-semibold">成功</th>
                      <th className="px-4 py-3 text-center font-semibold">失败</th>
                      <th className="px-4 py-3 text-left font-semibold">时间</th>
                      <th className="px-4 py-3 text-left font-semibold">文件</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {history.map((b) => (
                      <tr key={b.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-semibold text-slate-800">{b.batch_no}</td>
                        <td className="px-4 py-3 text-slate-600">{b.export_mode}</td>
                        <td className="px-4 py-3 text-slate-500">{b.default_rule_name || "-"}</td>
                        <td className="px-4 py-3 text-center text-slate-700">{b.total_count}</td>
                        <td className="px-4 py-3 text-center text-slate-700">{b.sku_row_count}</td>
                        <td className="px-4 py-3 text-center text-emerald-600">{b.success_count}</td>
                        <td className="px-4 py-3 text-center text-rose-600">{b.failed_count}</td>
                        <td className="px-4 py-3 text-slate-400">{formatDate(b.created_at)}</td>
                        <td className="px-4 py-3">
                          {b.exported_file_path
                            ? <a href={`${apiBaseUrl}/storage/${b.exported_file_path}`} target="_blank" rel="noreferrer" className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-600 hover:bg-slate-100">下载</a>
                            : <span className="text-slate-400">-</span>}
                        </td>
                      </tr>
                    ))}
                    {!history.length && (
                      <tr><td colSpan={9} className="px-4 py-12 text-center text-slate-400">暂无导出历史</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
