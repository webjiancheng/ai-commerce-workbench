"use client";

import { loadAiImportBatchesApi, loadExportBasics, loadExportHistoryApi, parseAiImportApi, runExportApi, saveAiDraftApi, supplementAiDraftApi, exportAiDraftApi } from "@/features/exports/api";
import { AiImportTab } from "@/features/exports/components/ai-import-tab";
import { ExportHistoryTab } from "@/features/exports/components/export-history-tab";
import { FixedExportTab } from "@/features/exports/components/fixed-export-tab";
import type { AiImportBatch, AiImportDraft, DefaultRule, ExportAdapter, ExportBatch, TabKey, TemplateMeta } from "@/features/exports/types";
import { buildPrompt, parseIds } from "@/features/exports/utils";
import { useEffect, useMemo, useState } from "react";

export default function ExportsPage() {
  const [tab, setTab] = useState<TabKey>("fixed");
  const [taskIdsText, setTaskIdsText] = useState("");
  const taskIds = useMemo(() => parseIds(taskIdsText), [taskIdsText]);
  const [rules, setRules] = useState<DefaultRule[]>([]);
  const [ruleId, setRuleId] = useState<number | "">("");
  const [adapters, setAdapters] = useState<ExportAdapter[]>([]);
  const [adapterKey, setAdapterKey] = useState("miaoshou_temu_non_apparel");
  const [exportOnlyValid, setExportOnlyValid] = useState(true);
  const [fixedErr, setFixedErr] = useState<string | null>(null);
  const [fixedDownload, setFixedDownload] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<ExportBatch[]>([]);

  const [meta, setMeta] = useState<TemplateMeta | null>(null);
  const [aiName, setAiName] = useState("Temu AI 导入");
  const [rawJson, setRawJson] = useState("");
  const [aiErr, setAiErr] = useState<string | null>(null);
  const [aiBatch, setAiBatch] = useState<AiImportBatch | null>(null);
  const [aiDraft, setAiDraft] = useState<AiImportDraft | null>(null);
  const [aiImports, setAiImports] = useState<AiImportBatch[]>([]);
  const [aiDownload, setAiDownload] = useState<string | null>(null);

  const aiPrompt = useMemo(() => buildPrompt(meta || undefined), [meta]);

  async function loadBasics(): Promise<void> {
    const basics = await loadExportBasics();
    setRules(basics.rules);
    setAdapters(basics.adapters);
    setHistory(basics.history);
    setAiImports(basics.aiImports);
    setMeta(basics.meta);
    const current = basics.adapters.find((x) => x.is_default) || basics.adapters.find((x) => x.enabled) || basics.adapters[0];
    if (current) setAdapterKey(current.adapter_key);
  }

  useEffect(() => { void loadBasics(); }, []);

  async function runExport(): Promise<void> {
    if (!taskIds.length) return;
    setRunning(true);
    setFixedErr(null);
    setFixedDownload(null);
    try {
      const data = await runExportApi({
        product_task_ids: taskIds,
        default_rule_id: ruleId === "" ? null : ruleId,
        adapter_key: adapterKey,
        export_only_valid: exportOnlyValid,
      });
      setFixedDownload(data.download_url || null);
      setHistory(await loadExportHistoryApi());
      setTab("history");
    } catch (err) {
      setFixedErr(err instanceof Error ? err.message : "导出失败");
    } finally {
      setRunning(false);
    }
  }

  async function parseAi(): Promise<void> {
    if (!rawJson.trim()) return;
    setAiErr(null);
    try {
      const data = await parseAiImportApi(aiName, rawJson);
      setAiBatch(data.batch);
      setAiDraft(data.draft);
      setAiImports(await loadAiImportBatchesApi());
    } catch (err) {
      setAiErr(err instanceof Error ? err.message : "解析失败");
    }
  }

  async function saveAiDraft(): Promise<void> {
    if (!aiBatch || !aiDraft) return;
    try {
      await saveAiDraftApi(aiBatch.id, aiDraft);
      setAiErr(null);
    } catch (err) {
      setAiErr(err instanceof Error ? err.message : "保存草稿失败");
    }
  }

  async function supplementAiDraft(): Promise<void> {
    if (!aiBatch) return;
    try {
      const draft = await supplementAiDraftApi(aiBatch.id, ruleId === "" ? null : ruleId);
      setAiDraft(draft);
      setAiErr(null);
    } catch (err) {
      setAiErr(err instanceof Error ? err.message : "系统补齐失败");
    }
  }

  async function exportAiDraft(): Promise<void> {
    if (!aiBatch) return;
    try {
      const data = await exportAiDraftApi(aiBatch.id);
      setAiDownload(data.download_url || null);
      setTab("history");
      setAiErr(null);
    } catch (err) {
      setAiErr(err instanceof Error ? err.message : "导出失败");
    }
  }

  const aiErrors = Array.isArray(aiDraft?.validation_result_json?.errors) ? aiDraft?.validation_result_json?.errors?.length || 0 : 0;

  return (
    <div className="p-6 space-y-4">
      <div className="text-xl font-bold">导出中心</div>
      <div className="flex gap-2">
        <button type="button" onClick={() => setTab("fixed")} className={`px-4 py-2 rounded-full ${tab === "fixed" ? "bg-slate-900 text-white" : "border"}`}>固定导出</button>
        <button type="button" onClick={() => setTab("ai")} className={`px-4 py-2 rounded-full ${tab === "ai" ? "bg-slate-900 text-white" : "border"}`}>AI 填表导入</button>
        <button type="button" onClick={() => setTab("history")} className={`px-4 py-2 rounded-full ${tab === "history" ? "bg-slate-900 text-white" : "border"}`}>历史</button>
      </div>

      {tab === "fixed" && (
        <FixedExportTab
          taskIdsText={taskIdsText}
          onTaskIdsTextChange={setTaskIdsText}
          adapterKey={adapterKey}
          onAdapterKeyChange={setAdapterKey}
          ruleId={ruleId}
          onRuleIdChange={setRuleId}
          exportOnlyValid={exportOnlyValid}
          onExportOnlyValidChange={setExportOnlyValid}
          fixedErr={fixedErr}
          fixedDownload={fixedDownload}
          running={running}
          canRun={taskIds.length > 0}
          onRunExport={() => void runExport()}
          adapters={adapters}
          rules={rules}
        />
      )}

      {tab === "ai" && (
        <AiImportTab
          aiPrompt={aiPrompt}
          aiName={aiName}
          onAiNameChange={setAiName}
          rawJson={rawJson}
          onRawJsonChange={setRawJson}
          aiErr={aiErr}
          aiDraft={aiDraft}
          aiDownload={aiDownload}
          aiErrors={aiErrors}
          onParseAi={() => void parseAi()}
          onSaveAiDraft={() => void saveAiDraft()}
          onSupplementAiDraft={() => void supplementAiDraft()}
          onExportAiDraft={() => void exportAiDraft()}
          onDraftChange={setAiDraft}
        />
      )}

      {tab === "history" && <ExportHistoryTab history={history} aiImports={aiImports} />}
    </div>
  );
}
