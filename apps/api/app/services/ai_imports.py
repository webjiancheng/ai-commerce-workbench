from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.ai_import_batch import AiImportBatch
from app.models.ai_import_draft import AiImportDraft
from app.services.export_adapters.registry import get_export_adapter
from app.services.listing_validation import validate_task_payload
from app.services.temu_upload_template import (
    get_builtin_temu_upload_template_path,
    normalize_listing_field_key,
    normalize_listing_fields,
    parse_template_meta as parse_temu_template_meta,
)


IMAGE_FIELD_KEYWORDS = ("图", "图片", "视频", "预览图", "轮播图", "详情图文")


def _resolve_template_file_path(template_file_path: str | None) -> str:
    if template_file_path and str(template_file_path).strip():
        return str(template_file_path).strip()
    return get_builtin_temu_upload_template_path()


def _new_ai_import_batch_no(batch_id: int) -> str:
    return f"ai-import-{batch_id}-{uuid.uuid4().hex[:8]}"


def list_ai_import_batches(session: Session, *, limit: int = 20) -> list[AiImportBatch]:
    return session.scalars(select(AiImportBatch).order_by(AiImportBatch.created_at.desc()).limit(limit)).all()


def get_ai_import_batch(session: Session, *, batch_id: int) -> AiImportBatch | None:
    return session.get(AiImportBatch, batch_id)


def get_ai_import_draft(session: Session, *, batch_id: int) -> AiImportDraft | None:
    return session.scalar(select(AiImportDraft).where(AiImportDraft.batch_id == batch_id).limit(1))


def ensure_ai_import_draft(session: Session, *, batch: AiImportBatch) -> AiImportDraft:
    draft = get_ai_import_draft(session, batch_id=batch.id)
    if draft is not None:
        return draft

    headers = [str(x).strip() for x in (batch.parsed_headers_json or []) if str(x).strip()]
    rows = batch.parsed_rows_json or []
    common_fields = batch.parsed_common_fields_json or {}
    normalized_common = _normalize_ai_common_fields(_stringify_common_fields(common_fields))
    normalized_headers, normalized_rows = _normalize_ai_rows(headers, rows)
    validation_result = batch.validation_result_json or _validate_headers_rows(normalized_headers, normalized_rows)
    validation_result = _merge_validation(
        validation_result,
        _validate_against_template(
            template_file_path=_resolve_template_file_path(batch.template_file_path),
            common_fields=normalized_common,
            headers=normalized_headers,
            rows=normalized_rows,
        ),
    )

    draft = AiImportDraft(
        batch_id=batch.id,
        common_fields_json=normalized_common,
        headers_json=normalized_headers,
        rows_json=normalized_rows,
        field_settings_json=_build_field_settings(normalized_headers),
        validation_result_json=validation_result,
    )
    session.add(draft)
    batch.parsed_common_fields_json = normalized_common
    batch.parsed_headers_json = normalized_headers
    batch.parsed_rows_json = normalized_rows
    batch.validation_result_json = validation_result
    session.add(batch)
    session.commit()
    session.refresh(draft)
    return draft


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
    raw = normalize_listing_fields(rule.values_json or {}, keep_unknown=True, include_auxiliary=True)
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
        result[str(task.id)] = normalize_listing_fields(row, keep_unknown=True, include_auxiliary=False)

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
    rows = [normalize_listing_fields(dict(r), keep_unknown=True, include_auxiliary=False) for r in draft.rows_json]
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
    if batch:
        validation = _merge_validation(
            validation,
            _validate_against_template(
                template_file_path=_resolve_template_file_path(batch.template_file_path),
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
    meta = parse_temu_template_meta(template_file_path=template_file_path)
    default_values = {
        item["field_name"]: item.get("default_value", "")
        for item in meta.get("common_fields", [])
    }
    return {
        "sheet_name": meta["sheet_name"],
        "common_row": meta["common_row"],
        "common_values_row": meta["common_values_row"],
        "header_row": meta["header_row"],
        "hint_row": meta["hint_row"],
        "data_start_row": meta["data_start_row"],
        "common_fields": meta["common_field_names"],
        "detail_headers": meta["detail_headers"],
        "required_hints": meta["required_hints"],
        "default_values": default_values,
        "required_fields": meta["required_fields"],
        "conditional_required_fields": meta["conditional_required_fields"],
        "enum_options_map": meta["enum_options_map"],
        "conditional_rules": meta["conditional_rules"],
    }


def _merge_validation(base: dict[str, Any], extra: dict[str, Any]) -> dict[str, Any]:
    return {
        "errors": list(base.get("errors") or []) + list(extra.get("errors") or []),
        "warnings": list(base.get("warnings") or []) + list(extra.get("warnings") or []),
    }


def _normalize_ai_common_fields(common_fields: dict[str, str]) -> dict[str, str]:
    normalized = normalize_listing_fields(common_fields or {}, keep_unknown=True, include_auxiliary=False)
    # 顶部公共字段里仍可能使用“发货仓”，统一补一份到模板公共字段“发货仓1”
    if normalized.get("发货仓") and not normalized.get("发货仓1"):
        normalized["发货仓1"] = normalized["发货仓"]
    return {str(k): "" if v is None else str(v) for k, v in normalized.items()}


def _normalize_ai_rows(headers: list[str], rows: list[dict[str, str]]) -> tuple[list[str], list[dict[str, str]]]:
    normalized_header_order: list[str] = []
    seen: set[str] = set()
    for header in headers:
        normalized = str(header or "").strip()
        if not normalized:
            continue
        normalized_key = normalize_listing_field_key(normalized)
        if normalized_key in seen:
            continue
        seen.add(normalized_key)
        normalized_header_order.append(normalized_key)

    normalized_rows: list[dict[str, str]] = []
    for row in rows:
        normalized_row = normalize_listing_fields(row or {}, keep_unknown=True, include_auxiliary=False)
        filtered_row = {header: str(normalized_row.get(header) or "") for header in normalized_header_order}
        normalized_rows.append(filtered_row)
    return normalized_header_order, normalized_rows


def _validate_against_template(
    *,
    template_file_path: str,
    common_fields: dict[str, str],
    headers: list[str],
    rows: list[dict[str, str]],
) -> dict[str, Any]:
    meta = parse_temu_template_meta(template_file_path=template_file_path)
    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []

    normalized_common = _normalize_ai_common_fields(common_fields)
    normalized_headers, normalized_rows = _normalize_ai_rows(headers, rows)
    expected_headers = meta.get("detail_headers") or []
    expected_set = set(expected_headers)
    incoming_set = set(normalized_headers)

    missing_headers = [h for h in expected_headers if h not in incoming_set]
    extra_headers = [h for h in normalized_headers if h not in expected_set]
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
    if not missing_headers and normalized_headers != expected_headers:
        warnings.append({
            "field": "headers",
            "message": "字段顺序与模板不一致",
        })

    validation = validate_task_payload(
        common_fields=normalized_common,
        rows=normalized_rows,
        template_meta=meta,
    )
    return _merge_validation({"errors": errors, "warnings": warnings}, validation)


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
    parsed_common = _normalize_ai_common_fields(parsed["common_fields"])
    parsed_headers, parsed_rows = _normalize_ai_rows(parsed["headers"], parsed["rows"])
    validation_result = parsed["validation_result"]
    effective_template_path = _resolve_template_file_path(template_file_path)
    validation_result = _merge_validation(
        validation_result,
        _validate_against_template(
            template_file_path=effective_template_path,
            common_fields=parsed_common,
            headers=parsed_headers,
            rows=parsed_rows,
        ),
    )
    batch = AiImportBatch(
        name=name.strip() or "AI导入批次",
        template_file_path=effective_template_path,
        original_filename=original_filename,
        raw_json_text=raw_json_text,
        sheet_name=parsed.get("sheet_name") or None,
        parsed_common_fields_json=parsed_common,
        parsed_headers_json=parsed_headers,
        parsed_rows_json=parsed_rows,
        parsed_warnings_json=parsed["warnings"],
        validation_result_json=validation_result,
        status="parsed",
    )
    session.add(batch)
    session.commit()
    session.refresh(batch)

    draft = AiImportDraft(
        batch_id=batch.id,
        common_fields_json=parsed_common,
        headers_json=parsed_headers,
        rows_json=parsed_rows,
        field_settings_json=_build_field_settings(parsed_headers),
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
    draft = ensure_ai_import_draft(session, batch=batch)

    next_common = _normalize_ai_common_fields(_stringify_common_fields(common_fields if common_fields is not None else draft.common_fields_json))
    raw_headers = _normalize_headers(headers if headers is not None else draft.headers_json)
    raw_rows = _normalize_rows(rows if rows is not None else draft.rows_json, raw_headers)
    next_headers, next_rows = _normalize_ai_rows(raw_headers, raw_rows)
    source_settings = field_settings if field_settings is not None else draft.field_settings_json
    next_settings = _normalize_field_settings_for_headers(next_headers, source_settings)
    validation_result = _validate_headers_rows(next_headers, next_rows)
    validation_result = _merge_validation(
        validation_result,
        _validate_against_template(
            template_file_path=_resolve_template_file_path(batch.template_file_path),
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
    draft = ensure_ai_import_draft(session, batch=batch)
    validation = draft.validation_result_json or {}
    if validation.get("errors"):
        raise ValueError("字段校验未通过，请先修正后再导出")

    template_path = _resolve_template_file_path(batch.template_file_path)
    adapter = get_export_adapter("temu_half_managed_jewelry_upload")
    output_path = adapter.write_excel(
        common_fields=_normalize_ai_common_fields(draft.common_fields_json or {}),
        rows=[normalize_listing_fields(row or {}, keep_unknown=True, include_auxiliary=False) for row in (draft.rows_json or [])],
        batch_no=_new_ai_import_batch_no(batch.id),
        template_file_path=template_path,
        preferred_sheet_name=batch.sheet_name,
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
    for index, row in enumerate(rows):
        for header in headers:
            row.setdefault(header, "")
        for key in row.keys():
            if key not in header_set:
                extra_fields.add(key)
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


def _normalize_field_settings_for_headers(
    headers: list[str],
    field_settings: dict[str, Any] | None,
) -> dict[str, Any]:
    normalized = _build_field_settings(headers)
    raw = field_settings if isinstance(field_settings, dict) else {}
    for raw_key, raw_meta in raw.items():
        key = normalize_listing_field_key(str(raw_key or "").strip())
        if not key or key not in normalized:
            continue
        if not isinstance(raw_meta, dict):
            continue
        merged = {**normalized[key], **raw_meta}
        merged["is_media_field"] = any(token in key for token in IMAGE_FIELD_KEYWORDS)
        normalized[key] = merged
    return normalized
