from __future__ import annotations

from typing import Any

from app.models.product_task import ProductTask
from app.models.raw_product import RawProduct


COLOR_TERMS = [
    "black",
    "white",
    "red",
    "blue",
    "green",
    "yellow",
    "pink",
    "purple",
    "gold",
    "silver",
    "透明",
    "黑",
    "白",
    "红",
    "蓝",
    "绿",
    "黄",
    "粉",
    "紫",
    "金",
    "银",
]

SHAPE_TERMS = [
    "round",
    "square",
    "heart",
    "star",
    "flower",
    "ball",
    "drop",
    "circle",
    "圆",
    "方",
    "心形",
    "星",
    "花",
    "球",
    "水滴",
    "环形",
]

SCENE_TERMS = [
    "daily",
    "party",
    "wedding",
    "office",
    "travel",
    "outdoor",
    "home",
    "日常",
    "通勤",
    "派对",
    "婚礼",
    "办公",
    "旅行",
    "户外",
    "家用",
]

DEFAULT_AVOID_ELEMENTS = [
    "text",
    "logo",
    "watermark",
    "price tag",
    "platform UI",
    "changed product type",
    "changed structure",
    "different colors between panels",
    "extra unrelated items",
    "distorted shape",
]


def _list_texts(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in value:
        text = str(item or "").strip()
        key = text.lower()
        if not text or key in seen:
            continue
        seen.add(key)
        out.append(text)
    return out


def _first_text(*values: Any) -> str:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return ""


def _text_blob(*values: Any) -> str:
    return " ".join(str(value or "").strip() for value in values if str(value or "").strip())


def _terms_from_text(text: str, terms: list[str]) -> list[str]:
    lowered = text.lower()
    found: list[str] = []
    for term in terms:
        if term.lower() in lowered and term not in found:
            found.append(term)
    return found[:8]


def _quantity_hint(text: str) -> str:
    lowered = text.lower()
    markers = [
        "一对",
        "一双",
        "单只",
        "单个",
        "套装",
        "2件",
        "3件",
        "4件",
        "pair",
        "pairs",
        "set",
        "pack",
        "pcs",
        "pieces",
    ]
    for marker in markers:
        if marker in lowered:
            return marker
    return ""


def _category_leaf(path: str | None) -> str:
    text = str(path or "").strip()
    if not text:
        return ""
    for sep in (">", "/", "\\", "›", "»"):
        if sep in text:
            return text.split(sep)[-1].strip()
    return text


def _title_package_dict(title_package: Any) -> dict[str, Any]:
    if isinstance(title_package, dict):
        return title_package
    if hasattr(title_package, "model_dump"):
        dumped = title_package.model_dump()
        return dumped if isinstance(dumped, dict) else {}
    return {}


def _product_info_dict(product_info: Any) -> dict[str, Any]:
    if isinstance(product_info, dict):
        return product_info
    if hasattr(product_info, "model_dump"):
        dumped = product_info.model_dump()
        return dumped if isinstance(dumped, dict) else {}
    return {}


def build_four_grid_context(
    *,
    raw: RawProduct | None,
    task: ProductTask,
    title_package: Any = None,
    product_info: Any = None,
) -> dict[str, Any]:
    title_payload = _title_package_dict(title_package)
    product_payload = _product_info_dict(product_info)
    product_core = product_payload.get("product_core") if isinstance(product_payload.get("product_core"), dict) else {}
    product_core_v2 = (
        product_payload.get("product_core_v2") if isinstance(product_payload.get("product_core_v2"), dict) else {}
    )
    visual_facts = product_payload.get("visual_facts") if isinstance(product_payload.get("visual_facts"), dict) else {}
    image_basis = product_payload.get("image_basis") if isinstance(product_payload.get("image_basis"), dict) else {}
    image_generation_basis = (
        product_payload.get("image_generation_basis")
        if isinstance(product_payload.get("image_generation_basis"), dict)
        else {}
    )
    title_basis = product_payload.get("title_basis") if isinstance(product_payload.get("title_basis"), dict) else {}
    source_visible = (
        product_payload.get("source_visible") if isinstance(product_payload.get("source_visible"), dict) else {}
    )

    raw_title = raw.title if raw else task.title
    raw_category = raw.category_path if raw else ""
    raw_text = _text_blob(
        raw_title,
        raw_category,
        raw.attributes_text if raw else "",
        raw.sku_text if raw else "",
        title_payload.get("title_cn"),
        title_payload.get("title_en"),
    )
    core_words = _list_texts(title_payload.get("core_product_words"))
    selling_points = _list_texts(title_payload.get("selling_points"))
    attribute_words = _list_texts(title_basis.get("must_include"))

    subject = _first_text(
        product_core_v2.get("product_subject"),
        image_generation_basis.get("main_subject"),
        image_basis.get("main_subject"),
        product_core.get("actual_selling_subject"),
        product_core.get("product_name_cn"),
        product_core.get("product_name_en"),
        core_words[0] if core_words else "",
        title_payload.get("title_cn"),
        title_payload.get("title_en"),
        raw_title,
    )
    product_type = _first_text(
        product_core_v2.get("product_type"),
        product_core.get("product_type_cn"),
        product_core.get("product_type_en"),
        _category_leaf(task.selected_category_id or raw_category),
    )
    structure_words = _list_texts(visual_facts.get("visible_structures"))
    if not structure_words:
        structure = _first_text(product_core_v2.get("product_form"), product_core.get("visual_structure"))
        structure_words = [structure] if structure else []
    color_words = _list_texts(visual_facts.get("visible_colors")) or _terms_from_text(raw_text, COLOR_TERMS)
    shape_words = _list_texts(visual_facts.get("visible_shapes")) or _terms_from_text(raw_text, SHAPE_TERMS)
    scene_words = _list_texts(product_core_v2.get("usage_scenarios")) or _terms_from_text(raw_text, SCENE_TERMS)
    style_tags = _list_texts(product_core_v2.get("style_tags"))
    quantity = _first_text(
        product_core_v2.get("pack_count"),
        image_basis.get("subject_count"),
        source_visible.get("quantity_hint"),
        _quantity_hint(raw_text),
    )
    must_keep = (
        _list_texts(image_generation_basis.get("must_keep_elements"))
        or _list_texts(image_basis.get("required_visible_features"))
        or structure_words[:]
    )
    must_avoid = _list_texts(image_generation_basis.get("must_avoid_elements")) or _list_texts(
        image_basis.get("avoid_elements")
    )
    for item in DEFAULT_AVOID_ELEMENTS:
        if item not in must_avoid:
            must_avoid.append(item)

    allowed_backgrounds = _list_texts(image_basis.get("allowed_backgrounds")) or [
        "clean studio background",
        "simple lifestyle background",
        "neutral tabletop display",
    ]
    recommended_angles = _list_texts(image_basis.get("recommended_angles")) or [
        "front hero view",
        "detail close-up",
        "usage scene",
        "feature-focused composition",
    ]
    detail_targets = must_keep[:4] or structure_words[:4] or core_words[:4]
    selling_candidates = _list_texts(image_generation_basis.get("selling_point_candidates")) or selling_points[:4]

    reference_images = {
        "main_image": raw.main_image if raw else "",
        "main_images": (raw.main_images or [])[:3] if raw else [],
        "carousel_images": (raw.carousel_images or [])[:3] if raw else [],
        "detail_images": (raw.detail_images or [])[:2] if raw else [],
        "size_chart_images": (raw.size_chart_images or [])[:2] if raw else [],
        "screenshot_url": raw.screenshot_url if raw else "",
    }

    return {
        "source": "product_info_enhanced" if product_payload else "raw_capture",
        "product": {
            "subject": subject,
            "type": product_type,
            "structure": structure_words,
            "colors": color_words,
            "shapes": shape_words,
            "quantity": quantity,
            "style_tags": style_tags,
        },
        "consistency_rules": {
            "keep_same_product_in_all_panels": True,
            "fixed_structure": structure_words,
            "fixed_colors": color_words,
            "fixed_quantity": quantity,
            "must_keep_elements": must_keep,
            "must_avoid_elements": must_avoid,
        },
        "panel_plan": {
            "top_left": {
                "role": "完整主图",
                "focus": subject,
                "composition": "single clear ecommerce hero view",
            },
            "top_right": {
                "role": "细节特写",
                "focus": detail_targets,
                "composition": "close-up that preserves the real structure",
            },
            "bottom_left": {
                "role": "使用场景",
                "focus": scene_words or allowed_backgrounds[:2],
                "composition": "reasonable lifestyle scene without changing the product",
            },
            "bottom_right": {
                "role": "卖点展示",
                "focus": selling_candidates or core_words,
                "composition": "visual feature display without text or icons",
            },
        },
        "image_control": {
            "allowed_backgrounds": allowed_backgrounds,
            "recommended_angles": recommended_angles,
            "allow_human_model": False,
            "allow_hands": False,
            "allow_body_parts": False,
            "allow_display_props": True,
            "product_area_ratio": "60%-80%",
            "lighting": "clean commercial lighting",
        },
        "title_support": {
            "title_cn": title_payload.get("title_cn") or task.title,
            "title_en": title_payload.get("title_en") or "",
            "core_product_words": core_words,
            "attribute_words": attribute_words,
            "selling_points": selling_points,
        },
        "reference_images": reference_images,
        "raw_evidence": {
            "raw_title": raw_title,
            "category_path": task.selected_category_id or raw_category or "",
            "attributes_text": (raw.attributes_text or "")[:500] if raw else "",
            "sku_text": (raw.sku_text or "")[:500] if raw else "",
        },
    }


def build_product_info_context(four_grid_context: dict[str, Any]) -> dict[str, Any]:
    product = four_grid_context.get("product") if isinstance(four_grid_context.get("product"), dict) else {}
    rules = (
        four_grid_context.get("consistency_rules")
        if isinstance(four_grid_context.get("consistency_rules"), dict)
        else {}
    )
    title_support = (
        four_grid_context.get("title_support")
        if isinstance(four_grid_context.get("title_support"), dict)
        else {}
    )
    panel_plan = four_grid_context.get("panel_plan") if isinstance(four_grid_context.get("panel_plan"), dict) else {}
    scene_plan = panel_plan.get("bottom_left") if isinstance(panel_plan.get("bottom_left"), dict) else {}
    selling_plan = panel_plan.get("bottom_right") if isinstance(panel_plan.get("bottom_right"), dict) else {}
    return {
        "product_subject": str(product.get("subject") or ""),
        "product_type": str(product.get("type") or ""),
        "core_product_words": _list_texts(title_support.get("core_product_words")),
        "attribute_words": _list_texts(title_support.get("attribute_words")),
        "structure_words": _list_texts(product.get("structure")),
        "scene_words": _list_texts(scene_plan.get("focus")),
        "style_tags": _list_texts(product.get("style_tags")),
        "visible_colors": _list_texts(product.get("colors")),
        "visible_shapes": _list_texts(product.get("shapes")),
        "must_keep_elements": _list_texts(rules.get("must_keep_elements")),
        "must_avoid_elements": _list_texts(rules.get("must_avoid_elements")),
        "selling_point_candidates": _list_texts(selling_plan.get("focus")),
        "sku_axes": [],
        "dimension_candidates": [],
    }


def build_compact_four_grid_context(four_grid_context: dict[str, Any]) -> dict[str, Any]:
    product = four_grid_context.get("product") if isinstance(four_grid_context.get("product"), dict) else {}
    rules = (
        four_grid_context.get("consistency_rules")
        if isinstance(four_grid_context.get("consistency_rules"), dict)
        else {}
    )
    panel_plan = four_grid_context.get("panel_plan") if isinstance(four_grid_context.get("panel_plan"), dict) else {}
    image_control = four_grid_context.get("image_control") if isinstance(four_grid_context.get("image_control"), dict) else {}
    title_support = (
        four_grid_context.get("title_support")
        if isinstance(four_grid_context.get("title_support"), dict)
        else {}
    )
    return {
        "product": {
            "subject": str(product.get("subject") or ""),
            "type": str(product.get("type") or ""),
            "structure": _list_texts(product.get("structure")),
            "colors": _list_texts(product.get("colors")),
            "quantity": str(product.get("quantity") or ""),
        },
        "must_keep_elements": _list_texts(rules.get("must_keep_elements"))[:8],
        "must_avoid_elements": _list_texts(rules.get("must_avoid_elements"))[:12],
        "panel_plan": panel_plan,
        "image_control": {
            "allowed_backgrounds": _list_texts(image_control.get("allowed_backgrounds"))[:4],
            "lighting": str(image_control.get("lighting") or "clean commercial lighting"),
            "allow_human_model": bool(image_control.get("allow_human_model")),
            "allow_hands": bool(image_control.get("allow_hands")),
        },
        "title_support": {
            "title_en": str(title_support.get("title_en") or ""),
            "core_product_words": _list_texts(title_support.get("core_product_words"))[:8],
            "selling_points": _list_texts(title_support.get("selling_points"))[:8],
        },
    }
