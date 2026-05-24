"""
上架默认值字段设计 - 按用户操作频率分层

字段分层：
  Layer-1 统一默认：所有类目通用，选类目后自动填充（用户可改）
  Layer-2 类目属性：用户手动操作（视频属性、多选属性）
  Layer-3 系统填充：用户不需要操作（商品名称/英文名称/SPU货号/申报价格/图片视频）
"""

from __future__ import annotations

from enum import Enum


class FieldLayer(Enum):
    """字段分层，数字越大用户越需要手动操作"""

    SYSTEM_AUTO = 1  # 系统自动填充，不需要用户操作
    UNIFORM_DEFAULT = 2  # 统一默认，选类目后自动填充
    CATEGORY_SPECIFIC = 3  # 类目特定属性，用户手动选择
    MANUAL_FILL = 4  # 必须人工填写


# ============================================================
# Layer-1 系统自动填充（用户不可编辑，由系统自动补齐）
# ============================================================
SYSTEM_AUTO_FIELDS: list[str] = [
    # 商品名称：来自 product_ai_results.title_package.title_cn
    "商品名称",
    # 英文名称：来自 product_ai_results.title_package.title_en
    "英文名称",
    # SPU货号：系统自动生成
    "SPU货号",
    # SKU货号：系统自动生成
    "SKU货号",
    # 申报价格：来自商品任务价格或人工
    "申报价格-美国站",
    # 商品轮播图：来自 product_assets.final_carousel_*
    "商品轮播图1-英语",
    "商品轮播图2-英语",
    "商品轮播图3-英语",
    "商品轮播图4-英语",
    "商品轮播图5-英语",
    "商品轮播图6-英语",
    "商品轮播图7-英语",
    "商品轮播图8-英语",
    "商品轮播图9-英语",
    "商品轮播图10-英语",
    # SKU预览图：来自 product_assets.sku_image_*
    "SKU预览图-英语",
    # 详情图文：来自商品资产或采集图
    "详情图文-英语",
    # 视频：来自商品资产
    "SPU主图视频",
    "SPU详情视频",
]

# ============================================================
# Layer-2 统一默认字段（所有类目通用，选类目后自动填充）
# ============================================================
# 按功能分组
UNIFORM_DEFAULT_GROUPS: dict[str, list[UniformDefaultField]] = {}


class UniformDefaultField:
    key: str
    label: str
    default_value: str
    options: list[str] | None
    hint: str | None

    def __init__(
        self,
        key: str,
        label: str,
        default_value: str,
        options: list[str] | None = None,
        hint: str | None = None,
    ):
        self.key = key
        self.label = label
        self.default_value = default_value
        self.options = options
        self.hint = hint


class CategorySpecificField:
    group: str
    key: str
    label: str
    default_value: str
    options: list[str] | None
    is_multi: bool
    max_items: int | None
    is_textarea: bool
    hint: str | None

    def __init__(
        self,
        group: str,
        key: str,
        label: str,
        default_value: str,
        options: list[str] | None = None,
        is_multi: bool = False,
        max_items: int | None = None,
        is_textarea: bool = False,
        hint: str | None = None,
    ):
        self.group = group
        self.key = key
        self.label = label
        self.default_value = default_value
        self.options = options
        self.is_multi = is_multi
        self.max_items = max_items
        self.is_textarea = is_textarea
        self.hint = hint


# 站点与物流
UNIFORM_DEFAULT_GROUPS["站点与物流"] = [
    UniformDefaultField("经营站点", "经营站点", "美国站", ["美国站", "英国站", "德国站", "法国站", "意大利站", "西班牙站", "日本站", "澳大利亚站"]),
    UniformDefaultField("发货仓", "发货仓", "美国-饰品", ["美国-饰品", "美国-普货", "英国-饰品", "英国-普货", "德国-饰品", "德国-普货"]),
    UniformDefaultField("运费模版", "运费模版", "美国运费模版", hint="默认美国运费模版，按站点自动切换"),
    UniformDefaultField(
        "承诺发货时效",
        "承诺发货时效",
        "7个工作日内发货",
        ["2个工作日内发货", "3个工作日内发货", "5个工作日内发货", "7个工作日内发货"],
        hint="按模板原值默认7个工作日，用户可改为2个工作日加速出单",
    ),
    UniformDefaultField("素材语言", "素材语言", "英语", ["英语", "英语+德语", "英语+法语", "英语+西班牙语", "多语言"]),
]

# 商品基础默认值（通用）
UNIFORM_DEFAULT_GROUPS["商品基础"] = [
    UniformDefaultField("商品产地", "商品产地", "中国", ["中国", "美国", "日本", "韩国", "英国"]),
    UniformDefaultField("产地省份", "产地省份", "广东省", hint="默认广东省，需改为工厂实际省份"),
    UniformDefaultField(
        "商品层级",
        "商品层级",
        "根据 SKU 自动判断",
        ["根据 SKU 自动判断", "单SKU商品", "多SKU商品"],
        hint="系统根据 SKU 数量自动判断",
    ),
    UniformDefaultField(
        "SPU货号规则",
        "SPU货号规则",
        "自动生成",
        ["自动生成", "手动填写"],
        hint="自动生成则系统按规则生成货号",
    ),
    UniformDefaultField(
        "SKU货号规则",
        "SKU货号规则",
        "自动生成",
        ["自动生成", "手动填写"],
        hint="自动生成则系统按规则生成货号",
    ),
]

# SKU 规格与销售
UNIFORM_DEFAULT_GROUPS["SKU规格"] = [
    UniformDefaultField(
        "默认规格类型",
        "默认规格类型",
        "款式/颜色",
        ["款式/颜色", "颜色/尺寸", "尺寸/颜色", "款式", "颜色"],
        hint="根据 SKU 数据自动判断",
    ),
    UniformDefaultField("币种", "币种", "CNY", ["CNY", "USD", "EUR", "GBP"]),
    UniformDefaultField("默认库存", "默认库存", "100", hint="每个 SKU 的默认库存数量"),
    UniformDefaultField(
        "SKU分类",
        "SKU分类",
        "单品",
        ["单品", "同款多件装", "混合套装"],
        hint="单品：每个 SKU 仅含1件商品",
    ),
    UniformDefaultField("SKU数量", "SKU数量", "1", hint="单品填1，多件装/混合套装按实际数量填"),
    UniformDefaultField(
        "SKU数量单位",
        "SKU数量单位",
        "件",
        ["件", "套", "对", "个", "组", "盒", "袋"],
    ),
    UniformDefaultField(
        "是否独立包装",
        "是否独立包装",
        "是",
        ["是", "否"],
        hint="套装中单品是否单独包装且可单独售卖",
    ),
    UniformDefaultField(
        "商品编码类型",
        "商品编码类型",
        "",
        ["", "UPC", "EAN", "GTIN", "ASIN", "ISBN"],
        hint="选填，如选择需同时填商品编码",
    ),
    UniformDefaultField("商品编码", "商品编码", "", hint="选填，配合商品编码类型使用"),
    UniformDefaultField(
        "制造商建议零售价(USD)",
        "制造商建议零售价(USD)",
        "",
        hint="非必填，需为市场上真实销售价格",
    ),
    UniformDefaultField("参考链接", "参考链接", "", hint="选填，填写在售商品链接可获取申报参考价"),
]

# 尺寸与重量
UNIFORM_DEFAULT_GROUPS["尺寸与重量"] = [
    UniformDefaultField("最长边（cm）", "最长边（cm）", "10", hint="cm 单位，默认适合耳饰类"),
    UniformDefaultField("次长边（cm）", "次长边（cm）", "8", hint="cm 单位"),
    UniformDefaultField("最短边（cm）", "最短边（cm）", "2", hint="cm 单位"),
    UniformDefaultField("重量（g）", "重量（g）", "30", hint="克(g)，默认适合耳饰类"),
]

# 敏感商品属性
UNIFORM_DEFAULT_GROUPS["敏感属性"] = [
    UniformDefaultField(
        "敏感词属性1",
        "敏感词属性1",
        "",
        ["", "纯电", "内电", "液体", "粉末", "膏体", "刀具", "磁性", "气雾剂"],
        hint="无敏感属性则不填",
    ),
    UniformDefaultField(
        "敏感词属性2",
        "敏感词属性2",
        "",
        ["", "纯电", "内电", "液体", "粉末", "膏体", "刀具", "磁性", "气雾剂"],
    ),
    UniformDefaultField(
        "敏感词属性3",
        "敏感词属性3",
        "",
        ["", "纯电", "内电", "液体", "粉末", "膏体", "刀具", "磁性", "气雾剂"],
    ),
    UniformDefaultField("液体容量（ml）", "液体容量（ml）", "", hint="如选择液体必填"),
    UniformDefaultField("刀具长度(cm)", "刀具长度(cm)", "", hint="如选择刀具必填"),
    UniformDefaultField("刀尖角度(度)", "刀尖角度(度)", "", hint="如选择刀具必填"),
    UniformDefaultField("储电容量（wh）", "储电容量（wh）", "", hint="如选择纯电/内电必填"),
]

# 图片与视频提示（由系统从资产自动填充）
UNIFORM_DEFAULT_GROUPS["图片与视频"] = [
    UniformDefaultField(
        "轮播图要求",
        "商品轮播图要求",
        "前3张必填，共3-10张",
        hint="图片由系统从商品资产自动填充，支持填写素材ID或URL",
    ),
    UniformDefaultField(
        "SKU预览图要求",
        "SKU预览图要求",
        "宽高比1:1，宽高>800px，小于2M",
        hint="图片由系统从SKU图片资产自动填充",
    ),
    UniformDefaultField(
        "详情图文要求",
        "详情图文要求",
        "至少1张图片，宽高比≥1:3，宽≥480px，小于3M",
        hint="详情图文由系统从商品资产自动填充，或用户手动上传",
    ),
    UniformDefaultField(
        "视频要求",
        "SPU视频要求",
        "时长600秒内，大小500M内，宽高比1:1/3:4/16:9",
        hint="视频由系统从商品资产自动填充，需填写素材中心素材ID",
    ),
]

# ============================================================
# Layer-3 类目特定属性（用户手动操作）
# ============================================================

# 耳饰类目属性定义
EARRING_CATEGORY_SPECIFIC_FIELDS: list[CategorySpecificField] = [
    # 视频属性
    CategorySpecificField(
        group="视频属性",
        key="镀层",
        label="镀层",
        default_value="无镀层",
        options=["无镀层", "镀金", "镀银", "镀铜", "镀玫瑰金", "镀白金"],
        is_multi=False,
    ),
    CategorySpecificField(
        group="视频属性",
        key="镶嵌材质",
        label="镶嵌材质",
        default_value="无镶嵌",
        options=["无镶嵌", "锆石", "珍珠", "宝石", "水钻", "翡翠", "珊瑚"],
        is_multi=False,
    ),
    CategorySpecificField(
        group="视频属性",
        key="主体材质",
        label="主体材质",
        default_value="合金",
        options=["合金", "纯银", "925银", "不锈钢", "钛钢", "铜", "木头", "树脂"],
        is_multi=False,
    ),
    CategorySpecificField(
        group="视频属性",
        key="银材料净克重(g）",
        label="银材料净克重(g）",
        default_value="",
        options=None,
        is_multi=False,
        hint="如材质为银则必填",
    ),
    CategorySpecificField(
        group="视频属性",
        key="银材料净克重(g）单位",
        label="银材料净克重(g）单位",
        default_value="g",
        options=["g", "mg"],
        is_multi=False,
    ),
    CategorySpecificField(
        group="视频属性",
        key="耳针材质",
        label="耳针材质",
        default_value="合金",
        options=["合金", "纯银", "925银", "不锈钢", "钛钢"],
        is_multi=False,
    ),
    CategorySpecificField(
        group="视频属性",
        key="是否为羽毛",
        label="是否为羽毛",
        default_value="否",
        options=["否", "是"],
        is_multi=False,
    ),
    CategorySpecificField(
        group="视频属性",
        key="适配季节",
        label="适配季节",
        default_value="四季",
        options=["四季", "春季", "夏季", "秋季", "冬季", "春夏", "秋冬"],
        is_multi=False,
    ),
    CategorySpecificField(
        group="视频属性",
        key="是否含金属部件",
        label="是否含金属部件",
        default_value="是",
        options=["是", "否"],
        is_multi=False,
    ),
    CategorySpecificField(
        group="视频属性",
        key="金属部件材质类型1",
        label="金属部件材质类型1",
        default_value="合金",
        options=["合金", "纯银", "925银", "不锈钢", "钛钢", "铜"],
        is_multi=False,
    ),
    CategorySpecificField(
        group="视频属性",
        key="金属部件材质类型2",
        label="金属部件材质类型2",
        default_value="",
        options=["", "合金", "纯银", "925银", "不锈钢", "钛钢", "铜"],
        is_multi=False,
    ),
    CategorySpecificField(
        group="视频属性",
        key="金属部件材质类型3",
        label="金属部件材质类型3",
        default_value="",
        options=["", "合金", "纯银", "925银", "不锈钢", "钛钢", "铜"],
        is_multi=False,
    ),
    # 多选属性
    CategorySpecificField(
        group="多选属性-风格",
        key="风格1",
        label="风格1（必填）",
        default_value="时尚",
        options=["时尚", "简约", "复古", "民族风", "波西米亚", "韩版", "欧美", "可爱", "优雅", "个性"],
        is_multi=True,
        max_items=10,
        hint="最多填写10个，逗号分隔",
    ),
    CategorySpecificField(
        group="多选属性-风格",
        key="风格2",
        label="风格2",
        default_value="简约",
        options=["时尚", "简约", "复古", "民族风", "波西米亚", "韩版", "欧美", "可爱", "优雅", "个性", "潮流", "休闲"],
        is_multi=True,
    ),
    CategorySpecificField(
        group="多选属性-风格",
        key="风格3",
        label="风格3",
        default_value="复古",
        options=["时尚", "简约", "复古", "民族风", "波西米亚", "韩版", "欧美", "可爱", "优雅", "个性", "潮流", "休闲"],
        is_multi=True,
    ),
    CategorySpecificField(
        group="多选属性-场合",
        key="佩戴场合1",
        label="佩戴场合1（必填）",
        default_value="日常",
        options=["日常", "派对", "约会", "办公", "婚礼", "约会", "旅行", "运动", "约会"],
        is_multi=True,
        max_items=10,
        hint="最多填写10个",
    ),
    CategorySpecificField(
        group="多选属性-场合",
        key="佩戴场合2",
        label="佩戴场合2",
        default_value="派对",
        options=["日常", "派对", "约会", "办公", "婚礼", "旅行", "运动", "约会"],
        is_multi=True,
    ),
    CategorySpecificField(
        group="多选属性-节日",
        key="营销节日1",
        label="营销节日（可选）",
        default_value="情人节、圣诞节、母亲节",
        options=None,
        is_multi=True,
        is_textarea=True,
        hint="多个节日用顿号分隔",
    ),
    CategorySpecificField(
        group="多选属性-主题",
        key="主题1",
        label="主题（可选）",
        default_value="几何、花朵、爱心",
        options=None,
        is_multi=True,
        is_textarea=True,
        hint="多个主题用逗号分隔",
    ),
    CategorySpecificField(
        group="多选属性-主题",
        key="诞生石1",
        label="诞生石（可选）",
        default_value="",
        options=["", "一月石榴石", "二月紫水晶", "三月海蓝宝", "四月钻石", "五月翡翠", "六月珍珠", "七月红宝石", "八月橄榄石", "九月蓝宝石", "十月碧玺", "十一月托帕石", "十二月绿松石"],
        is_multi=True,
    ),
    CategorySpecificField(
        group="多选属性-主题",
        key="系列线1",
        label="系列线（可选）",
        default_value="",
        options=None,
        is_multi=True,
        is_textarea=True,
        hint="多个系列用逗号分隔",
    ),
]


# ============================================================
# 完整字段清单（用于动态字段接收）
# ============================================================
ALL_EXPORT_HEADERS: list[str] = [
    # 顶部公共字段
    "经营站点", "发货仓", "类目", "运费模版", "承诺发货时效", "素材语言",
    # 商品基础
    "商品层级", "SPU货号", "商品名称", "英文名称", "商品产地", "产地省份",
    # SPU属性-饰品
    "镀层", "镶嵌材质", "主体材质", "银材料净克重(g）", "银材料净克重(g）单位",
    "木材类型", "木种", "耳针材质", "是否为羽毛", "适配季节",
    "是否含金属部件", "金属部件材质类型1", "金属部件材质类型2", "金属部件材质类型3",
    # SPU属性-多选
    "风格1", "风格2", "风格3", "风格4", "风格5",
    "风格6", "风格7", "风格8", "风格9", "风格10",
    "佩戴场合1", "佩戴场合2", "佩戴场合3", "佩戴场合4", "佩戴场合5",
    "佩戴场合6", "佩戴场合7", "佩戴场合8", "佩戴场合9", "佩戴场合10",
    "营销节日1", "营销节日2", "营销节日3", "营销节日4", "营销节日5",
    "营销节日6", "营销节日7", "营销节日8", "营销节日9", "营销节日10",
    "金属部件材质类型1", "金属部件材质类型2", "金属部件材质类型3",
    "诞生石1", "诞生石2", "诞生石3", "诞生石4", "诞生石5",
    "诞生石6", "诞生石7", "诞生石8", "诞生石9", "诞生石10",
    "主题1", "主题2", "主题3", "主题4", "主题5",
    "主题6", "主题7", "主题8", "主题9", "主题10",
    "品牌名", "羽毛材质",
    # SPU属性-通用电器
    "供电方式", "插头规格", "工作电压", "可承受电压范围",
    "电池类型", "电池数量", "可充电电池", "太阳能电池",
    # 系列线
    "系列线1", "系列线2", "系列线3", "系列线4", "系列线5", "系列线6", "系列线7",
    # SKU规格
    "SKU货号", "规格类型1", "规格1内容", "规格类型2", "规格2内容",
    "SKU预览图-英语", "参考链接",
    "申报价格-美国站", "币种",
    "发货仓1", "发货仓1库存",
    "发货仓2", "发货仓2库存",
    "发货仓3", "发货仓3库存",
    "商品编码类型", "商品编码",
    "SKU分类", "SKU数量", "SKU数量单位", "是否独立包装",
    "制造商建议零售价(USD)",
    # SKU敏感属性
    "敏感词属性1", "敏感词属性2", "敏感词属性3",
    "液体容量（ml）", "刀具长度(cm)", "刀尖角度(度)", "储电容量（wh）",
    # SKU体积重量
    "最长边（cm）", "次长边（cm）", "最短边（cm）", "重量（g）",
    # 图片视频
    "商品轮播图1-英语", "商品轮播图2-英语", "商品轮播图3-英语",
    "商品轮播图4-英语", "商品轮播图5-英语",
    "商品轮播图6-英语", "商品轮播图7-英语", "商品轮播图8-英语",
    "商品轮播图9-英语", "商品轮播图10-英语",
    "详情图文-英语",
    "SPU主图视频", "SPU详情视频",
]


# ============================================================
# Helper functions
# ============================================================
def get_all_uniform_default_fields() -> list[tuple[str, list[UniformDefaultField]]]:
    """获取所有统一默认字段（分组）"""
    return list(UNIFORM_DEFAULT_GROUPS.items())


def get_uniform_default_values() -> dict[str, str]:
    """获取所有统一默认字段的默认值字典"""
    result = {}
    for group_fields in UNIFORM_DEFAULT_GROUPS.values():
        for field in group_fields:
            if field.default_value:
                result[field.key] = field.default_value
    return result


def get_category_specific_fields_for_path(category_path: str) -> list[CategorySpecificField]:
    """
    根据类目路径返回对应的类目特定字段定义
    目前只实现了耳饰类目，后续可扩展其他类目
    """
    if not category_path:
        return []

    # 耳饰类目匹配
    earrings_keywords = ["女士耳饰", "女童耳饰", "男士耳饰", "女士时尚耳廓环", "女士时尚垂坠式", "女士时尚夹式", "女士时尚环状", "女士时尚球形", "女士时尚耳环花托", "女士时尚耳钉", "女童球形耳环", "女童垂坠式耳环", "女童环状耳环", "女童耳钉"]
    for kw in earrings_keywords:
        if kw in category_path:
            return EARRING_CATEGORY_SPECIFIC_FIELDS

    return []


# ============================================================
# 新增：DefaultRuleTemplate 模型（模板定义）
# ============================================================
"""
后续新增 default_rule_templates 表来存储模板定义：
- 模板名称（如：Temu美国站-女士耳饰）
- 模板类型（category_specific / uniform_default / mixed）
- 适用类目路径
- 统一默认字段 JSON
- 类目特定字段 JSON
- 是否为系统内置模板
"""

# ============================================================
# 新增：AI 导入时字段分类
# ============================================================
"""
当外部 AI 返回 headers + rows 时，系统需要动态识别：
1. 哪些字段属于统一默认（系统自动填充，用户可改）
2. 哪些字段属于类目属性（用户手动选择）
3. 哪些字段是用户新增的自定义字段
4. 哪些字段需要从商品任务/图片资产补齐

字段分类策略：
- 优先匹配 all_export_headers 中的已知字段
- 未知字段归类为"自定义字段"
- 图片/视频字段由系统从资产填充（值为空）
"""

AI_IMPORT_FIELD_CLASSIFICATION = {
    # 系统自动填充（用户不可编辑）
    "auto_fill": [
        "商品名称", "英文名称", "SPU货号", "SKU货号",
        "商品轮播图1-英语", "商品轮播图2-英语", "商品轮播图3-英语",
        "商品轮播图4-英语", "商品轮播图5-英语",
        "商品轮播图6-英语", "商品轮播图7-英语", "商品轮播图8-英语",
        "商品轮播图9-英语", "商品轮播图10-英语",
        "SKU预览图-英语", "详情图文-英语", "SPU主图视频", "SPU详情视频",
    ],
    # 统一默认（用户可改但通常不需要）
    "uniform_default": [
        "经营站点", "发货仓", "运费模版", "承诺发货时效", "素材语言",
        "商品产地", "产地省份", "商品层级", "SPU货号规则", "SKU货号规则",
        "默认规格类型", "币种", "默认库存", "SKU分类", "SKU数量", "SKU数量单位", "是否独立包装",
        "最长边（cm）", "次长边（cm）", "最短边（cm）", "重量（g）",
        "敏感词属性1", "敏感词属性2", "敏感词属性3",
        "液体容量（ml）", "刀具长度(cm)", "刀尖角度(度)", "储电容量（wh）",
    ],
    # 类目特定（用户手动选择）
    "category_specific": [
        # 视频属性
        "镀层", "镶嵌材质", "主体材质", "银材料净克重(g）", "银材料净克重(g）单位",
        "木材类型", "木种", "耳针材质", "是否为羽毛", "适配季节",
        "是否含金属部件", "金属部件材质类型1", "金属部件材质类型2", "金属部件材质类型3",
        # 多选
        "风格1", "风格2", "风格3", "风格4", "风格5",
        "风格6", "风格7", "风格8", "风格9", "风格10",
        "佩戴场合1", "佩戴场合2", "佩戴场合3", "佩戴场合4", "佩戴场合5",
        "佩戴场合6", "佩戴场合7", "佩戴场合8", "佩戴场合9", "佩戴场合10",
        "营销节日1", "营销节日2", "营销节日3", "营销节日4", "营销节日5",
        "营销节日6", "营销节日7", "营销节日8", "营销节日9", "营销节日10",
        "诞生石1", "诞生石2", "诞生石3", "诞生石4", "诞生石5",
        "诞生石6", "诞生石7", "诞生石8", "诞生石9", "诞生石10",
        "主题1", "主题2", "主题3", "主题4", "主题5",
        "主题6", "主题7", "主题8", "主题9", "主题10",
        "金属部件材质类型1", "金属部件材质类型2", "金属部件材质类型3",
        "品牌名", "羽毛材质",
        "供电方式", "插头规格", "工作电压", "可承受电压范围",
        "电池类型", "电池数量", "可充电电池", "太阳能电池",
        "系列线1", "系列线2", "系列线3", "系列线4", "系列线5", "系列线6", "系列线7",
    ],
    # 必须人工填写
    "manual_required": [
        "申报价格-美国站",
        "发货仓1库存",
        "规格1内容", "规格2内容",
        "发货仓1", "发货仓2", "发货仓3",
    ],
    # 需从资产补齐（系统自动处理）
    "asset_fill": [
        "商品轮播图1-英语", "商品轮播图2-英语", "商品轮播图3-英语",
        "商品轮播图4-英语", "商品轮播图5-英语",
        "商品轮播图6-英语", "商品轮播图7-英语", "商品轮播图8-英语",
        "商品轮播图9-英语", "商品轮播图10-英语",
        "SKU预览图-英语",
        "详情图文-英语",
        "SPU主图视频", "SPU详情视频",
    ],
}


def classify_header(header: str) -> str:
    """将单个字段名分类到对应层"""
    for category, fields in AI_IMPORT_FIELD_CLASSIFICATION.items():
        if header in fields:
            return category
    # 不在已知列表中的字段，默认为"自定义字段"
    return "custom"


def classify_headers(headers: list[str]) -> dict[str, list[str]]:
    """将多个字段名分类"""
    result = {cat: [] for cat in AI_IMPORT_FIELD_CLASSIFICATION}
    result["custom"] = []
    for h in headers:
        cat = classify_header(h)
        if cat == "custom":
            result["custom"].append(h)
        else:
            result[cat].append(h)
    return result
