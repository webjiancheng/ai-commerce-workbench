from __future__ import annotations

PROMPT_TYPES: tuple[str, ...] = (
    "product_info_from_screenshot",
    "title_en",
    "title_en_only",
    "title_package_lite",
    "title_package",
    "title_en_with_cn_translation",
    "image_prompt_package",
    "image_prompt_main",
    "image_prompt_carousel_1",
    "image_prompt_carousel_2",
    "image_prompt_carousel_3",
    "image_prompt_carousel_4",
    "image_prompt_carousel_4grid",
    "image_prompt_dimension",
    "dimension_extract_from_image",
)


PROMPT_SCOPES: tuple[str, ...] = ("global", "category", "task")


PROMPT_VARIABLES: dict[str, dict[str, str]] = {
    # Common
    "title": {"type": "string", "desc": "原始商品标题"},
    "raw_title": {"type": "string", "desc": "原始商品标题（兼容变量）"},
    "platform": {"type": "string|null", "desc": "平台（例如 Temu）"},
    "source_url": {"type": "string", "desc": "商品链接"},
    "raw_payload": {"type": "object", "desc": "原始 payload（结构化/半结构化）"},
    "attributes_text": {"type": "string|null", "desc": "属性文本（插件采集）"},
    "sku_text": {"type": "string|null", "desc": "SKU 文本（插件采集）"},
    "screenshot_notes": {"type": "string|null", "desc": "截图与原图备注信息"},
    "reference_images": {"type": "object", "desc": "参考图集合（主图/轮播图/详情图）"},
    "product_info": {"type": "object", "desc": "ProductInfo JSON"},
    "product_info_context": {"type": "object", "desc": "统一商品理解上下文（供 SKU/尺寸/卖点图等手动触发链路复用）"},
    "title_package": {"type": "object", "desc": "标题包 JSON"},
    "title_en_with_cn_translation": {"type": "object", "desc": "英文标题及中文翻译 JSON"},
    "selected_category_path": {"type": "string", "desc": "当前采用类目路径"},
    "original_category_path": {"type": "string", "desc": "原始类目路径"},
    "category_path": {"type": "string", "desc": "类目路径（兼容变量）"},
    "target_language": {"type": "string", "desc": "目标语言（cn/en/both）"},
    "optimized_title_cn": {"type": "string", "desc": "当前采用中文标题"},
    "selling_points": {"type": "string[]", "desc": "卖点列表"},
    "material": {"type": "string", "desc": "材质字段"},
    "target_user": {"type": "string", "desc": "目标人群"},
    "scenes": {"type": "string[]", "desc": "使用场景列表"},
    "reference_image_notes": {"type": "string", "desc": "参考图片备注"},
    "dimension_data": {"type": "object", "desc": "尺寸识别结果 JSON"},
    # Category match
    "candidates": {"type": "string[]", "desc": "类目候选路径列表（字典召回）"},
    # Downstream
    "category_search": {"type": "object", "desc": "类目检索关键词结构"},
    "title_en": {"type": "object", "desc": "英文标题 JSON"},
}
