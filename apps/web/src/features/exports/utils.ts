import type { TemplateMeta } from "@/features/exports/types";

export function parseIds(text: string): number[] {
  return text
    .split(/[,\s]+/g)
    .map((p) => Number(p.trim()))
    .filter((v) => Number.isFinite(v) && v > 0);
}

export function buildPrompt(meta?: TemplateMeta): string {
  const commonFields = meta?.common_fields || ["经营站点", "发货仓", "类目", "运费模版", "承诺发货时效", "素材语言"];
  const detailHeaders = meta?.detail_headers || ["商品层级", "SPU货号", "商品名称", "英文名称", "申报价格-美国站"];
  const requiredHints = meta?.required_hints || ["字段必填信息以 Temu 模板说明行为准。"];
  return `你是 Temu 商品上传模板结构化助手。

按以下规则返回 JSON：
1. 字段名必须和模板字段完全一致。
2. headers 必须包含全部商品明细字段，顺序保持一致。
3. rows 每行都必须包含 headers 的全部字段；缺失填 ""。
4. 所有值均使用字符串，不要返回解释文字，不要 Markdown。

模板公共字段：${commonFields.join("、")}
模板商品明细字段：${detailHeaders.join("、")}
必填提示：${requiredHints.join("；")}

返回格式：
{
  "version": "1.0",
  "source": "external_ai_temu_template",
  "sheet_name": "",
  "common_fields": {},
  "headers": [],
  "rows": [],
  "warnings": []
}`;
}
