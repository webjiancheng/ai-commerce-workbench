from __future__ import annotations

import json
import re
from typing import Any


_DECIMAL_2_RE = re.compile(r"^\d+(?:\.\d{1,2})?$")
_DIGITS_RE = re.compile(r"^\d+$")
_HTTP_RE = re.compile(r"^https?://", re.IGNORECASE)


def validate_listing_row(
    *,
    row: dict[str, Any],
    template_meta: dict[str, Any],
    asset_dimensions_by_url: dict[str, tuple[int | None, int | None]] | None = None,
) -> dict[str, Any]:
    if str(template_meta.get("adapter_key") or "").strip() == "miaoshou_temu_non_apparel":
        return _validate_miaoshou_listing_row(row=row, template_meta=template_meta)
    return _validate_half_managed_listing_row(
        row=row,
        template_meta=template_meta,
        asset_dimensions_by_url=asset_dimensions_by_url,
    )


def _validate_half_managed_listing_row(
    *,
    row: dict[str, Any],
    template_meta: dict[str, Any],
    asset_dimensions_by_url: dict[str, tuple[int | None, int | None]] | None = None,
) -> dict[str, Any]:
    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    incoming_fields = set(row.keys())

    required_fields = set(template_meta.get("required_fields") or [])
    conditional_rules = template_meta.get("conditional_rules") or []
    enum_options_map = template_meta.get("enum_options_map") or {}

    for field in required_fields:
        if field in incoming_fields and not str(row.get(field) or "").strip():
            errors.append(_issue(field, "missing_required", f"{field} 为必填", True))

    for rule in conditional_rules:
        trigger_field = str(rule.get("if_field") or "").strip()
        trigger_value = str(rule.get("if_value") or "").strip()
        if not trigger_field or not trigger_value:
            continue
        if str(row.get(trigger_field) or "").strip() != trigger_value:
            continue
        for field in rule.get("required_headers") or []:
            if field in incoming_fields and not str(row.get(field) or "").strip():
                errors.append(_issue(field, "missing_conditional_required", f"{field} 在条件命中时必填", True))

    for field, options in enum_options_map.items():
        if field not in incoming_fields:
            continue
        value = str(row.get(field) or "").strip()
        if value and value not in options:
            errors.append(_issue(field, "invalid_enum", f"{field} 不在模板枚举中", True))

    blocking_fields = [
        "商品层级",
        "SPU货号",
        "SKU货号",
        "申报价格-美国站",
        "发货仓1",
        "发货仓1库存",
        "SKU预览图-英语",
        "商品轮播图1",
        "商品轮播图2",
        "商品轮播图3",
    ]
    for field in blocking_fields:
        if not str(row.get(field) or "").strip():
            errors.append(_issue(field, "missing_blocking", f"{field} 未填写", True))

    _validate_packaging_rules(row=row, errors=errors)
    _validate_media_fields(
        row=row,
        warnings=warnings,
        asset_dimensions_by_url=asset_dimensions_by_url or {},
    )

    return {
        "errors": errors,
        "warnings": warnings,
        "summary": {
            "error_count": len(errors),
            "warning_count": len(warnings),
            "exportable": len(errors) == 0,
        },
    }


def _validate_miaoshou_listing_row(
    *,
    row: dict[str, Any],
    template_meta: dict[str, Any],
) -> dict[str, Any]:
    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []

    required_fields = set(template_meta.get("required_fields") or [])
    for field in required_fields:
        if not str(row.get(field) or "").strip():
            errors.append(_issue(field, "missing_required", f"{field} 为必填", True))

    _validate_value_set(row=row, field_name="*承诺发货时效", options={"1", "2", "9"}, errors=errors)
    _validate_value_set(row=row, field_name="*定制品", options={"是", "否"}, errors=errors)
    _validate_value_set(row=row, field_name="* 是否敏感属性", options={"是", "否"}, errors=errors)
    _validate_value_set(row=row, field_name="产品编码类型", options={"", "UPC", "EAN", "ISBN"}, errors=errors)
    _validate_value_set(row=row, field_name="SKU分类类型", options={"", "单品", "组合装", "混合套装"}, errors=errors)
    _validate_value_set(row=row, field_name="SKU分类单位", options={"", "件", "双", "包"}, errors=errors)

    for field in ["* 申报价\n（CNY）", "建议售价\n（（CNY））", "* 长（cm）", "* 宽（cm）", "* 高（cm）"]:
        _validate_decimal_2(row=row, field_name=field, errors=errors)
    _validate_number(row=row, field_name="* 重量（g）", errors=errors)
    _validate_digits_only(row=row, field_name="产品编码", errors=errors)
    _validate_positive_int(row=row, field_name="SKU分类数量", errors=errors)
    _validate_positive_int(row=row, field_name="包装清单数量", errors=errors)
    _validate_pdf_url(row=row, field_name="产品说明书", errors=errors)

    _validate_url_fields(row=row, field_name="* 产品轮播图", required=True, max_count=10, errors=errors)
    _validate_url_fields(row=row, field_name="* 产品素材图", required=True, max_count=1, errors=errors)
    _validate_url_fields(row=row, field_name="* 预览图", required=True, max_count=1, errors=errors)
    _validate_url_fields(row=row, field_name="主图视频", required=False, max_count=1, errors=errors)

    is_sensitive = str(row.get("* 是否敏感属性") or "").strip()
    sensitive_value = str(row.get("敏感属性值") or "").strip()
    if is_sensitive == "是" and not sensitive_value:
        warnings.append(_issue("敏感属性值", "missing_sensitive_detail", "敏感商品建议填写敏感属性值", False))

    if "纯电" in sensitive_value or "内置电池" in sensitive_value:
        if not str(row.get("储电容量") or "").strip():
            warnings.append(_issue("储电容量", "missing_battery_capacity", "敏感属性含电池时建议填写储电容量", False))
    if "刀具" in sensitive_value:
        if not str(row.get("刀具长度") or "").strip():
            warnings.append(_issue("刀具长度", "missing_blade_length", "敏感属性含刀具时建议填写刀具长度", False))
        if not str(row.get("刀具尖度") or "").strip():
            warnings.append(_issue("刀具尖度", "missing_blade_tip", "敏感属性含刀具时建议填写刀具尖度", False))
    if "液体" in sensitive_value and not str(row.get("液体容量") or "").strip():
        warnings.append(_issue("液体容量", "missing_liquid_capacity", "敏感属性含液体时建议填写液体容量", False))

    sku_class = str(row.get("SKU分类类型") or "").strip()
    if sku_class in {"组合装", "混合套装"} and not str(row.get("是否独立包装") or "").strip():
        warnings.append(_issue("是否独立包装", "missing_independent_packaging", "组合装/混合套装建议填写是否独立包装", False))

    origin = str(row.get("*产地") or "").strip()
    if origin == "中国":
        warnings.append(_issue("*产地", "origin_province_recommended", "中国建议填写为 中国-省份", False))

    return {
        "errors": errors,
        "warnings": warnings,
        "summary": {
            "error_count": len(errors),
            "warning_count": len(warnings),
            "exportable": len(errors) == 0,
        },
    }


def validate_task_payload(
    *,
    common_fields: dict[str, Any],
    rows: list[dict[str, Any]],
    template_meta: dict[str, Any],
    asset_dimensions_by_url: dict[str, tuple[int | None, int | None]] | None = None,
) -> dict[str, Any]:
    row_results = [
        validate_listing_row(
            row={**common_fields, **row},
            template_meta=template_meta,
            asset_dimensions_by_url=asset_dimensions_by_url,
        )
        for row in rows
    ]

    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    for index, result in enumerate(row_results):
        for item in result["errors"]:
            errors.append({**item, "row_index": index})
        for item in result["warnings"]:
            warnings.append({**item, "row_index": index})

    for field in template_meta.get("common_field_names") or []:
        if not str(common_fields.get(field) or "").strip():
            warnings.append(_issue(field, "missing_common", f"{field} 公共字段为空", False))

    return {
        "errors": errors,
        "warnings": warnings,
        "summary": {
            "error_count": len(errors),
            "warning_count": len(warnings),
            "exportable": len(errors) == 0,
            "row_count": len(rows),
        },
    }


def parse_sku_rows_from_draft(fields: dict[str, Any]) -> list[dict[str, Any]]:
    raw_value = fields.get("SKU信息明细")
    if isinstance(raw_value, list):
        return [item for item in raw_value if isinstance(item, dict)]
    if isinstance(raw_value, str) and raw_value.strip():
        try:
            parsed = json.loads(raw_value)
        except Exception:
            return []
        return [item for item in parsed if isinstance(item, dict)] if isinstance(parsed, list) else []
    return []


def _validate_packaging_rules(*, row: dict[str, Any], errors: list[dict[str, Any]]) -> None:
    sku_class = str(row.get("SKU分类") or "").strip()
    if sku_class in {"同款多件装", "混合套装"} and not str(row.get("是否独立包装") or "").strip():
        errors.append(_issue("是否独立包装", "missing_packaging", "套装商品必须填写是否独立包装", True))


def _validate_media_fields(
    *,
    row: dict[str, Any],
    warnings: list[dict[str, Any]],
    asset_dimensions_by_url: dict[str, tuple[int | None, int | None]],
) -> None:
    for field in ["商品轮播图1", "商品轮播图2", "商品轮播图3", "SKU预览图-英语"]:
        value = str(row.get(field) or "").strip()
        if not value:
            continue
        width, height = asset_dimensions_by_url.get(value, (None, None))
        if width is not None and width < 800:
            warnings.append(_issue(field, "image_width_low", f"{field} 宽度低于 800px", False))
        if height is not None and height < 800:
            warnings.append(_issue(field, "image_height_low", f"{field} 高度低于 800px", False))
        if width and height and width != height:
            warnings.append(_issue(field, "image_ratio_invalid", f"{field} 不是 1:1", False))

    if not str(row.get("详情图文-英语") or "").strip():
        warnings.append(_issue("详情图文-英语", "missing_detail_content", "详情图文为空", False))
    if not str(row.get("主图视频") or "").strip():
        warnings.append(_issue("主图视频", "missing_main_video", "主图视频为空", False))
    if not str(row.get("详情视频") or "").strip():
        warnings.append(_issue("详情视频", "missing_detail_video", "详情视频为空", False))


def _validate_value_set(
    *,
    row: dict[str, Any],
    field_name: str,
    options: set[str],
    errors: list[dict[str, Any]],
) -> None:
    value = str(row.get(field_name) or "").strip()
    if value not in options:
        errors.append(_issue(field_name, "invalid_enum", f"{field_name} 取值不合法", True))


def _validate_decimal_2(*, row: dict[str, Any], field_name: str, errors: list[dict[str, Any]]) -> None:
    value = str(row.get(field_name) or "").strip()
    if not value:
        return
    if not _DECIMAL_2_RE.match(value):
        errors.append(_issue(field_name, "invalid_decimal", f"{field_name} 需为最多两位小数", True))


def _validate_number(*, row: dict[str, Any], field_name: str, errors: list[dict[str, Any]]) -> None:
    value = str(row.get(field_name) or "").strip()
    if not value:
        return
    try:
        float(value)
    except Exception:  # noqa: BLE001
        errors.append(_issue(field_name, "invalid_number", f"{field_name} 必须为数字", True))


def _validate_digits_only(*, row: dict[str, Any], field_name: str, errors: list[dict[str, Any]]) -> None:
    value = str(row.get(field_name) or "").strip()
    if not value:
        return
    if not _DIGITS_RE.match(value):
        errors.append(_issue(field_name, "invalid_digits", f"{field_name} 仅支持数字", True))


def _validate_positive_int(*, row: dict[str, Any], field_name: str, errors: list[dict[str, Any]]) -> None:
    value = str(row.get(field_name) or "").strip()
    if not value:
        return
    if not _DIGITS_RE.match(value) or int(value) <= 0:
        errors.append(_issue(field_name, "invalid_positive_int", f"{field_name} 仅支持大于0整数", True))


def _validate_pdf_url(*, row: dict[str, Any], field_name: str, errors: list[dict[str, Any]]) -> None:
    value = str(row.get(field_name) or "").strip()
    if not value:
        return
    if not _HTTP_RE.match(value) or not value.lower().endswith(".pdf"):
        errors.append(_issue(field_name, "invalid_pdf_url", f"{field_name} 需为 PDF URL", True))


def _validate_url_fields(
    *,
    row: dict[str, Any],
    field_name: str,
    required: bool,
    max_count: int,
    errors: list[dict[str, Any]],
) -> None:
    value = str(row.get(field_name) or "").strip()
    if required and not value:
        errors.append(_issue(field_name, "missing_required", f"{field_name} 为必填", True))
        return
    if not value:
        return
    urls = [item.strip() for item in value.replace("\r\n", "\n").split("\n") if item.strip()]
    if len(urls) > max_count:
        errors.append(_issue(field_name, "too_many_values", f"{field_name} 最多 {max_count} 条", True))
    for item in urls:
        if not _HTTP_RE.match(item):
            errors.append(_issue(field_name, "invalid_url", f"{field_name} 存在非法URL", True))


def _issue(field: str, issue_type: str, message: str, blocking: bool) -> dict[str, Any]:
    return {
        "field": field,
        "field_name": field,
        "field_key": field,
        "type": issue_type,
        "message": message,
        "blocking": blocking,
    }
