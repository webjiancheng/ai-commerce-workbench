from __future__ import annotations

import hashlib
from pathlib import Path

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.export_field_mapping import ExportFieldMapping
from app.models.export_template import ExportTemplate
from app.services.export_template_parser import generate_fields_markdown, parse_template_fields, to_fields_json


def seed_default_export_template(session: Session) -> None:
    settings = get_settings()
    template_path = Path(settings.default_export_template_path)
    if not template_path.exists():
        return

    # Parse fields from real Excel template
    fields = parse_template_fields(file_path=str(template_path), header_row_index=1, sheet_name="Sheet1")
    fields_json = to_fields_json(fields)

    # docs/export-template-fields.md (repo root)
    repo_root = Path(__file__).resolve().parents[4]
    generate_fields_markdown(fields=fields, out_path=str(repo_root / "docs" / "export-template-fields.md"))

    version = _sha1_of_file(template_path)[:12]

    existing = session.scalar(
        select(ExportTemplate).where(ExportTemplate.platform == "temu", ExportTemplate.version == version).limit(1)
    )
    if existing is None:
        tpl = ExportTemplate(
            name="妙手Temu导入模板-非服饰类",
            version=version,
            platform="temu",
            template_type="temu_miaoshou",
            file_path=str(template_path),
            header_row_index=1,
            fields_json=fields_json,
            enabled=True,
            is_default=True,
        )
        session.add(tpl)
        session.commit()
        session.refresh(tpl)
        _seed_default_mappings(session, template_id=tpl.id, fields=fields)
        # ensure only one default for platform
        session.execute(
            update(ExportTemplate)
            .where(ExportTemplate.platform == "temu", ExportTemplate.id != tpl.id)
            .values(is_default=False)
        )
        session.commit()
        return

    # Update fields_json if template file changed but same version (unlikely)
    existing.fields_json = fields_json
    existing.file_path = str(template_path)
    existing.header_row_index = 1
    session.add(existing)
    session.commit()

    # Ensure mappings exist
    _seed_default_mappings(session, template_id=existing.id, fields=fields)


def _seed_default_mappings(session: Session, *, template_id: int, fields) -> None:
    existing = session.scalars(
        select(ExportFieldMapping).where(ExportFieldMapping.template_id == template_id)
    ).all()
    existing_by_key = {m.field_key: m for m in existing}

    for f in fields:
        source_type, source_path, default_value = _default_mapping_for_field(f.field_name)
        found = existing_by_key.get(f.field_key)
        if found is not None:
            # Backfill older mappings that had no source mapping before.
            if (not found.source_type or not found.source_path) and source_type and source_path:
                found.source_type = source_type
                found.source_path = source_path
                if found.default_value in (None, "") and default_value not in (None, ""):
                    found.default_value = default_value
                session.add(found)
            continue
        session.add(
            ExportFieldMapping(
                template_id=template_id,
                field_key=f.field_key,
                field_name=f.field_name,
                column_index=f.column_index,
                required=bool(f.required),
                source_type=source_type,
                source_path=source_path,
                default_value=default_value,
                transform_rule_json={},
                validation_rule_json={},
                enabled=True,
            )
        )
    session.commit()


def _default_mapping_for_field(field_name: str) -> tuple[str | None, str | None, str | None]:
    name = (field_name or "").strip()
    norm = name.replace(" ", "")

    # Title / category / URLs
    if "类目ID" in norm:
        return ("draft", "selected_category_id", None)
    if "产品标题" in norm or "商品标题" in norm:
        return ("draft", "product_title_cn", None)
    if "英文标题" in norm:
        return ("draft", "product_title_en", None)
    if "产品描述" in norm:
        return ("draft", "product_description", None)
    if "站外产品链接" in norm:
        return ("draft", "source_url", None)

    # Images
    if "产品轮播图" in norm:
        # Template accepts one merged field; export all configured carousel slots in order.
        return (
            "asset",
            "carousel_1,carousel_2,carousel_3,carousel_4,carousel_5,carousel_6,carousel_7,carousel_8",
            None,
        )
    if "产品素材图" in norm or "预览图" in norm:
        return ("asset", "preview_1,preview_2,preview_3", None)

    # Shipping / origin / customization
    if "承诺发货" in norm:
        return ("draft", "shipping_time", "48小时")
    if "产地" in norm:
        return ("draft", "origin_country", None)
    if "定制品" in norm:
        return ("draft", "is_custom", "否")

    # SKU / specs
    if "规格名称1" in norm:
        return ("draft", "sku_spec1_name", None)
    if "规格属性值1" in norm:
        return ("draft", "sku_spec1_value", None)
    if "规格名称2" in norm:
        return ("draft", "sku_spec2_name", None)
    if "规格属性值2" in norm:
        return ("draft", "sku_spec2_value", None)
    if "平台SKU" in norm:
        return ("draft", "platform_sku", None)
    if "主编号" in norm:
        return ("draft", "master_no", None)
    if "主货号" in norm:
        return ("draft", "master_item_no", None)
    if "库存" in norm:
        return ("draft", "stock_qty", None)

    # Price / dimensions
    if "申报价" in norm:
        return ("draft", "declared_price_cny", None)
    if "建议售价" in norm:
        return ("draft", "suggested_price_cny", None)
    if "长（cm）" in norm or "长(cm)" in norm:
        return ("draft", "length_cm", None)
    if "宽（cm）" in norm or "宽(cm)" in norm:
        return ("draft", "width_cm", None)
    if "高（cm）" in norm or "高(cm)" in norm:
        return ("draft", "height_cm", None)
    if "重量（g）" in norm or "重量(g)" in norm:
        return ("draft", "weight_g", None)

    # Sensitive
    if "是否敏感" in norm:
        return ("draft", "is_sensitive", "否")
    if "敏感属性值" in norm:
        return ("draft", "sensitive_type", None)

    # Extra template fields (non-apparel)
    if "储电容量" in norm:
        return ("draft", "battery_capacity", None)
    if "刀具长度" in norm:
        return ("draft", "blade_length", None)
    if "刀具尖度" in norm:
        return ("draft", "blade_tip_sharpness", None)
    if "液体容量" in norm:
        return ("draft", "liquid_capacity", None)
    if "产品编码类型" in norm:
        return ("draft", "product_code_type", None)
    if "产品编码" in norm:
        return ("draft", "product_code", None)
    if "SKU分类类型" in norm:
        return ("draft", "sku_class_type", None)
    if "SKU分类数量" in norm:
        return ("draft", "sku_class_count", None)
    if "SKU分类单位" in norm:
        return ("draft", "sku_class_unit", None)
    if "是否独立包装" in norm:
        return ("draft", "is_independent_packaging", None)
    if "包装清单数量" in norm:
        return ("draft", "packing_list_count", None)
    if "包装清单" in norm:
        return ("draft", "packing_list", None)
    if "主图视频" in norm:
        return ("draft", "main_video_url", None)
    if "产品说明书" in norm:
        return ("draft", "manual_url", None)
    if "货源链接" in norm:
        return ("draft", "supplier_url", None)

    return (None, None, None)


def _sha1_of_file(path: Path) -> str:
    h = hashlib.sha1()
    h.update(path.read_bytes())
    return h.hexdigest()
