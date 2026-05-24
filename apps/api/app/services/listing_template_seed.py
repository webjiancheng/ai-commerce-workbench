"""内置上架模板的种子数据"""

from sqlalchemy.orm import Session

from app.models.listing_template import ListingTemplate


# ============================================================
# 统一默认字段（所有类目通用）
# ============================================================
UNIFORM_DEFAULTS = {
    "站点与物流": {
        "经营站点": "美国站",
        "发货仓": "美国-饰品",
        "运费模版": "美国运费模版",
        "承诺发货时效": "7个工作日内发货",
        "素材语言": "英语",
    },
    "商品基础": {
        "商品产地": "中国",
        "产地省份": "广东省",
        "商品层级": "根据 SKU 自动判断",
        "SPU货号规则": "自动生成",
        "SKU货号规则": "自动生成",
    },
    "SKU规格": {
        "币种": "CNY",
        "默认库存": "100",
        "SKU分类": "单品",
        "SKU数量": "1",
        "SKU数量单位": "件",
        "是否独立包装": "是",
        "商品编码类型": "",
        "商品编码": "",
        "制造商建议零售价(USD)": "",
        "参考链接": "",
    },
    "尺寸与重量": {
        "最长边（cm）": "10",
        "次长边（cm）": "8",
        "最短边（cm）": "2",
        "重量（g）": "30",
    },
    "敏感属性": {
        "敏感词属性1": "",
        "敏感词属性2": "",
        "敏感词属性3": "",
        "液体容量（ml）": "",
        "刀具长度(cm)": "",
        "刀尖角度(度)": "",
        "储电容量（wh）": "",
    },
}


# ============================================================
# 女士耳饰类目特定字段
# ============================================================
EARRING_CATEGORY_FIELDS = {
    "饰品视频属性": {
        "镀层": "无镀层",
        "镶嵌材质": "无镶嵌",
        "主体材质": "合金",
        "银材料净克重(g）": "",
        "银材料净克重(g）单位": "g",
        "耳针材质": "合金",
        "是否为羽毛": "否",
        "适配季节": "四季",
        "是否含金属部件": "是",
        "金属部件材质类型1": "合金",
        "金属部件材质类型2": "",
        "金属部件材质类型3": "",
    },
    "多选属性-风格": {
        "风格1": "时尚",
        "风格2": "简约",
        "风格3": "复古",
    },
    "多选属性-场合": {
        "佩戴场合1": "日常",
        "佩戴场合2": "派对",
    },
    "多选属性-节日/主题": {
        "营销节日1": "情人节、圣诞节、母亲节",
        "主题1": "几何、花朵、爱心",
        "诞生石1": "",
        "系列线1": "",
    },
}


# ============================================================
# 内置模板列表
# ============================================================
BUILTIN_TEMPLATES = [
    {
        "name": "女士耳饰（半托）",
        "platform": "Temu",
        "category_path": "服装、鞋靴和珠宝饰品>女士时尚>女士饰品>女士耳饰>女士时尚耳廓环和全耳式耳环",
        "category_keywords": "女士耳饰,女童耳饰,女士时尚耳廓环",
        "description": "Temu美国站·女士耳饰类目·半托履约",
        "uniform_defaults_json": UNIFORM_DEFAULTS,
        "category_fields_json": EARRING_CATEGORY_FIELDS,
        "is_builtin": True,
    },
    {
        "name": "女童耳饰（半托）",
        "platform": "Temu",
        "category_path": "服装、鞋靴和珠宝饰品>女童时尚>女童饰品>女童耳饰",
        "category_keywords": "女童耳饰,女童球形耳环,女童垂坠式耳环",
        "description": "Temu美国站·女童耳饰类目·半托履约",
        "uniform_defaults_json": UNIFORM_DEFAULTS,
        "category_fields_json": EARRING_CATEGORY_FIELDS,
        "is_builtin": True,
    },
    {
        "name": "女士项链（半托）",
        "platform": "Temu",
        "category_path": "服装、鞋靴和珠宝饰品>女士时尚>女士饰品>女士项链",
        "category_keywords": "女士项链,项链,吊坠",
        "description": "Temu美国站·女士项链类目·半托履约",
        "uniform_defaults_json": UNIFORM_DEFAULTS,
        "category_fields_json": EARRING_CATEGORY_FIELDS,
        "is_builtin": True,
    },
    {
        "name": "女士手饰/手链（半托）",
        "platform": "Temu",
        "category_path": "服装、鞋靴和珠宝饰品>女士时尚>女士饰品>女士手饰",
        "category_keywords": "女士手饰,手链,手镯",
        "description": "Temu美国站·女士手饰类目·半托履约",
        "uniform_defaults_json": UNIFORM_DEFAULTS,
        "category_fields_json": EARRING_CATEGORY_FIELDS,
        "is_builtin": True,
    },
]


def seed_listing_templates(session: Session) -> None:
    """插入内置模板（如果不存在则插入）"""
    for template_data in BUILTIN_TEMPLATES:
        exists = session.query(ListingTemplate).filter_by(
            name=template_data["name"], platform=template_data["platform"]
        ).first()
        if not exists:
            tmpl = ListingTemplate(**template_data)
            session.add(tmpl)
    session.commit()
