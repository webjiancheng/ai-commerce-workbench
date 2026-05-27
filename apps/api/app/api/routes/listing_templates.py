from __future__ import annotations

from pathlib import Path
from typing import Annotated

from sqlalchemy import select
from sqlalchemy.orm import Session
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.db.session import get_db_session
from app.models.listing_template import ListingTemplate
from app.schemas.listing_template import (
    ListingTemplateCreate,
    ListingTemplateOut,
    ListingTemplateUpdate,
)

router = APIRouter(prefix="/listing-templates", tags=["category-field-schemes"])


@router.get("", response_model=list[ListingTemplateOut])
def list_templates(
    session: Annotated[Session, Depends(get_db_session)],
    platform: str | None = None,
    category_keywords: str | None = None,
    is_active: bool | None = None,
    limit: int = Query(default=50, ge=1, le=200),
):
    q = select(ListingTemplate)
    if platform:
        q = q.where(ListingTemplate.platform == platform)
    if category_keywords:
        q = q.where(ListingTemplate.category_keywords.ilike(f"%{category_keywords}%"))
    if is_active is not None:
        q = q.where(ListingTemplate.is_active == is_active)
    q = q.order_by(ListingTemplate.is_builtin.desc(), ListingTemplate.id.asc()).limit(limit)
    return session.scalars(q).all()


@router.get("/{template_id}", response_model=ListingTemplateOut)
def get_template(
    template_id: int,
    session: Annotated[Session, Depends(get_db_session)],
):
    tmpl = session.get(ListingTemplate, template_id)
    if not tmpl:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="类目字段方案不存在")
    return tmpl


@router.post("", response_model=ListingTemplateOut, status_code=201)
def create_template(
    data: ListingTemplateCreate,
    session: Annotated[Session, Depends(get_db_session)],
):
    tmpl = ListingTemplate(**data.model_dump())
    session.add(tmpl)
    session.commit()
    session.refresh(tmpl)
    return tmpl


@router.get("/{template_id}/download")
def download_template_excel(
    template_id: int,
    session: Annotated[Session, Depends(get_db_session)],
) -> dict[str, object]:
    """
    将 listing_template 的字段配置导出为 Excel 类目字段方案文件。
    从 uniform_defaults_json 和 category_fields_json 读取字段，
    按后端 listing_default_fields.py 的字段分组写入 Excel。
    """
    tmpl = session.get(ListingTemplate, template_id)
    if not tmpl:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="类目字段方案不存在")

    # 按设计方案字段分层组织内容
    uniform = tmpl.uniform_defaults_json or {}
    category = tmpl.category_fields_json or {}

    # 构建字段分组数据
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

    wb = Workbook()
    ws = wb.active
    ws.title = tmpl.name[:31] if tmpl.name else "字段方案"

    # 样式定义
    header_font = Font(bold=True, size=12, color="FFFFFF")
    header_fill = PatternFill("solid", fgColor="1E293B")  # 深蓝灰
    group_font = Font(bold=True, size=11, color="FFFFFF")
    group_fills = {
        "经营配置": PatternFill("solid", fgColor="1D4ED8"),      # 蓝
        "商品与SKU默认": PatternFill("solid", fgColor="6D28D9"),  # 紫
        "尺寸与重量": PatternFill("solid", fgColor="047857"),     # 绿
        "敏感属性": PatternFill("solid", fgColor="B91C1C"),      # 红
        "类目属性": PatternFill("solid", fgColor="0369A1"),       # 天蓝
        "风格与场合": PatternFill("solid", fgColor="7C3AED"),     # 紫罗兰
        "人工必填": PatternFill("solid", fgColor="B45309"),      # 琥珀
        "其他字段": PatternFill("solid", fgColor="374151"),       # 灰
    }
    cell_font = Font(size=10)
    thin_border = Border(
        left=Side(style="thin", color="CBD5E1"),
        right=Side(style="thin", color="CBD5E1"),
        top=Side(style="thin", color="CBD5E1"),
        bottom=Side(style="thin", color="CBD5E1"),
    )

    # 分组顺序
    GROUP_ORDER = ["经营配置", "商品与SKU默认", "尺寸与重量", "敏感属性", "类目属性", "风格与场合", "人工必填", "其他字段"]

    # 表头行
    row_idx = 1
    ws.cell(row=row_idx, column=1, value="字段分组").font = Font(bold=True, size=12)
    ws.cell(row=row_idx, column=2, value="字段名").font = Font(bold=True, size=12)
    ws.cell(row=row_idx, column=3, value="字段值").font = Font(bold=True, size=12)
    ws.cell(row=row_idx, column=4, value="字段层级").font = Font(bold=True, size=12)
    ws.cell(row=row_idx, column=5, value="说明").font = Font(bold=True, size=12)
    for col in range(1, 6):
        ws.cell(row=row_idx, column=col).fill = header_fill
        ws.cell(row=row_idx, column=col).font = header_font
        ws.cell(row=row_idx, column=col).alignment = Alignment(horizontal="center", vertical="center")
        ws.cell(row=row_idx, column=col).border = thin_border

    ws.row_dimensions[1].height = 28

    # 字段层级定义（用于说明）
    from app.services.listing_default_fields import UNIFORM_DEFAULT_GROUPS, EARRING_CATEGORY_SPECIFIC_FIELDS

    for group_name in GROUP_ORDER:
        group_data: dict[str, str] = {}
        if group_name in uniform:
            group_data = dict(uniform[group_name])
        elif group_name in category:
            group_data = dict(category[group_name])

        if not group_data:
            continue

        # 分组标题行
        row_idx += 1
        group_fill = group_fills.get(group_name, group_fills["其他字段"])
        ws.merge_cells(start_row=row_idx, start_column=1, end_row=row_idx, end_column=5)
        ws.cell(row=row_idx, column=1, value=group_name).font = group_font
        ws.cell(row=row_idx, column=1).fill = group_fill
        ws.cell(row=row_idx, column=1).alignment = Alignment(horizontal="center", vertical="center")
        for col in range(1, 6):
            ws.cell(row=row_idx, column=col).border = thin_border

        # 字段行
        for field_key, field_value in group_data.items():
            row_idx += 1
            # 确定层级标签
            if group_name in ["经营配置", "商品与SKU默认", "尺寸与重量", "敏感属性"]:
                layer = "L2 通用"
                hint = ""
            elif group_name in ["类目属性", "风格与场合"]:
                layer = "L3 类目"
                hint = ""
            else:
                layer = "L4 人工"
                hint = "此项需人工填写，AI 无法自动推断"

            ws.cell(row=row_idx, column=1, value=group_name).font = cell_font
            ws.cell(row=row_idx, column=2, value=field_key).font = cell_font
            ws.cell(row=row_idx, column=3, value=str(field_value) if field_value else "")
            ws.cell(row=row_idx, column=4, value=layer)
            ws.cell(row=row_idx, column=5, value=hint)

            for col in range(1, 6):
                ws.cell(row=row_idx, column=col).border = thin_border
                ws.cell(row=row_idx, column=col).alignment = Alignment(vertical="center")

    # 设置列宽
    ws.column_dimensions["A"].width = 18
    ws.column_dimensions["B"].width = 26
    ws.column_dimensions["C"].width = 30
    ws.column_dimensions["D"].width = 14
    ws.column_dimensions["E"].width = 28

    # 保存文件
    from app.core.config import get_settings
    import uuid

    settings = get_settings()
    root = Path(settings.storage_root)
    out_dir = root / settings.exports_dir_name
    out_dir.mkdir(parents=True, exist_ok=True)
    filename = f"template-{template_id}-{uuid.uuid4().hex[:8]}.xlsx"
    out_path = out_dir / filename
    wb.save(out_path)

    return {
        "ok": True,
        "template_name": tmpl.name,
        "scheme_name": tmpl.name,
        "scheme_type": "category_field_scheme",
        "download_url": f"{settings.public_base_url}/storage/{settings.exports_dir_name}/{filename}",
        "filename": filename,
        "field_count": row_idx - 2,
    }


@router.patch("/{template_id}", response_model=ListingTemplateOut)
def update_template(
    template_id: int,
    data: ListingTemplateUpdate,
    session: Annotated[Session, Depends(get_db_session)],
):
    tmpl = session.get(ListingTemplate, template_id)
    if not tmpl:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="类目字段方案不存在")
    update_data = data.model_dump(exclude_unset=True)
    for key, val in update_data.items():
        setattr(tmpl, key, val)
    session.commit()
    session.refresh(tmpl)
    return tmpl


@router.delete("/{template_id}", status_code=204)
def delete_template(
    template_id: int,
    session: Annotated[Session, Depends(get_db_session)],
):
    tmpl = session.get(ListingTemplate, template_id)
    if not tmpl:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="类目字段方案不存在")
    session.delete(tmpl)
    session.commit()
