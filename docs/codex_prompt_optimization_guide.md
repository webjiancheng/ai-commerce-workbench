# 跨境电商上架系统 AI 提示词优化说明（给 Codex）

## 0. 改动目标

本次优化目标不是重写整套提示词，而是在保留现有输入、输出和 JSON 结构的前提下，增强以下能力：

1. 标题生成更适合 Temu / SHEIN / Amazon 等跨境平台。
2. 可以合理使用类目热搜词，但禁止 AI 自行编造热搜词。
3. 提高合规性，避免品牌侵权、IP 侵权、医疗功效、认证、夸张促销、物流售后承诺等风险词。
4. 避免 AI 乱加材质、尺寸、数量、型号、认证、功效、适配对象。
5. 保持原有输入变量和输出字段兼容，避免影响后端代码。

## 1. 硬性边界：不要破坏现有系统

Codex 修改时必须遵守：

1. 不删除现有模板。
2. 不删除现有输出字段。
3. 不改已有字段名。
4. 不改已有 prompt_type。
5. 不改已有 required 变量。
6. 可以新增 optional 变量。
7. 可以在模板文本中补充规则。
8. 如果要新增输出字段，必须先确认后端是否能兼容；默认不要新增输出字段。
9. 优先把新增审查结果复用到已有字段：
   - `avoid_claims`
   - `used_basis_fields`
   - `category_conflict_reason`
   - `category_search_keywords`
   - `suggested_category_search_query`
   - `suggested_category_path_keywords`

## 2. 外部平台规则依据

### Amazon

Amazon 2025 商品标题规则重点：

1. 多数类目标题不得超过 200 个字符，包括空格。
2. 标题不得包含部分特殊字符，例如 `!`, `$`, `?`, `_`, `{`, `}`, `^`, `¬`, `¦`，除非这些字符属于合法品牌名。
3. 同一个词不得在标题中出现超过 2 次，介词、冠词、连词除外。
4. 标题应清晰、简洁、一致。
5. 商品详情页不得包含虚假商品识别信息，不得用详情页做交叉促销或交叉推广。

参考来源：
- Amazon Seller Central: New product title requirements effective January 21, 2025
- Amazon Seller Central: Product detail page rules

### Temu

Temu 公开可访问规则信息有限，实际规则通常以卖家后台和平台最新通知为准。提示词应采用保守策略：

1. 商品名称、详情图、描述等都属于平台内容审核范围。
2. 禁止发布禁售商品信息、违法鼓励内容、欺诈误导消费者内容。
3. 禁止负面暴力内容、儿童保护风险内容、宗教文化亵渎内容、政治内容、成人色情内容、歧视仇恨内容。
4. 禁止导流内容，例如网址、二维码、平台外引导信息。
5. 不要写“Temu 热卖中”等恶意引导搜索推荐流量的内容。

参考来源：
- Temu Partner Platform Documentation
- Temu 内容违规解读类公开资料

### SHEIN

SHEIN Marketplace 公开资料强调商品 listing 优化、标题、图片、描述和知识产权合规：

1. 标题可以偏时尚电商表达，但不能夸张或误导。
2. 不得使用未授权图片、版权内容、侵权元素。
3. 商品页内容应与实际商品一致。
4. 风格词可以使用，但必须有商品外观或类目依据。

参考来源：
- SHEIN Marketplace Product Optimization

## 3. 当前提示词主要问题

### 3.1 “高频搜索词 / 热搜词”规则太宽

当前提示词中有类似：

> Temu 平台标题可保留高频搜索词，但不得堆砌。

问题：

AI 可能自行脑补“高频词”“热搜词”“爆款词”，导致标题加入无依据词、无关词、侵权词或关键词堆砌。

优化原则：

热搜词只能来自输入字段，例如 `trend_keywords`，AI 只能筛选，不能编造。

### 3.2 `selling_points` 容易被模型发挥

问题：

卖点字段如果没有证据约束，模型可能写出无依据功效、安全性、材质、认证等内容。

优化原则：

每个卖点必须来自输入证据；没有证据时，只允许输出外观、结构、用途、场景类中性卖点。

### 3.3 Amazon 规则不够具体

当前已有“不要关键词堆砌”，但缺少字符数、重复词、特殊符号限制。

优化原则：

在 Amazon 平台下增加明确限制：

- 建议不超过 180 字符。
- 最大不得超过 200 字符。
- 同一英文实词不得超过 2 次。
- 禁止不合规特殊符号。

### 3.4 平台合规检查没有形成稳定机制

当前有很多禁止项，但建议统一为“证据约束 + 风险词排除 + 平台差异化”。

## 4. 建议新增的可选输入变量

在标题相关模板中，建议新增以下 optional 变量，不影响旧调用：

```json
{
  "optional": [
    "trend_keywords",
    "blocked_keywords",
    "platform_policy_notes",
    "marketplace_region",
    "title_length_limit"
  ]
}
```

字段含义：

| 字段 | 作用 | 是否允许 AI 自行补全 |
|---|---|---|
| `trend_keywords` | 类目热搜词、站内搜索词、广告词、竞品词库中筛选出的候选词 | 否 |
| `blocked_keywords` | 禁用词、侵权词、平台风险词 | 否 |
| `platform_policy_notes` | 运营或后台传入的平台规则补充 | 否 |
| `marketplace_region` | 目标市场，例如 US / EU / UK / JP | 否 |
| `title_length_limit` | 标题长度限制 | 否 |

## 5. 需要重点修改的模板

### 5.1 优先级 P0：`title_package` 标题包生成（全局）

这是最核心的标题生成模板，必须优先优化。

#### 建议加入输入字段

在输入字段区追加：

```text
类目热搜词：{{trend_keywords}}
禁用词列表：{{blocked_keywords}}
平台规则备注：{{platform_policy_notes}}
目标站点/国家：{{marketplace_region}}
标题长度限制：{{title_length_limit}}
```

#### 建议加入规则：热搜词使用规则

加入到“标题质量规则”或“标题合规规则”之后：

```text
热搜词使用规则：
1. 如果输入提供 trend_keywords，只能从 trend_keywords 中选择与真实售卖主体强相关的词。
2. 不得自行编造“近期热搜词”“高曝光词”“爆款词”。
3. 热搜词必须同时满足以下条件才可进入标题：
   - 与商品本体一致；
   - 与类目一致；
   - 与标题、SKU、属性或 ProductInfo 至少一个字段有明确关联；
   - 不属于品牌词、IP词、竞品词、促销词、物流词、平台词、医疗功效词、认证词、绝对化词。
4. 热搜词优先放入 category_search_keywords、suggested_category_search_query，不要强行全部塞进 title_en。
5. 英文标题不能为了曝光牺牲可读性；不允许关键词堆砌。
6. 同义词最多选择 1-2 个，不得重复表达同一含义。
```

#### 建议加入规则：证据约束

```text
证据约束：
1. 标题中所有具体属性都必须有输入依据。
2. 没有明确依据时，不得写品牌、IP、材质、尺寸、容量、型号、认证、功效、适配对象、年龄段、产地。
3. 图片可见信息只能用于描述外观、颜色、形状、数量、结构；不能据此推断材质、功效、认证或品牌。
4. 如果输入信息冲突，优先保守输出，并在 avoid_claims 或 category_conflict_reason 中说明被排除的信息。
5. 凡是使用 SKU、属性、ProductInfo、ProductDNA、trend_keywords 中的信息，必须写入 used_basis_fields。
```

#### 建议加入规则：Amazon 平台标题限制

```text
Amazon 平台标题限制：
1. 英文标题建议不超过 180 个字符，最大不得超过 200 个字符，除非 title_length_limit 另有输入。
2. 同一英文实词不得出现超过 2 次，介词、冠词、连词除外。
3. 不得使用 !, $, ?, _, {, }, ^, ¬, ¦ 等特殊符号，除非属于合法品牌名且输入明确提供。
4. 不得写促销、折扣、物流、售后、平台承诺或跨商品推广内容。
5. Amazon 标题优先准确、清晰、可读，不追求堆词。
```

#### 建议加入规则：blocked_keywords

```text
禁用词规则：
1. 如果输入提供 blocked_keywords，标题、候选标题、selling_points、category_search_keywords 中均不得使用这些词。
2. 如果 blocked_keywords 中的词出现在原始标题、属性或 SKU 中，需要在 avoid_claims 中列出并说明已排除。
3. blocked_keywords 优先级高于 trend_keywords。
```

### 5.2 优先级 P0：`title_package_lite` 轻量标题包生成（全局）

轻量模板也必须加限制，否则它可能绕过主模板合规。

#### 建议加入输入字段

```text
类目热搜词：{{trend_keywords}}
禁用词列表：{{blocked_keywords}}
平台规则备注：{{platform_policy_notes}}
标题长度限制：{{title_length_limit}}
```

#### 建议加入规则

```text
补充规则：
1. 如果提供 trend_keywords，只能筛选与商品强相关的词，不得自行生成热搜词。
2. blocked_keywords 中的词不得进入任何输出字段。
3. 标题中所有材质、品牌、认证、功效、尺寸、型号、数量、颜色都必须有输入依据。
4. Amazon 平台英文标题最大不得超过 200 字符，同一英文实词不得超过 2 次。
5. 优先把热搜词放入 category_search_keywords，而不是强行塞入 title_en。
```

### 5.3 优先级 P1：`title_en_with_cn_translation` 英文标题生成及中文翻译

该模板当前“不乱加”控制较好，但缺少热搜词和平台字符限制。

#### 建议加入输入字段

```text
类目热搜词：{{trend_keywords}}
禁用词列表：{{blocked_keywords}}
平台：{{platform}}
标题长度限制：{{title_length_limit}}
```

#### 建议加入规则

```text
标题增强规则：
1. trend_keywords 只能作为候选词来源，不得自行编造热搜词。
2. 只有与商品本体强相关、且不违反平台规则的 trend_keywords 才能进入 title_en。
3. 不适合进入标题但适合检索的热搜词，可放入 core_product_words。
4. blocked_keywords 不得进入 title_en、title_cn_translation、title_en_short、core_product_words。
5. Amazon 平台下，title_en 最大不得超过 200 字符，同一英文实词不得超过 2 次。
```

### 5.4 优先级 P1：`product_info_from_screenshot` 产品截图信息提取

这个模板负责生成商品理解底稿，不应该做标题最终优化，但可以增强“热词不可编造”和“证据记录”。

#### 建议加入规则

```text
补充规则：
1. 不要推断最近热搜词、平台高频词或爆款词。
2. visible_review_keywords 只能来自页面明确可见文本或商品本体可见特征。
3. 不要把促销词、平台词、物流售后词、站内导航词写入 visible_review_keywords。
4. evidence_notes 中应记录关键判断依据，尤其是商品主体、数量、颜色、结构、类目冲突。
```

### 5.5 优先级 P2：图片提示词相关模板

图片模板整体较稳，主要补充“不能生成文字”和“不能虚构卖点”。

适用模板：

- `image_prompt_package`
- `image_prompt_main`
- `image_prompt_carousel_1`
- `image_prompt_carousel_2`
- `image_prompt_carousel_3`
- `image_prompt_carousel_4`
- `image_prompt_carousel_4grid`
- `image_prompt_dimension`

#### 建议统一补充规则

```text
图片合规补充规则：
1. 不得在图片中生成任何可读文字、平台名、品牌名、Logo、价格、促销、二维码、网址、联系方式。
2. 不得为了表达卖点而改变商品结构、颜色、数量、材质或品类。
3. 不得生成无依据功能效果，例如防水、防摔、治疗、瘦身、抗菌、医用、安全认证。
4. 如果 selling_points 中存在无依据功效或认证，必须忽略该卖点。
5. 参考图只能用于商品外观、结构、颜色、数量、角度，不得推断品牌、材质、认证或功效。
```

## 6. 推荐标题生成策略

### 6.1 标题词优先级

标题中词的优先级建议如下：

1. 核心商品词：必须保留。
2. 明确数量 / 套装信息：有依据才写。
3. 关键属性：颜色、形状、款式、适用人群、场景，有依据才写。
4. 材质：只有输入明确提供才写。
5. 热搜词：只从 `trend_keywords` 中筛选，且必须强相关。
6. 风格词：只在服饰、配饰、家居装饰等类目中谨慎使用。
7. 促销词、物流词、平台词、夸张词：禁止。

### 6.2 英文标题建议结构

```text
[Quantity/Pack] + [Core Product Name] + [Target User] + [Key Attribute/Shape/Color/Material if evidenced] + [Style/Use Occasion]
```

注意：

1. 材质无依据就不写。
2. 数量无依据就不写。
3. 使用场景不能盖过商品主体。
4. 不要把 SKU 列表全部塞进标题。
5. 多个同义词不要重复堆叠。

### 6.3 中文标题建议结构

```text
[数量/套装] + [核心商品词] + [适用人群] + [关键属性/形状/颜色/材质] + [风格/场景]
```

注意：

中文标题要给运营复核，重点是准确、自然、可读，不要过度营销。

## 7. 风险词分类

Codex 可在提示词中增强以下风险词分类。

### 7.1 禁止促销词

示例：

```text
free shipping, discount, sale, coupon, deal, cheap, low price, hot sale, clearance, 包邮, 折扣, 优惠, 特价, 秒杀, 爆款
```

### 7.2 禁止物流售后承诺

示例：

```text
refund, return, fast delivery, delivery guarantee, safe payment, credit for delay, 退款, 退货, 快速发货, 延迟赔付, 安全支付
```

### 7.3 禁止极限词 / 夸张词

示例：

```text
best, perfect, No.1, top, ultimate, miracle, must-have, premium, 顶级, 最佳, 完美, 神器, 必备, 最高级
```

说明：

`premium` 在部分场景可能可用，但建议默认禁用，除非平台和运营明确允许。

### 7.4 禁止无依据功效词

示例：

```text
cure, treat, healing, pain relief, slimming, anti-aging, antibacterial, medical, therapy, 治疗, 医用, 止痛, 减肥, 抗衰, 抗菌, 疗效
```

### 7.5 禁止无依据认证 / 安全词

示例：

```text
FDA, CE, RoHS, organic, non-toxic, BPA free, hypoallergenic, child-safe, food-grade, FDA认证, CE认证, 有机, 无毒, 食品级, 儿童安全
```

### 7.6 禁止品牌 / IP / 名人词

规则：

1. 输入没有明确授权或合法适配依据，不得使用品牌词。
2. 不得使用影视、动漫、游戏、名人、球队、奢侈品牌、设计师品牌等 IP 词。
3. 不得使用“compatible with Brand”类词，除非输入明确说明合法适配关系。

## 8. 输出字段使用建议

### 8.1 `avoid_claims`

应包含：

1. 输入中出现但不适合用于标题的词。
2. 被排除的无依据材质词。
3. 被排除的品牌 / IP / 名人 / 认证 / 医疗 / 安全风险词。
4. 被排除的促销词、平台词、物流词。
5. 与商品主体不一致的类目词。

### 8.2 `used_basis_fields`

应包含：

1. 使用了哪些输入字段生成标题。
2. 如果使用 SKU 颜色、数量、尺寸，必须标明。
3. 如果使用 trend_keywords，必须标明 `trend_keywords`。
4. 如果使用 ProductInfo 或 ProductDNA，必须标明具体路径。

### 8.3 `category_search_keywords`

应包含：

1. 中英文核心商品词。
2. 上级类目词。
3. 强相关同义词。
4. 强相关人群词、款式词、形状词。
5. 适合类目召回但不适合放进标题的热搜词。

不得包含：

1. 促销词。
2. 平台词。
3. 物流售后词。
4. 错误类目词。
5. 侵权词。
6. 无依据功效词。

## 9. 推荐 Prompt 片段：可直接插入标题模板

Codex 可以把下面片段加入 `title_package` 和 `title_package_lite`。

```text
热搜词与曝光词规则：
1. 如果输入提供 trend_keywords，只能从 trend_keywords 中选择与真实售卖主体强相关的词。
2. 不得自行编造“近期热搜词”“高曝光词”“爆款词”。
3. 热搜词必须满足以下条件才可进入标题：
   - 与商品本体一致；
   - 与类目一致；
   - 与标题、SKU、属性或 ProductInfo 至少一个字段有明确关联；
   - 不属于品牌词、IP词、竞品词、促销词、物流词、平台词、医疗功效词、认证词、绝对化词。
4. 热搜词优先放入 category_search_keywords、suggested_category_search_query，不要强行全部塞进 title_en。
5. 英文标题不能为了曝光牺牲可读性；不允许关键词堆砌。
6. 同义词最多选择 1-2 个，不得重复表达同一含义。
7. 如果 trend_keywords 与 blocked_keywords 冲突，以 blocked_keywords 为准。
```

```text
证据约束：
1. 标题中所有具体属性都必须有输入依据。
2. 没有明确依据时，不得写品牌、IP、材质、尺寸、容量、型号、认证、功效、适配对象、年龄段、产地。
3. 图片可见信息只能用于描述外观、颜色、形状、数量、结构；不能据此推断材质、功效、认证或品牌。
4. 如果输入信息冲突，优先保守输出，并在 avoid_claims 或 category_conflict_reason 中说明被排除的信息。
5. 使用任何具体属性时，必须在 used_basis_fields 中列出依据字段。
```

```text
平台标题限制：
1. Amazon：英文标题建议不超过 180 个字符，最大不得超过 200 个字符；同一英文实词不得出现超过 2 次；不得使用 !, $, ?, _, {, }, ^, ¬, ¦ 等特殊符号，除非属于合法品牌名且输入明确提供。
2. Temu：标题要直接、清晰、覆盖核心商品词和关键属性；可使用输入 trend_keywords 中的强相关词；不得写促销、物流、退款、平台词、恶意导流词。
3. SHEIN：标题可保留服饰、配饰、时尚电商风格词，但风格词必须有商品外观或类目依据；不得夸张、误导或侵权。
4. general：按保守跨境电商规则生成，优先准确性和可读性。
```

## 10. Codex 实施步骤

### Step 1：定位模板

在 JSON 中定位以下模板：

1. `prompt_type = title_package`
2. `prompt_type = title_package_lite`
3. `prompt_type = title_en_with_cn_translation`
4. `prompt_type = product_info_from_screenshot`
5. 图片提示词模板，可作为 P2 后续修改

### Step 2：新增 optional 变量

仅对标题相关模板新增：

```json
"trend_keywords",
"blocked_keywords",
"platform_policy_notes",
"marketplace_region",
"title_length_limit"
```

注意：不要修改 required。

### Step 3：插入规则文本

把第 9 节中的 3 段规则插入到标题相关模板的“标题合规规则”或“严格要求”后。

### Step 4：检查 JSON 字符串转义

因为模板存在于 JSON 文件中，Codex 修改时需要保证：

1. 换行符合法。
2. 双引号正确转义。
3. JSON 文件能被解析。
4. 不要引入尾随逗号。

### Step 5：回归测试

至少用以下用例测试：

#### Case 1：热搜词输入包含无关词

输入：

```json
{
  "raw_title": "Silver Tone Heart Earrings",
  "trend_keywords": ["earrings", "necklace", "iphone case", "heart jewelry"],
  "blocked_keywords": []
}
```

期望：

1. 标题可以使用 `earrings`、`heart jewelry`。
2. 不得使用 `iphone case`。
3. `necklace` 不应进入标题，除非商品确实是项链。

#### Case 2：热搜词包含品牌 / IP

输入：

```json
{
  "raw_title": "Cartoon Print Phone Case",
  "trend_keywords": ["Disney", "Hello Kitty", "cartoon phone case"],
  "blocked_keywords": ["Disney", "Hello Kitty"]
}
```

期望：

1. 标题不得出现 Disney / Hello Kitty。
2. `avoid_claims` 应列出被排除的品牌/IP词。
3. 可保留 `cartoon phone case`，前提是商品确实是 cartoon 风格。

#### Case 3：材质无依据

输入：

```json
{
  "raw_title": "Heart Pendant Necklace",
  "attributes_text": "Color: Gold",
  "material": "",
  "trend_keywords": ["gold necklace", "stainless steel necklace"]
}
```

期望：

1. 可以写 `gold-tone` 或 `gold color`，如果提示词允许基于颜色描述。
2. 不得写 `gold plated`。
3. 不得写 `stainless steel`。
4. `avoid_claims` 应包含被排除材质词。

#### Case 4：Amazon 标题超长

期望：

1. `title_en` 不超过 200 字符。
2. 同一英文实词不超过 2 次。
3. 不包含被禁特殊符号。

#### Case 5：SKU 与原标题冲突

输入：

```json
{
  "raw_title": "Blue Bracelet",
  "sku_text": "Color: Silver, Gold"
}
```

期望：

1. 不强行写 Blue。
2. 可以写 `Color Options`，或者不写颜色。
3. `category_conflict_reason` 或 `avoid_claims` 中说明颜色冲突。

## 11. 验收标准

修改完成后，必须满足：

1. 原 JSON 可以正常 parse。
2. 原有模板数量不减少。
3. 原有 prompt_type 不改变。
4. 原有 required 字段不减少、不改名。
5. 标题模板支持 `trend_keywords`，但不会自行编造热搜词。
6. 标题模板支持 `blocked_keywords`，且禁用词不会进入输出字段。
7. Amazon 平台标题满足 200 字符、重复词、特殊符号限制。
8. Temu 平台标题不写平台词、导流词、促销词、物流售后词。
9. SHEIN 平台标题可保留风格词，但必须有依据。
10. 没有依据时，不写材质、品牌、认证、功效、尺寸、型号、适配对象。
11. `avoid_claims` 能体现被排除的风险词。
12. `used_basis_fields` 能体现标题依据。
13. 类目关键词更适合检索，但不混入无关曝光词。

## 12. 最重要的一句话

不要让 AI 判断“最近热搜词是什么”。

系统应该从外部数据源传入 `trend_keywords`，AI 只负责判断哪些词与商品强相关、哪些词可以进标题、哪些词只能进入类目检索关键词、哪些词必须排除。

