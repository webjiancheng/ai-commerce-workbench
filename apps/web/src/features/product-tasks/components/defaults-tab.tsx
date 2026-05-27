"use client";

import { useEffect, useState } from "react";

import { applyTaskDefaultRule, listEnabledDefaultRules, type DefaultRuleOption } from "@/features/default-rules/api";
import type { ExportFieldDraft, ProductTaskDetail, RawProductDetail } from "@/features/product-tasks/types";
import { apiBaseUrl } from "@/lib/api";
import {
  buildSkuRowsFromRawSkuProps,
  makeDraftId,
  nonEmptyPairs,
  nonEmptySensitiveRows,
  nonEmptySkuRows,
  readJsonArrayField,
  type DynamicPair,
  type SensitiveDraftRow,
  type SkuDraftRow,
} from "@/features/product-tasks/components/defaults-tab-helpers";

type ListingValidationIssue = {
  field?: string;
  field_name?: string;
  field_key?: string;
  message?: string;
  type?: string;
};

type ListingValidationResult = {
  errors?: ListingValidationIssue[];
  warnings?: ListingValidationIssue[];
};

type ListingTemplateMeta = {
  groups?: Array<{ name: string; fields: string[] }>;
  detail_headers?: string[];
};

type RawSkuPropItem = {
  group_name: string;
  option_name: string;
  image_url: string | null;
  hint_text?: string | null;
  group_index: number;
  option_index: number;
  selected?: boolean;
};

function normalizeRawSkuProps(items: RawSkuPropItem[] | null | undefined): RawSkuPropItem[] {
  return (items || []).map((item, index) => ({
    group_name: String(item?.group_name || "").trim(),
    option_name: String(item?.option_name || "").trim(),
    image_url: item?.image_url ? String(item.image_url).trim() || null : null,
    hint_text: item?.hint_text ? String(item.hint_text).trim() || null : null,
    group_index: Number.isFinite(item?.group_index) ? Number(item.group_index) : 0,
    option_index: Number.isFinite(item?.option_index) ? Number(item.option_index) : index,
    selected: Boolean(item?.selected),
  }));
}

function draftFieldText(fields: Record<string, unknown>, key: string, aliases: string[] = []): string {
  const candidates = [key, ...aliases];
  for (const name of candidates) {
    const value = fields[name];
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function sourceLabelFromMeta(meta: unknown): string {
  if (!meta || typeof meta !== "object") return "未设置";
  const source = String((meta as Record<string, unknown>).source || "").trim();
  switch (source) {
    case "manual_override":
      return "人工";
    case "ai_generated":
      return "AI";
    case "raw_source":
      return "原始采集";
    case "asset_fallback":
    case "asset":
      return "图片资产";
    case "category_default":
    case "keyword_rule":
    case "fixed_default":
    case "global_default":
      return "默认值规则";
    default:
      return source || "系统";
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[18px] border border-slate-200 bg-white p-5">
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function DefaultSummaryCard({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <div className="rounded-[14px] border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-950">{value}</div>
      <div className="mt-1 truncate text-[11px] text-slate-500">{hint}</div>
    </div>
  );
}

function FormInput({
  label, value, onChange, placeholder, type = "text", caption
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  caption?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-slate-600">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 h-10 w-full rounded-[14px] border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
      />
      {caption ? <div className="mt-1 text-[11px] text-slate-500">{caption}</div> : null}
    </div>
  );
}

function FormSelect({
  label, value, onChange, options, caption
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  caption?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-slate-600">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-10 w-full rounded-[14px] border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt || "（空）"}</option>
        ))}
      </select>
      {caption ? <div className="mt-1 text-[11px] text-slate-500">{caption}</div> : null}
    </div>
  );
}

export function DefaultsTab({ task, raw }: { task: ProductTaskDetail; raw: RawProductDetail | null }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applyingRule, setApplyingRule] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [draft, setDraft] = useState<ExportFieldDraft | null>(null);
  const [defaultRules, setDefaultRules] = useState<DefaultRuleOption[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState<number | "">("");
  const [templateMeta, setTemplateMeta] = useState<ListingTemplateMeta | null>(null);
  const [validation, setValidation] = useState<ListingValidationResult | null>(null);
  const [site, setSite] = useState("美国站");
  const [warehouse, setWarehouse] = useState("美国-饰品");
  const [leadTime, setLeadTime] = useState("7个工作日内发货");
  const [originCountry, setOriginCountry] = useState("中国");
  const [originProvince, setOriginProvince] = useState("广东省");
  const [declaredPrice, setDeclaredPrice] = useState("");
  const [suggestedPrice, setSuggestedPrice] = useState("");
  const [specType, setSpecType] = useState("款式/颜色");
  const [skuClass, setSkuClass] = useState("单品");
  const [independentPackage, setIndependentPackage] = useState("是");
  const [packageLength, setPackageLength] = useState("10");
  const [packageWidth, setPackageWidth] = useState("8");
  const [packageHeight, setPackageHeight] = useState("2");
  const [packageWeight, setPackageWeight] = useState("30");
  const [attributes, setAttributes] = useState<DynamicPair[]>([
    { id: makeDraftId("attr"), key: "主体材质", value: "" },
    { id: makeDraftId("attr"), key: "镀层", value: "" },
  ]);
  const [skuRows, setSkuRows] = useState<SkuDraftRow[]>([
    {
      id: makeDraftId("sku"),
      skuCode: "",
      spec1: "",
      spec2: "",
      quantity: "1",
      unit: "件",
      price: "",
      stock: "",
      weight: "",
      length: "",
      width: "",
      height: "",
    },
  ]);
  const [sensitiveRows, setSensitiveRows] = useState<SensitiveDraftRow[]>([
    { id: makeDraftId("sensitive"), type: "", value: "", remark: "" },
  ]);

  async function loadRuleOptions(): Promise<void> {
    try {
      const items = await listEnabledDefaultRules();
      setDefaultRules(items);
      setSelectedRuleId((current) => current || items[0]?.id || "");
    } catch {
      setDefaultRules([]);
    }
  }

  async function loadValidation(): Promise<void> {
    try {
      const res = await fetch(`${apiBaseUrl}/api/exports/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ product_task_ids: [task.id] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        rows?: Array<{ validation_result?: ListingValidationResult }>;
      };
      setValidation(data.rows?.[0]?.validation_result || { errors: [], warnings: [] });
    } catch {
      setValidation(null);
    }
  }

  async function loadDefaults(): Promise<void> {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/product-tasks/${task.id}/export-fields/preview`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        draft: ExportFieldDraft | null;
        template_meta?: ListingTemplateMeta;
      };
      const fields = data.draft?.fields_json || {};
      setDraft(data.draft || null);
      setTemplateMeta(data.template_meta || null);

      setSite(draftFieldText(fields, "经营站点") || "美国站");
      setWarehouse(draftFieldText(fields, "发货仓1", ["发货仓"]) || "美国-饰品");
      setLeadTime(draftFieldText(fields, "承诺发货时效") || "7个工作日内发货");
      setOriginCountry(draftFieldText(fields, "商品产地") || "中国");
      setOriginProvince(draftFieldText(fields, "产地省份") || "广东省");
      setDeclaredPrice(draftFieldText(fields, "申报价格-美国站", ["申报价CNY"]));
      setSuggestedPrice(draftFieldText(fields, "制造商建议零售价(USD)"));
      setSpecType(draftFieldText(fields, "规格类型1") && draftFieldText(fields, "规格类型2")
        ? `${draftFieldText(fields, "规格类型1")}/${draftFieldText(fields, "规格类型2")}`
        : (draftFieldText(fields, "规格类型1") || "款式/颜色"));
      setSkuClass(draftFieldText(fields, "SKU分类") || "单品");
      setIndependentPackage(draftFieldText(fields, "是否独立包装") || "是");
      setPackageLength(draftFieldText(fields, "最长边（cm）") || "10");
      setPackageWidth(draftFieldText(fields, "次长边（cm）") || "8");
      setPackageHeight(draftFieldText(fields, "最短边（cm）") || "2");
      setPackageWeight(draftFieldText(fields, "重量（g）") || "30");

      const savedAttributes = readJsonArrayField<DynamicPair>(fields, "商品属性明细");
      if (savedAttributes.length) {
        setAttributes(savedAttributes.map((row) => ({
          id: row.id || makeDraftId("attr"),
          key: String(row.key || ""),
          value: String(row.value || ""),
        })));
      } else {
        setAttributes([
          { id: makeDraftId("attr"), key: "主体材质", value: draftFieldText(fields, "主体材质") },
          { id: makeDraftId("attr"), key: "镀层", value: draftFieldText(fields, "镀层") },
        ]);
      }

      const savedSkuRows = readJsonArrayField<SkuDraftRow>(fields, "SKU信息明细");
      if (savedSkuRows.length) {
        setSkuRows(savedSkuRows.map((row) => ({
          id: row.id || makeDraftId("sku"),
          skuCode: String(row.skuCode || ""),
          spec1: String(row.spec1 || ""),
          spec2: String(row.spec2 || ""),
          quantity: String(row.quantity || ""),
          unit: String(row.unit || "件"),
          price: String(row.price || ""),
          stock: String(row.stock || ""),
          weight: String(row.weight || ""),
          length: String(row.length || ""),
          width: String(row.width || ""),
          height: String(row.height || ""),
        })));
      } else {
        const seededSkuRows = buildSkuRowsFromRawSkuProps(task, raw, normalizeRawSkuProps);
        if (seededSkuRows.length) {
          setSkuRows(seededSkuRows.map((row) => ({
            ...row,
            quantity: draftFieldText(fields, "SKU数量") || row.quantity || "1",
            unit: draftFieldText(fields, "SKU数量单位") || row.unit || "件",
            price: draftFieldText(fields, "申报价格-美国站", ["申报价CNY"]) || row.price || "",
            stock: draftFieldText(fields, "发货仓1库存", ["库存"]) || row.stock || "",
            weight: draftFieldText(fields, "重量（g）") || row.weight || "",
            length: draftFieldText(fields, "最长边（cm）") || row.length || "",
            width: draftFieldText(fields, "次长边（cm）") || row.width || "",
            height: draftFieldText(fields, "最短边（cm）") || row.height || "",
          })));
        } else {
          setSkuRows([{
            id: makeDraftId("sku"),
            skuCode: draftFieldText(fields, "SKU货号") || task.platform_sku || task.source_id || "",
            spec1: draftFieldText(fields, "规格1内容"),
            spec2: draftFieldText(fields, "规格2内容"),
            quantity: draftFieldText(fields, "SKU数量") || "1",
            unit: draftFieldText(fields, "SKU数量单位") || "件",
            price: draftFieldText(fields, "申报价格-美国站", ["申报价CNY"]),
            stock: draftFieldText(fields, "发货仓1库存", ["库存"]),
            weight: draftFieldText(fields, "重量（g）"),
            length: draftFieldText(fields, "最长边（cm）"),
            width: draftFieldText(fields, "次长边（cm）"),
            height: draftFieldText(fields, "最短边（cm）"),
          }]);
        }
      }

      const savedSensitiveRows = readJsonArrayField<SensitiveDraftRow>(fields, "敏感属性明细");
      if (savedSensitiveRows.length) {
        setSensitiveRows(savedSensitiveRows.map((row) => ({
          id: row.id || makeDraftId("sensitive"),
          type: String(row.type || ""),
          value: String(row.value || ""),
          remark: String(row.remark || ""),
        })));
      } else {
        const rows = ["敏感词属性1", "敏感词属性2", "敏感词属性3"]
          .map((key) => draftFieldText(fields, key))
          .filter(Boolean)
          .map((type) => ({ id: makeDraftId("sensitive"), type, value: "", remark: "" }));
        setSensitiveRows(rows.length ? rows : [{ id: makeDraftId("sensitive"), type: "", value: "", remark: "" }]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDefaults();
    void loadRuleOptions();
    void loadValidation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  async function applySelectedRule(): Promise<void> {
    setApplyingRule(true);
    setError(null);
    setSuccess(null);
    try {
      await applyTaskDefaultRule(task.id, selectedRuleId === "" ? null : selectedRuleId);
      setSuccess("已应用上架默认值规则");
      await loadDefaults();
      await loadValidation();
    } catch (err) {
      setError(err instanceof Error ? err.message : "应用规则失败");
    } finally {
      setApplyingRule(false);
    }
  }

  async function saveDefaults(): Promise<void> {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const cleanAttributes = nonEmptyPairs(attributes);
      const cleanSkuRows = nonEmptySkuRows(skuRows);
      const cleanSensitiveRows = nonEmptySensitiveRows(sensitiveRows);
      const fields: Record<string, string> = {
        "经营站点": site,
        "发货仓": warehouse,
        "发货仓1": warehouse,
        "承诺发货时效": leadTime,
        "商品产地": originCountry,
        "产地省份": originProvince,
        "SKU分类": skuClass,
        "是否独立包装": independentPackage,
        "最长边（cm）": packageLength,
        "次长边（cm）": packageWidth,
        "最短边（cm）": packageHeight,
        "重量（g）": packageWeight,
        "商品属性明细": JSON.stringify(cleanAttributes),
        "SKU信息明细": JSON.stringify(cleanSkuRows),
        "敏感属性明细": JSON.stringify(cleanSensitiveRows),
      };
      if (declaredPrice) fields["申报价格-美国站"] = declaredPrice;
      if (suggestedPrice) fields["制造商建议零售价(USD)"] = suggestedPrice;

      cleanAttributes.forEach((row) => {
        fields[row.key] = row.value;
      });

      const firstSku = cleanSkuRows[0];
      if (firstSku) {
        const [specType1, specType2] = specType.split("/").map((item) => item.trim()).filter(Boolean);
        fields["SKU货号"] = firstSku.skuCode;
        fields["SPU货号"] = task.task_no || firstSku.skuCode;
        if (specType1) fields["规格类型1"] = specType1;
        fields["规格1内容"] = firstSku.spec1;
        if (specType2) fields["规格类型2"] = specType2;
        fields["规格2内容"] = firstSku.spec2;
        fields["SKU数量"] = firstSku.quantity;
        fields["SKU数量单位"] = firstSku.unit;
        if (firstSku.price) fields["申报价格-美国站"] = firstSku.price;
        if (firstSku.stock) fields["发货仓1库存"] = firstSku.stock;
      }

      cleanSensitiveRows.slice(0, 3).forEach((row, index) => {
        fields[`敏感词属性${index + 1}`] = row.type;
        if (row.value) fields[`敏感属性${index + 1}数值`] = row.value;
        if (row.remark) fields[`敏感属性${index + 1}备注`] = row.remark;
      });

      const res = await fetch(`${apiBaseUrl}/api/product-tasks/${task.id}/export-fields`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fields }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSuccess("保存成功");
      await loadDefaults();
      await loadValidation();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  function patchAttribute(id: string, patch: Partial<DynamicPair>): void {
    setAttributes((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  function patchSkuRow(id: string, patch: Partial<SkuDraftRow>): void {
    setSkuRows((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  function patchSensitiveRow(id: string, patch: Partial<SensitiveDraftRow>): void {
    setSensitiveRows((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  const draftFields = draft?.fields_json || {};
  const draftSources = (draft?.field_sources_json || {}) as Record<string, unknown>;
  const validationErrors = validation?.errors || [];
  const validationWarnings = validation?.warnings || [];
  const validationByField = [...validationErrors, ...validationWarnings].reduce<Record<string, string[]>>((acc, item) => {
    const field = String(item.field || item.field_name || item.field_key || "").trim();
    if (!field) return acc;
    acc[field] = acc[field] || [];
    if (item.message) acc[field].push(item.message);
    return acc;
  }, {});
  const filledAttributeCount = nonEmptyPairs(attributes).length;
  const filledSkuCount = nonEmptySkuRows(skuRows).length;
  const filledSensitiveCount = nonEmptySensitiveRows(sensitiveRows).length;
  const sensitiveOptions = ["", "纯电", "内电", "液体", "粉末", "膏体", "刀具", "磁性", "气雾剂", "易碎", "其他"];
  const currentRule = defaultRules.find((item) => item.id === selectedRuleId);
  const fieldCaption = (field: string): string => {
    const sourceLabel = sourceLabelFromMeta(draftSources[field]);
    const issueText = (validationByField[field] || []).slice(0, 2).join("；");
    return issueText ? `${sourceLabel} · ${issueText}` : sourceLabel;
  };

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-[18px] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
      ) : null}
      {success ? (
        <div className="rounded-[18px] border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{success}</div>
      ) : null}

      <Section title="本商品上架补充">
        <div className="grid gap-3 md:grid-cols-4">
          <DefaultSummaryCard label="商品属性" value={filledAttributeCount} hint="SPU 属性字段" />
          <DefaultSummaryCard label="SKU 行" value={filledSkuCount} hint="SKU 销售信息" />
          <DefaultSummaryCard label="敏感属性" value={filledSensitiveCount} hint="敏感品申报" />
          <DefaultSummaryCard label="导出草稿" value={draft ? "已生成" : "未生成"} hint={draft?.updated_at || "保存后写入草稿"} />
        </div>
        <div className="mt-4 rounded-[14px] border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
          当前字段标准已切换到 Temu 官方 `商品上传模版.xlsx / 模版`。默认值规则负责批量填充，抽屉负责当前商品的覆盖与导出前检查。
        </div>
      </Section>

      <Section title="导出检查摘要">
        <div className="grid gap-3 md:grid-cols-3">
          <DefaultSummaryCard label="阻断错误" value={validationErrors.length} hint="有错误时不能导出" />
          <DefaultSummaryCard label="警告" value={validationWarnings.length} hint="允许导出但建议复核" />
          <DefaultSummaryCard label="当前规则" value={currentRule?.name || "未选择"} hint="下方可重新应用" />
        </div>
        {validationErrors.length || validationWarnings.length ? (
          <div className="mt-4 rounded-[14px] border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
            {[...validationErrors, ...validationWarnings].slice(0, 8).map((item, index) => (
              <div key={`${item.field || item.field_name || item.field_key || "issue"}-${index}`}>
                {(item.field || item.field_name || item.field_key || "字段")}: {item.message || item.type || "需要处理"}
              </div>
            ))}
          </div>
        ) : null}
      </Section>

      <Section title="默认值规则选择">
        <div className="grid gap-4 md:grid-cols-[1fr_auto]">
          <div>
            <label className="block text-xs text-slate-600">上架默认值规则</label>
            <select
              value={selectedRuleId}
              onChange={(e) => setSelectedRuleId(e.target.value ? Number(e.target.value) : "")}
              className="mt-1 h-10 w-full rounded-[14px] border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
            >
              <option value="">不指定，按系统自动匹配</option>
              {defaultRules.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
            <div className="mt-2 text-xs text-slate-500">
              {currentRule?.category_path || "规则会按平台 / 站点 / 履约 / 类目匹配。"}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void applySelectedRule()}
            className="mt-auto h-10 rounded-full border border-slate-900 bg-slate-900 px-5 text-sm font-medium text-white hover:bg-slate-800"
            disabled={applyingRule}
          >
            {applyingRule ? "应用中..." : "应用规则"}
          </button>
        </div>
      </Section>

      <Section title="基础信息">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <FormSelect label="经营站点" value={site} onChange={setSite} options={["美国站", "英国站", "德国站", "法国站", "意大利站", "西班牙站", "日本站", "澳大利亚站"]} caption={fieldCaption("经营站点")} />
          <FormSelect label="发货仓" value={warehouse} onChange={setWarehouse} options={["美国-饰品", "美国-普货", "英国-饰品", "英国-普货", "德国-饰品", "德国-普货"]} caption={fieldCaption("发货仓1")} />
          <FormSelect label="承诺发货时效" value={leadTime} onChange={setLeadTime} options={["2个工作日内发货", "3个工作日内发货", "5个工作日内发货", "7个工作日内发货"]} caption={fieldCaption("承诺发货时效")} />
          <FormSelect label="是否独立包装" value={independentPackage} onChange={setIndependentPackage} options={["是", "否"]} caption={fieldCaption("是否独立包装")} />
          <FormInput label="商品产地" value={originCountry} onChange={setOriginCountry} placeholder="中国" caption={fieldCaption("商品产地")} />
          <FormInput label="产地省份" value={originProvince} onChange={setOriginProvince} placeholder="广东省" caption={fieldCaption("产地省份")} />
          <FormInput label="申报价格-美国站" value={declaredPrice} onChange={setDeclaredPrice} type="number" placeholder="必填" caption={fieldCaption("申报价格-美国站")} />
          <FormInput label="制造商建议零售价(USD)" value={suggestedPrice} onChange={setSuggestedPrice} type="number" placeholder="选填" caption={fieldCaption("制造商建议零售价(USD)")} />
        </div>
      </Section>

      <Section title="SPU商品属性">
        <div className="space-y-2">
          {attributes.map((row, index) => (
            <div key={row.id} className="grid gap-2 md:grid-cols-[220px_1fr_auto]">
              <FormInput label={index === 0 ? "属性名" : ""} value={row.key} onChange={(value) => patchAttribute(row.id, { key: value })} placeholder="如：主体材质 / 镀层 / 主题1" />
              <FormInput label={index === 0 ? "属性值" : ""} value={row.value} onChange={(value) => patchAttribute(row.id, { value: value })} placeholder="如：合金 / 无镀层 / 时尚" caption={row.key ? fieldCaption(row.key) : undefined} />
              <button
                type="button"
                onClick={() => setAttributes((rows) => rows.length > 1 ? rows.filter((item) => item.id !== row.id) : rows)}
                className="mt-auto h-10 rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                disabled={attributes.length <= 1}
              >
                删除
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setAttributes((rows) => [...rows, { id: makeDraftId("attr"), key: "", value: "" }])}
          className="mt-3 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          添加属性
        </button>
      </Section>

      <Section title="商品规格与 SKU销售信息">
        <div className="grid gap-4 md:grid-cols-3">
          <FormSelect label="规格类型" value={specType} onChange={setSpecType} options={["款式/颜色", "颜色/尺寸", "尺寸/颜色", "款式", "颜色", "自定义"]} caption={`${fieldCaption("规格类型1")} / ${fieldCaption("规格类型2")}`} />
          <FormSelect label="SKU分类" value={skuClass} onChange={setSkuClass} options={["单品", "同款多件装", "混合套装"]} caption={fieldCaption("SKU分类")} />
          <div className="rounded-[14px] border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
            {(templateMeta?.groups || []).map((item) => item.name).slice(0, 4).join(" / ") || "按模板分组编辑"}。首个 SKU 的通用值会同步到模板主字段。
          </div>
        </div>
        <div className="mt-4 space-y-3">
          {skuRows.map((row, index) => (
            <div key={row.id} className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-slate-900">SKU {index + 1}</div>
                <button
                  type="button"
                  onClick={() => setSkuRows((rows) => rows.length > 1 ? rows.filter((item) => item.id !== row.id) : rows)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  disabled={skuRows.length <= 1}
                >
                  删除
                </button>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <FormInput label="SKU货号" value={row.skuCode} onChange={(value) => patchSkuRow(row.id, { skuCode: value })} placeholder="平台 SKU / 货号" caption={fieldCaption("SKU货号")} />
                <FormInput label="规格1内容" value={row.spec1} onChange={(value) => patchSkuRow(row.id, { spec1: value })} placeholder="如：黑色" caption={fieldCaption("规格1内容")} />
                <FormInput label="规格2内容" value={row.spec2} onChange={(value) => patchSkuRow(row.id, { spec2: value })} placeholder="如：S / 1件装" caption={fieldCaption("规格2内容")} />
                <div className="grid grid-cols-2 gap-2">
                  <FormInput label="SKU数量" value={row.quantity} onChange={(value) => patchSkuRow(row.id, { quantity: value })} type="number" placeholder="1" caption={fieldCaption("SKU数量")} />
                  <FormSelect label="SKU数量单位" value={row.unit} onChange={(value) => patchSkuRow(row.id, { unit: value })} options={["件", "套", "对", "个", "组", "盒", "袋"]} caption={fieldCaption("SKU数量单位")} />
                </div>
                <FormInput label="申报价格-美国站" value={row.price} onChange={(value) => patchSkuRow(row.id, { price: value })} type="number" placeholder="必填" caption={fieldCaption("申报价格-美国站")} />
                <FormInput label="发货仓1库存" value={row.stock} onChange={(value) => patchSkuRow(row.id, { stock: value })} type="number" placeholder="必填" caption={fieldCaption("发货仓1库存")} />
                <FormInput label="SKU 重量(g)" value={row.weight} onChange={(value) => patchSkuRow(row.id, { weight: value })} type="number" placeholder="默认用包裹重量" />
                <div className="grid grid-cols-3 gap-2">
                  <FormInput label="长(cm)" value={row.length} onChange={(value) => patchSkuRow(row.id, { length: value })} type="number" />
                  <FormInput label="宽(cm)" value={row.width} onChange={(value) => patchSkuRow(row.id, { width: value })} type="number" />
                  <FormInput label="高(cm)" value={row.height} onChange={(value) => patchSkuRow(row.id, { height: value })} type="number" />
                </div>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setSkuRows((rows) => [...rows, {
            id: makeDraftId("sku"),
            skuCode: "",
            spec1: "",
            spec2: "",
            quantity: "1",
            unit: "件",
            price: "",
            stock: "",
            weight: "",
            length: "",
            width: "",
            height: "",
          }])}
          className="mt-3 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          添加 SKU
        </button>
      </Section>

      <Section title="SKU体积重量与敏感属性">
        <div className="space-y-2">
          {sensitiveRows.map((row, index) => (
            <div key={row.id} className="grid gap-2 md:grid-cols-[180px_180px_1fr_auto]">
              <FormSelect label={index === 0 ? "类型" : ""} value={row.type} onChange={(value) => patchSensitiveRow(row.id, { type: value })} options={sensitiveOptions} />
              <FormInput label={index === 0 ? "数值" : ""} value={row.value} onChange={(value) => patchSensitiveRow(row.id, { value: value })} placeholder="容量/长度/Wh 等" />
              <FormInput label={index === 0 ? "备注" : ""} value={row.remark} onChange={(value) => patchSensitiveRow(row.id, { remark: value })} placeholder="如：内置纽扣电池 / 液体 100ml" />
              <button
                type="button"
                onClick={() => setSensitiveRows((rows) => rows.length > 1 ? rows.filter((item) => item.id !== row.id) : rows)}
                className="mt-auto h-10 rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                disabled={sensitiveRows.length <= 1}
              >
                删除
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setSensitiveRows((rows) => [...rows, { id: makeDraftId("sensitive"), type: "", value: "", remark: "" }])}
          className="mt-3 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          添加敏感属性
        </button>
      </Section>

      <Section title="尺寸重量">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <FormInput label="最长边（cm）" value={packageLength} onChange={setPackageLength} placeholder="10" type="number" caption={fieldCaption("最长边（cm）")} />
          <FormInput label="次长边（cm）" value={packageWidth} onChange={setPackageWidth} placeholder="8" type="number" caption={fieldCaption("次长边（cm）")} />
          <FormInput label="最短边（cm）" value={packageHeight} onChange={setPackageHeight} placeholder="2" type="number" caption={fieldCaption("最短边（cm）")} />
          <FormInput label="重量（g）" value={packageWeight} onChange={setPackageWeight} placeholder="30" type="number" caption={fieldCaption("重量（g）")} />
        </div>
      </Section>

      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500">
          {draft ? `草稿状态: ${draft.status} · 已有字段 ${Object.keys(draftFields).length} 个` : "暂无草稿"}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              void loadDefaults();
              void loadValidation();
            }}
            className="h-11 rounded-full border border-slate-200 bg-white px-5 text-sm text-slate-700 hover:bg-slate-50"
            disabled={loading}
          >
            {loading ? "加载中..." : "重置"}
          </button>
          <button
            type="button"
            onClick={() => void saveDefaults()}
            className="h-11 rounded-full bg-slate-900 px-5 text-sm font-medium text-white hover:bg-slate-800"
            disabled={saving}
          >
            {saving ? "保存中..." : "保存全部"}
          </button>
        </div>
      </div>
    </div>
  );
}
