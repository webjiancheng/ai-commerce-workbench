from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

from openpyxl import load_workbook
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.ai_import_batch import AiImportBatch
from app.models.ai_import_draft import AiImportDraft


IMAGE_FIELD_KEYWORDS = ("图", "图片", "视频", "预览图", "轮播图", "详情图文")


def list_ai_import_batches(session: Session, *, limit: int = 20) -> list[AiImportBatch]:
    return session.scalars(select(AiImportBatch).order_by(AiImportBatch.created_at.desc()).limit(limit)).all()


def get_ai_import_batch(session: Session, *, batch_id: int) -> AiImportBatch | None:
    return session.get(AiImportBatch, batch_id)


def get_ai_import_draft(session: Session, *, batch_id: int) -> AiImportDraft | None:
    return session.scalar(select(AiImportDraft).where(AiImportDraft.batch_id == batch_id).limit(1))


# ─────────── 默认值补齐 ───────────

def get_default_rule_values(session: Session, *, rule_id: int | None = None) -> dict[str, str]:
    """
    根据 rule_id 加载默认值规则的值。
    如果 rule_id 为 None，加载所有已启用的规则中优先级最高的。
    返回值：key=字段名，value=字段值（只返回有值的字段）
    """
    from app.models.default_rule import DefaultRule

    rule: DefaultRule | None = None
    if rule_id:
        rule = session.get(DefaultRule, rule_id)
    if rule is None:
        # 取优先级最高的已启用规则
        rule = session.scalars(
            select(DefaultRule)
            .where(DefaultRule.enabled == True)  # noqa: E712
            .order_by(DefaultRule.priority.asc())
            .limit(1)
        ).first()

    if rule is None:
        return {}

    values: dict[str, str] = {}
    raw = rule.values_json or {}
    for k, v in raw.items():
        if v is not None and str(v).strip():
            values[str(k)] = str(v)
    return values


def get_product_task_values(session: Session, *, product_task_ids: list[int]) -> dict[str, dict[str, str]]:
    """
    加载商品任务的数据，用于补充 AI 草稿。
    返回：{task_id: {字段名: 值}}
    目前支持从 task_bootstrap 获取任务基础信息。
    """
    if not product_task_ids:
        return {}

    from app.models.product_task import ProductTask

    tasks = session.scalars(
        select(ProductTask).where(ProductTask.id.in_(product_task_ids))
    ).all()

    result: dict[str, dict[str, str]] = {}
    for task in tasks:
        row: dict[str, str] = {}
        # 货号
        if task.task_no:
            row["SPU货号"] = task.task_no
            row["SKU货号"] = task.task_no
        # 商品名称（来自 AI 生成或标题）
        if task.title_package:
            tp = task.title_package if isinstance(task.title_package, dict) else {}
            row["商品名称"] = str(tp.get("title_cn", "") or tp.get("title_en", ""))
            row["英文名称"] = str(tp.get("title_en", ""))
        # 分类路径
        if task.category_path:
            row["类目"] = task.category_path
        # 申报价格
        if task.price_usd:
            row["申报价格-美国站"] = str(task.price_usd)
        result[str(task.id)] = row

    return result


def supplement_draft_with_defaults(
    session: Session,
    *,
    draft: AiImportDraft,
    default_rule_id: int | None = None,
    product_task_ids: list[int] | None = None,
    selected_template_id: int | None = None,
) -> AiImportDraft:
    """
    用默认值规则/商品任务数据补充草稿的空字段。

    补充策略（按优先级从低到高）：
      1. 系统默认值（来自 listing_default_fields.py）
      2. 默认值规则（来自 default_rules.values_json）
      3. 商品任务（来自 product_tasks）
      4. 资产（图片/视频，来自 product_assets）— 暂不实现，需要关联关系
      5. 已有值（不覆盖）

    每个字段的来源记录在 field_settings_json["source"] 中：
      - "default": 系统默认值
      - "rule": 默认值规则
      - "task": 商品任务
      - "existing": 已有值不覆盖
      - "external_ai": 外部 AI 原值

    返回更新后的 draft。
    """
    from app.services.listing_default_fields import get_uniform_default_values

    if draft is None:
        raise ValueError("draft cannot be None")

    # 1. 获取各层级数据
    system_defaults = get_uniform_default_values()
    rule_values = get_default_rule_values(session, rule_id=default_rule_id)
    task_values_map = get_product_task_values(session, product_task_ids=product_task_ids or [])

    # 2. 获取当前 field_settings
    settings = dict(draft.field_settings_json) if draft.field_settings_json else {}
    # 确保所有 headers 都有 settings 条目
    for h in draft.headers_json:
        if h not in settings:
            settings[h] = {
                "export": True,
                "field_type": "text",
                "source": "external_ai",
                "is_media_field": any(token in h for token in IMAGE_FIELD_KEYWORDS),
            }

    # ── 2a. 补充 common_fields ──
    common = dict(draft.common_fields_json) if draft.common_fields_json else {}
    # 系统默认值填 common 空字段
    common_sources: dict[str, str] = {}
    for key in ["经营站点", "发货仓", "类目", "运费模版", "承诺发货时效", "素材语言"]:
        if key not in common or not str(common.get(key) or "").strip():
            if key in rule_values:
                common[key] = rule_values[key]
                common_sources[key] = "rule"
            elif key in system_defaults:
                common[key] = system_defaults[key]
                common_sources[key] = "default"
    draft.common_fields_json = common

    # ── 2b. 补充 rows ──
    rows = [dict(r) for r in draft.rows_json]
    task_values_list = list(task_values_map.values())

    for row_idx, row in enumerate(rows):
        for h in draft.headers_json:
            current = str(row.get(h) or "").strip()
            if current:
                # 已有值，跳过，标记为已有
                if h in settings:
                    settings[h].setdefault("source", "external_ai")
                continue

            # 字段来源优先级：rule > system_default
            filled = False

            # 尝试从默认值规则填充
            if h in rule_values and rule_values[h]:
                row[h] = rule_values[h]
                if h in settings:
                    settings[h]["source"] = "rule"
                filled = True
            # 尝试从系统默认值填充
            elif h in system_defaults and system_defaults[h]:
                row[h] = system_defaults[h]
                if h in settings:
                    settings[h]["source"] = "default"
                filled = True
            # 尝试从商品任务填充（每行对应一个任务）
            if not filled and task_values_list:
                task_row = task_values_list[row_idx] if row_idx < len(task_values_list) else task_values_list[0]
                if h in task_row and task_row[h]:
                    row[h] = task_row[h]
                    if h in settings:
                        settings[h]["source"] = "task"
                    filled = True

    draft.rows_json = rows
    draft.field_settings_json = settings

    # ── 2c. 重新校验 ──
    validation = _validate_supplemented_data(draft)
    batch = session.get(AiImportBatch, draft.batch_id)
    if batch and batch.template_file_path:
        validation = _merge_validation(
            validation,
            _validate_against_template(
                template_file_path=batch.template_file_path,
                common_fields=draft.common_fields_json or {},
                headers=draft.headers_json or [],
                rows=draft.rows_json or [],
            ),
        )
    draft.validation_result_json = validation

    session.add(draft)
    session.commit()
    session.refresh(draft)
    return draft


def _validate_supplemented_data(draft: AiImportDraft) -> dict[str, Any]:
    """
    对补齐后的草稿进行增强校验：
    - 必填字段缺失检查
    - 图片字段不应有描述文字
    - 申报价格缺失提示
    """
    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    required_fields = ["申报价格-美国站", "发货仓1", "发货仓1库存"]

    for row_idx, row in enumerate(draft.rows_json or []):
        for field in required_fields:
            if field in draft.headers_json:
                val = str(row.get(field) or "").strip()
                if not val:
                    if field == "申报价格-美国站":
                        warnings.append({
                            "row_index": row_idx,
                            "field": field,
                            "message": f"申报价格-美国站未填写，将无法通过平台校验",
                            "severity": "error",
                        })
                        errors.append({
                            "row_index": row_idx,
                            "field": field,
                            "message": f"申报价格-美国站为必填",
                            "severity": "error",
                        })
                    else:
                        warnings.append({
                            "row_index": row_idx,
                            "field": field,
                            "message": f"{field} 未填写",
                        })

        # 图片/视频字段不应是描述性文字
        for h in draft.headers_json:
            if any(token in h for token in IMAGE_FIELD_KEYWORDS):
                val = str(row.get(h) or "").strip()
                if val and not _looks_like_media_value(val):
                    warnings.append({
                        "row_index": row_idx,
                        "field": h,
                        "message": f"图片/视频字段应填素材ID或URL，疑似描述性文字",
                        "severity": "warning",
                    })

    return {"errors": errors, "warnings": warnings}


def _looks_like_media_value(val: str) -> bool:
    """判断值是否像媒体ID/URL（而非描述文字）"""
    val = val.strip()
    # URL
    if val.startswith("http://") or val.startswith("https://"):
        return True
    # 素材ID（纯数字或字母数字组合）
    if len(val) < 200 and not any(c in val for c in "，。、；！？""''【】《》"):
        # 包含常见扩展名
        if any(ext in val.lower() for ext in [".jpg", ".jpeg", ".png", ".gif", ".mp4", ".webp", ".svg"]):
            return True
        # 看起来像ID
        if len(val) < 50:
            return True
    return False


# ─────────── 原有函数 ───────────


def save_uploaded_template(*, filename: str, content: bytes) -> tuple[str, str]:
    settings = get_settings()
    storage_root = Path(settings.storage_root)
    out_dir = storage_root / "imports" / "templates"
    out_dir.mkdir(parents=True, exist_ok=True)
    ext = Path(filename or "template.xlsx").suffix or ".xlsx"
    safe_name = f"ai-import-template-{uuid.uuid4().hex[:12]}{ext}"
    out_path = out_dir / safe_name
    out_path.write_bytes(content)
    return str(out_path), filename


def parse_template_meta(*, template_file_path: str) -> dict[str, Any]:
    """Extract prompt-critical template structure from Temu workbook."""
    wb = load_workbook(template_file_path, data_only=True)
    ws = wb["模版"] if "模版" in wb.sheetnames else wb[wb.sheetnames[0]]

    common_row = 1
    common_values_row = 2
    header_row = 4
    hint_row = 5

    common_fields: list[str] = []
    default_values: dict[str, str] = {}
    detail_headers: list[str] = []
    required_hints: list[str] = []

    for col in range(1, ws.max_column + 1):
        v = ws.cell(row=common_row, column=col).value
        text = str(v).strip() if v is not None else ""
        if text:
            common_fields.append(text)
            default_values[text] = str(ws.cell(row=common_values_row, column=col).value or "").strip()

    for col in range(1, ws.max_column + 1):
        h = ws.cell(row=header_row, column=col).value
        header = str(h).strip() if h is not None else ""
        if not header:
            continue
        detail_headers.append(header)
        hint = str(ws.cell(row=hint_row, column=col).value or "").strip()
        if hint:
            required_hints.append(f"{header}: {hint}")

    required_fields: list[str] = []
    conditional_required_fields: list[str] = []
    for col in range(1, ws.max_column + 1):
        h = ws.cell(row=header_row, column=col).value
        header = str(h).strip() if h is not None else ""
        if not header:
            continue
        hint = str(ws.cell(row=hint_row, column=col).value or "").strip()
        if not hint:
            continue
        if "条件必填" in hint:
            conditional_required_fields.append(header)
        elif "必填" in hint:
            required_fields.append(header)

    enum_options_map: dict[str, list[str]] = {}
    if "KeyValueMap" in wb.sheetnames:
        key_ws = wb["KeyValueMap"]
        for col in range(1, ws.max_column + 1):
            header = str(ws.cell(row=header_row, column=col).value or "").strip()
            if not header:
                continue
            raw = key_ws.cell(row=1, column=col).value
            raw_text = str(raw or "").strip()
            if not raw_text or not raw_text.startswith("{"):
                continue
            try:
                parsed = json.loads(raw_text)
            except Exception:
                continue
            if isinstance(parsed, dict) and parsed:
                enum_options_map[header] = [str(k) for k in parsed.keys()]

    conditional_rules: list[dict[str, Any]] = []
    if "PropertyRelateRequire" in wb.sheetnames and "HeaderKeyMap" in wb.sheetnames:
        pr_ws = wb["PropertyRelateRequire"]
        hk_ws = wb["HeaderKeyMap"]
        header_key_by_col = {
            col: str(hk_ws.cell(row=1, column=col).value or "").strip() for col in range(1, ws.max_column + 1)
        }
        header_label_by_col = {
            col: str(ws.cell(row=header_row, column=col).value or "").strip() for col in range(1, ws.max_column + 1)
        }
        for r in range(1, pr_ws.max_row + 1):
            raw = str(pr_ws.cell(row=r, column=1).value or "").strip()
            if not raw or "_" not in raw:
                continue
            cond_value, prop_id = raw.rsplit("_", 1)
            if not cond_value or not prop_id.isdigit():
                continue
            controller_cols = [
                c for c, k in header_key_by_col.items()
                if k and f"_{prop_id}" in k
            ]
            required_cols = [
                c for c in range(1, ws.max_column + 1)
                if str(pr_ws.cell(row=r, column=c).value or "").strip().lower() == "require"
            ]
            if not controller_cols or not required_cols:
                continue
            controller_headers = [header_label_by_col[c] for c in controller_cols if header_label_by_col.get(c)]
            required_headers = [header_label_by_col[c] for c in required_cols if header_label_by_col.get(c)]
            if not controller_headers or not required_headers:
                continue
            conditional_rules.append(
                {
                    "if_value": cond_value,
                    "if_headers": sorted(set(controller_headers)),
                    "required_headers": sorted(set(required_headers)),
                }
            )

    return {
        "sheet_name": ws.title,
        "common_row": common_row,
        "common_values_row": common_values_row,
        "header_row": header_row,
        "hint_row": hint_row,
        "data_start_row": header_row + 2,
        "common_fields": common_fields,
        "detail_headers": detail_headers,
        "required_hints": required_hints,
        "default_values": default_values,
        "required_fields": required_fields,
        "conditional_required_fields": conditional_required_fields,
        "enum_options_map": enum_options_map,
        "conditional_rules": conditional_rules,
    }


def _merge_validation(base: dict[str, Any], extra: dict[str, Any]) -> dict[str, Any]:
    return {
        "errors": list(base.get("errors") or []) + list(extra.get("errors") or []),
        "warnings": list(base.get("warnings") or []) + list(extra.get("warnings") or []),
    }


def _validate_against_template(
    *,
    template_file_path: str,
    common_fields: dict[str, str],
    headers: list[str],
    rows: list[dict[str, str]],
) -> dict[str, Any]:
    meta = parse_template_meta(template_file_path=template_file_path)
    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []

    expected_headers = meta.get("detail_headers") or []
    expected_set = set(expected_headers)
    incoming_set = set(headers)

    missing_headers = [h for h in expected_headers if h not in incoming_set]
    extra_headers = [h for h in headers if h not in expected_set]
    if missing_headers:
        errors.append({
            "field": "headers",
            "message": "缺少模板字段",
            "missing_headers": missing_headers,
        })
    if extra_headers:
        warnings.append({
            "field": "headers",
            "message": "存在模板外字段",
            "extra_headers": extra_headers,
        })
    if not missing_headers and headers != expected_headers:
        warnings.append({
            "field": "headers",
            "message": "字段顺序与模板不一致",
        })

    # common fields required check
    for field in meta.get("common_fields") or []:
        if not str(common_fields.get(field) or "").strip():
            warnings.append({
                "field": field,
                "message": "公共字段为空，建议补齐",
            })

    required_fields = set(meta.get("required_fields") or [])
    conditional_fields = set(meta.get("conditional_required_fields") or [])
    conditional_rules = meta.get("conditional_rules") or []
    enum_options_map = meta.get("enum_options_map") or {}

    for idx, row in enumerate(rows):
        for field in required_fields:
            if field in incoming_set and not str(row.get(field) or "").strip():
                errors.append({
                    "row_index": idx,
                    "field": field,
                    "message": "模板必填字段为空",
                })
        for field in conditional_fields:
            if field in incoming_set and not str(row.get(field) or "").strip():
                warnings.append({
                    "row_index": idx,
                    "field": field,
                    "message": "条件必填字段为空，需按业务条件确认",
                })
        for rule in conditional_rules:
            if_headers = [h for h in rule.get("if_headers", []) if h in incoming_set]
            if not if_headers:
                continue
            cond_value = str(rule.get("if_value") or "").strip()
            if not cond_value:
                continue
            hit = any(str(row.get(h) or "").strip() == cond_value for h in if_headers)
            if not hit:
                continue
            for req_header in rule.get("required_headers", []):
                if req_header not in incoming_set:
                    continue
                if not str(row.get(req_header) or "").strip():
                    errors.append({
                        "row_index": idx,
                        "field": req_header,
                        "message": f"条件命中后必填（触发值: {cond_value}）",
                    })
        for field, options in enum_options_map.items():
            if field not in incoming_set:
                continue
            val = str(row.get(field) or "").strip()
            if not val:
                continue
            if val not in options:
                warnings.append({
                    "row_index": idx,
                    "field": field,
                    "message": "字段值不在模板枚举中",
                    "value": val,
                })

    _append_spu_sku_validation(errors=errors, warnings=warnings, headers=headers, rows=rows)
    return {"errors": errors, "warnings": warnings}


def _append_spu_sku_validation(
    *,
    errors: list[dict[str, Any]],
    warnings: list[dict[str, Any]],
    headers: list[str],
    rows: list[dict[str, str]],
) -> None:
    if "商品层级" not in headers:
        return
    seen_spu: set[str] = set()
    has_spu_row = False
    for idx, row in enumerate(rows):
        level = str(row.get("商品层级") or "").strip()
        spu_no = str(row.get("SPU货号") or "").strip()
        sku_no = str(row.get("SKU货号") or "").strip()
        spec1 = str(row.get("规格1内容") or "").strip()
        if not level:
            warnings.append({"row_index": idx, "field": "商品层级", "message": "商品层级为空"})
            continue
        if level == "SPU":
            has_spu_row = True
            if not spu_no:
                errors.append({"row_index": idx, "field": "SPU货号", "message": "SPU 行缺少 SPU货号"})
            else:
                seen_spu.add(spu_no)
        elif level == "SKU":
            if not spu_no:
                errors.append({"row_index": idx, "field": "SPU货号", "message": "SKU 行缺少 SPU货号"})
            if not sku_no:
                errors.append({"row_index": idx, "field": "SKU货号", "message": "SKU 行缺少 SKU货号"})
            if not spec1:
                warnings.append({"row_index": idx, "field": "规格1内容", "message": "SKU 行建议填写规格1内容"})
            if spu_no and spu_no not in seen_spu and has_spu_row:
                warnings.append({"row_index": idx, "field": "SPU货号", "message": "SKU 行未匹配到前置 SPU 行"})
        elif level == "单SKU商品":
            if not spu_no or not sku_no:
                warnings.append({"row_index": idx, "field": "SPU货号/SKU货号", "message": "单SKU商品建议同时填写 SPU货号 和 SKU货号"})


def create_ai_import_batch(
    session: Session,
    *,
    name: str,
    raw_json_text: str,
    template_file_path: str | None,
    original_filename: str | None,
) -> tuple[AiImportBatch, AiImportDraft]:
    parsed = _parse_external_ai_json(raw_json_text)
    validation_result = parsed["validation_result"]
    if template_file_path:
        validation_result = _merge_validation(
            validation_result,
            _validate_against_template(
                template_file_path=template_file_path,
                common_fields=parsed["common_fields"],
                headers=parsed["headers"],
                rows=parsed["rows"],
            ),
        )
    batch = AiImportBatch(
        name=name.strip() or "AI导入批次",
        template_file_path=template_file_path,
        original_filename=original_filename,
        raw_json_text=raw_json_text,
        sheet_name=parsed.get("sheet_name") or None,
        parsed_common_fields_json=parsed["common_fields"],
        parsed_headers_json=parsed["headers"],
        parsed_rows_json=parsed["rows"],
        parsed_warnings_json=parsed["warnings"],
        validation_result_json=validation_result,
        status="parsed",
    )
    session.add(batch)
    session.commit()
    session.refresh(batch)

    draft = AiImportDraft(
        batch_id=batch.id,
        common_fields_json=parsed["common_fields"],
        headers_json=parsed["headers"],
        rows_json=parsed["rows"],
        field_settings_json=_build_field_settings(parsed["headers"]),
        validation_result_json=validation_result,
    )
    session.add(draft)
    session.commit()
    session.refresh(draft)
    return batch, draft


def update_ai_import_draft(
    session: Session,
    *,
    batch: AiImportBatch,
    common_fields: dict[str, Any] | None,
    headers: list[str] | None,
    rows: list[dict[str, Any]] | None,
    field_settings: dict[str, Any] | None,
) -> AiImportDraft:
    draft = get_ai_import_draft(session, batch_id=batch.id)
    if draft is None:
        raise ValueError("AI import draft not found")

    next_common = _stringify_common_fields(common_fields if common_fields is not None else draft.common_fields_json)
    next_headers = _normalize_headers(headers if headers is not None else draft.headers_json)
    next_rows = _normalize_rows(rows if rows is not None else draft.rows_json, next_headers)
    next_settings = field_settings if field_settings is not None else draft.field_settings_json
    validation_result = _validate_headers_rows(next_headers, next_rows)
    if batch.template_file_path:
        validation_result = _merge_validation(
            validation_result,
            _validate_against_template(
                template_file_path=batch.template_file_path,
                common_fields=next_common,
                headers=next_headers,
                rows=next_rows,
            ),
        )

    draft.common_fields_json = next_common
    draft.headers_json = next_headers
    draft.rows_json = next_rows
    draft.field_settings_json = next_settings
    draft.validation_result_json = validation_result
    session.add(draft)

    batch.parsed_common_fields_json = next_common
    batch.parsed_headers_json = next_headers
    batch.parsed_rows_json = next_rows
    batch.validation_result_json = validation_result
    batch.status = "confirmed"
    session.add(batch)
    session.commit()
    session.refresh(draft)
    return draft


def export_ai_import_batch(session: Session, *, batch: AiImportBatch) -> tuple[AiImportBatch, str]:
    draft = get_ai_import_draft(session, batch_id=batch.id)
    if draft is None:
        raise ValueError("AI import draft not found")
    if not batch.template_file_path:
        raise ValueError("请先上传 Temu 原始模板")
    validation = draft.validation_result_json or {}
    if validation.get("errors"):
        raise ValueError("字段校验未通过，请先修正后再导出")

    output_path = _write_ai_import_excel(
        template_file_path=batch.template_file_path,
        preferred_sheet_name=batch.sheet_name,
        common_fields=draft.common_fields_json or {},
        headers=draft.headers_json or [],
        rows=draft.rows_json or [],
        field_settings=draft.field_settings_json or {},
        batch_id=batch.id,
    )
    batch.export_file_path = output_path
    batch.status = "exported"
    session.add(batch)
    session.commit()
    session.refresh(batch)
    return batch, output_path


def _parse_external_ai_json(raw_json_text: str) -> dict[str, Any]:
    try:
        payload = json.loads(raw_json_text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"AI JSON 解析失败: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError("AI JSON 顶层必须是对象")

    headers = _normalize_headers(payload.get("headers") or [])
    rows = _normalize_rows(payload.get("rows") or [], headers)
    common_fields = _stringify_common_fields(payload.get("common_fields") or {})
    warnings = payload.get("warnings") if isinstance(payload.get("warnings"), list) else []
    validation_result = _validate_headers_rows(headers, rows)

    if not headers:
        raise ValueError("headers 不能为空")
    if not rows:
        raise ValueError("rows 不能为空")

    return {
        "sheet_name": str(payload.get("sheet_name") or "").strip(),
        "common_fields": common_fields,
        "headers": headers,
        "rows": rows,
        "warnings": warnings,
        "validation_result": validation_result,
    }


def _normalize_headers(value: Any) -> list[str]:
    if not isinstance(value, list):
        raise ValueError("headers 必须为数组")
    headers: list[str] = []
    seen: set[str] = set()
    for item in value:
        name = str(item or "").strip()
        if not name:
            continue
        if name in seen:
            continue
        seen.add(name)
        headers.append(name)
    return headers


def _normalize_rows(value: Any, headers: list[str]) -> list[dict[str, str]]:
    if not isinstance(value, list):
        raise ValueError("rows 必须为数组")
    out: list[dict[str, str]] = []
    extra_fields: set[str] = set()
    for item in value:
        if not isinstance(item, dict):
            raise ValueError("rows 中每一项都必须是对象")
        row: dict[str, str] = {}
        for key in headers:
            row[key] = "" if item.get(key) is None else str(item.get(key))
        for key, raw in item.items():
            key_text = str(key or "").strip()
            if key_text and key_text not in row:
                extra_fields.add(key_text)
                row[key_text] = "" if raw is None else str(raw)
        out.append(row)
    if extra_fields:
        for row in out:
            for key in extra_fields:
                row.setdefault(key, "")
    return out


def _stringify_common_fields(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {str(k): "" if v is None else str(v) for k, v in value.items() if str(k).strip()}


def _validate_headers_rows(headers: list[str], rows: list[dict[str, str]]) -> dict[str, Any]:
    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []

    if not headers:
        errors.append({"field": "headers", "message": "headers 不能为空"})
    if not rows:
        errors.append({"field": "rows", "message": "rows 不能为空"})

    duplicates = [item for item in headers if headers.count(item) > 1]
    if duplicates:
        errors.append({"field": "headers", "message": "headers 存在重复字段", "duplicates": sorted(set(duplicates))})

    header_set = set(headers)
    extra_fields: set[str] = set()
    media_headers = [header for header in headers if any(token in header for token in IMAGE_FIELD_KEYWORDS)]
    for index, row in enumerate(rows):
        for header in headers:
            row.setdefault(header, "")
        for key in row.keys():
            if key not in header_set:
                extra_fields.add(key)
        for media_header in media_headers:
            media_value = str(row.get(media_header) or "").strip()
            if media_value:
                warnings.append(
                    {
                        "row_index": index,
                        "field": media_header,
                        "message": "媒体字段建议留空，后续由系统资产填充",
                    }
                )
        if not any(str(v).strip() for v in row.values()):
            warnings.append({"row_index": index, "message": "该行全部为空"})

    if extra_fields:
        warnings.append(
            {
                "field": "headers",
                "message": "发现 rows 中存在 headers 之外的字段，已保留待确认",
                "extra_fields": sorted(extra_fields),
            }
        )

    return {"errors": errors, "warnings": warnings}


def _build_field_settings(headers: list[str]) -> dict[str, Any]:
    settings: dict[str, Any] = {}
    for header in headers:
        settings[header] = {
            "export": True,
            "field_type": "text",
            "source": "external_ai",
            "is_media_field": any(token in header for token in IMAGE_FIELD_KEYWORDS),
        }
    return settings


def _write_ai_import_excel(
    *,
    template_file_path: str,
    preferred_sheet_name: str | None,
    common_fields: dict[str, str],
    headers: list[str],
    rows: list[dict[str, str]],
    field_settings: dict[str, Any],
    batch_id: int,
) -> str:
    wb = load_workbook(template_file_path)
    ws = wb[preferred_sheet_name] if preferred_sheet_name and preferred_sheet_name in wb.sheetnames else wb[wb.sheetnames[0]]

    header_row = _locate_header_row(ws, headers)
    col_map = _ensure_header_columns(ws, header_row=header_row, headers=headers, field_settings=field_settings)
    _write_common_fields(ws, common_fields)
    data_start_row = _resolve_data_start_row(ws, header_row=header_row)

    for row_offset, row in enumerate(rows, start=1):
        for header in headers:
            settings = field_settings.get(header) or {}
            if settings.get("export", True) is False:
                continue
            col = col_map.get(header)
            if not col:
                continue
            ws.cell(row=data_start_row + row_offset - 1, column=col).value = str(row.get(header) or "")

    settings = get_settings()
    root = Path(settings.storage_root)
    out_dir = root / settings.exports_dir_name
    out_dir.mkdir(parents=True, exist_ok=True)
    filename = f"ai-import-export-{batch_id}-{uuid.uuid4().hex[:8]}.xlsx"
    out_path = out_dir / filename
    wb.save(out_path)
    return f"{settings.exports_dir_name}/{filename}"


def _locate_header_row(ws, headers: list[str]) -> int:
    best_row = 1
    best_score = -1
    header_set = set(headers)
    for row in range(1, min(ws.max_row, 30) + 1):
        values = {str(ws.cell(row=row, column=col).value).strip() for col in range(1, min(ws.max_column, 120) + 1) if ws.cell(row=row, column=col).value}
        score = len(values & header_set)
        if score > best_score:
            best_score = score
            best_row = row
    return best_row


def _ensure_header_columns(ws, *, header_row: int, headers: list[str], field_settings: dict[str, Any]) -> dict[str, int]:
    col_map: dict[str, int] = {}
    next_col = ws.max_column + 1
    for col in range(1, ws.max_column + 1):
        value = ws.cell(row=header_row, column=col).value
        name = str(value).strip() if value is not None else ""
        if name:
            col_map[name] = col
    for header in headers:
        settings = field_settings.get(header) or {}
        if settings.get("export", True) is False:
            continue
        if header in col_map:
            continue
        ws.cell(row=header_row, column=next_col).value = header
        col_map[header] = next_col
        next_col += 1
    return col_map


def _resolve_data_start_row(ws, *, header_row: int) -> int:
    """
    Temu templates usually place field hints right below headers.
    Keep that row intact and write data from the next row.
    """
    hint_row = header_row + 1
    has_hint = False
    for col in range(1, ws.max_column + 1):
        val = ws.cell(row=hint_row, column=col).value
        text = str(val).strip() if val is not None else ""
        if text:
            has_hint = True
            break
    return header_row + 2 if has_hint else header_row + 1


def _write_common_fields(ws, common_fields: dict[str, str]) -> None:
    if not common_fields:
        return
    located: set[str] = set()
    for row in range(1, min(ws.max_row, 20) + 1):
        for col in range(1, min(ws.max_column, 20) + 1):
            cell_value = ws.cell(row=row, column=col).value
            key = str(cell_value).strip() if cell_value is not None else ""
            if key and key in common_fields:
                ws.cell(row=row, column=col + 1).value = common_fields[key]
                located.add(key)
    if len(located) == len(common_fields):
        return
    insert_row = 1
    for key, value in common_fields.items():
        if key in located:
            continue
        ws.cell(row=insert_row, column=max(ws.max_column + 1, 1)).value = key
        ws.cell(row=insert_row, column=max(ws.max_column + 2, 2)).value = value
        insert_row += 1
