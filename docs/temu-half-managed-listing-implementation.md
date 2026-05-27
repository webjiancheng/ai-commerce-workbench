# Temu 半托美国站饰品上架与导出完整实现方案

## 1. 目标与边界

第一期只实现一个明确场景：

```text
平台：Temu
履约：半托
站点：美国站
类目：当前饰品类目
官方模板：商品上传模版.xlsx
工作表：模版
```

核心目标：

```text
上架默认值
-> 上架台抽屉补字段
-> 导出检查
-> 批量导出
-> 外部 AI 填表 JSON 导入
-> 导出适配器预留妙手模板扩展
```

第一期不做：

- 不做通用多平台 ERP。
- 不做用户自定义 Excel 映射编辑器。
- 不让用户理解或选择 `template_id`。
- 不把 Excel 模板文件保存为数据库模板记录。
- 不让系统调用 AI 解析 Excel 模板。
- 不物理删除现有表、接口、文件或目录。

数据库可以保留“类目字段方案”，用于保存不同类目的 SPU 商品属性字段和提示，但它不是 Excel 模板记录。

## 2. 总体架构

推荐数据流：

```text
raw_products
  -> product_tasks
  -> product_ai_results
  -> product_assets
  -> default_rules
  -> export_field_drafts
  -> listing_validation
  -> export_adapter
  -> Excel 文件
```

用户主路径：

```text
上架默认值页配置规则
-> 上架台选择商品任务
-> 抽屉选择默认值规则并应用
-> 抽屉补 SPU 属性、SKU、价格、库存、尺寸重量、图片
-> 导出检查
-> 批量导出
-> 导出中心下载历史文件
```

外部 AI 导入路径：

```text
系统提供固定提示词
-> 用户使用外部 AI 生成 JSON
-> 用户粘贴 JSON 到系统
-> 系统解析 common_fields / headers / rows
-> 系统补默认值
-> 用户确认草稿
-> 导出检查
-> 通过导出适配器写 Excel
```

## 3. 模板字段标准

第一期字段权威来源是：

```text
商品上传模版.xlsx / 模版
```

真实结构：

```text
公共字段行：第 1 行
公共默认值行：第 2 行
明细字段行：第 4 行
字段提示行：第 5 行
数据起始行：第 6 行
明细字段数：132
```

已知分组：

```text
A:B    基础信息（SKU/SPU均必填）
C:F    商品基础
G:CH   SPU商品属性
CI:CM  商品规格
CN:CZ  SKU销售信息
DA:DO  SKU体积与重量/敏感属性
DP:DY  SPU商品轮播图
DZ     详情图文
EA     主图视频
EB     详情视频
```

第一期所有导出草稿字段统一使用模板中文字段名，例如：

```text
商品层级
SPU货号
商品名称
英文名称
商品产地
产地省份
镀层
镶嵌材质
主体材质
SKU货号
规格类型1
规格1内容
申报价格-美国站
币种
发货仓1
发货仓1库存
SKU预览图-英语
商品轮播图1
商品轮播图2
商品轮播图3
详情图文-英语
主图视频
详情视频
```

旧字段兼容映射：

```text
申报价CNY -> 申报价格-美国站
建议售价CNY -> 制造商建议零售价(USD) 或暂不导出
库存 -> 发货仓1库存
产品轮播图 -> 商品轮播图1~商品轮播图10
产品素材图 -> SKU预览图-英语
```

## 4. 后端模块设计

### 4.1 固定模板解析服务

新增：

```text
apps/api/app/services/temu_upload_template.py
```

职责：

- 读取 `商品上传模版.xlsx`。
- 固定使用 `模版` sheet。
- 解析公共字段、明细字段、提示、必填、条件必填、枚举、字段分组。
- 提供运行时字段结构，不写入数据库模板表。

建议输出结构：

```json
{
  "adapter_key": "temu_half_managed_jewelry_upload",
  "sheet_name": "模版",
  "common_fields": [],
  "detail_fields": [],
  "required_fields": [],
  "conditional_required_fields": [],
  "enum_options_map": {},
  "conditional_rules": [],
  "groups": []
}
```

字段对象建议：

```json
{
  "field_name": "申报价格-美国站",
  "column_index": 94,
  "column_letter": "CP",
  "group": "SKU销售信息",
  "required": true,
  "conditional_required": false,
  "hint": "必填",
  "enum_options": []
}
```

性能策略：

- 可以用 `functools.lru_cache` 缓存解析结果。
- 模板文件变更时重启服务即可刷新。

### 4.2 上架默认值服务

复用：

```text
apps/api/app/services/default_rules.py
apps/api/app/models/default_rule.py
```

第一期继续用 `default_rules.values_json` 保存默认值。

规则范围：

```json
{
  "platform": "Temu",
  "site": "美国站",
  "fulfillment_mode": "半托",
  "category_path": "服装、鞋靴和珠宝饰品>女士时尚>女士饰品>女士耳饰>女士时尚耳廓环和全耳式耳环"
}
```

默认值字段建议：

公共字段：

```text
经营站点
发货仓
类目
运费模版
承诺发货时效
素材语言
```

通用字段：

```text
商品产地
产地省份
币种
发货仓1
发货仓1库存
SKU分类
SKU数量
SKU数量单位
是否独立包装
最长边（cm）
次长边（cm）
最短边（cm）
重量（g）
```

SPU 商品属性：

```text
镀层
镶嵌材质
主体材质
耳针材质
是否为羽毛
适配季节
是否含金属部件
金属部件材质类型1
风格1
佩戴场合1
营销节日1
主题1
```

SPU 属性必须支持用户动态添加。

### 4.3 导出草稿服务

复用并增强：

```text
apps/api/app/services/export_fields.py
apps/api/app/models/export_field_draft.py
```

核心原则：

- `export_field_drafts.fields_json` 存标准业务字段。
- 字段名以 `商品上传模版.xlsx / 模版` 中文表头为准。
- 人工覆盖字段不能被默认值再次覆盖。
- 字段来源记录在 `field_sources_json`。

字段来源建议：

```text
default_rule
ai_generated
product_task
raw_product
asset
manual_override
system_generated
```

需要增强的函数：

```text
apply_default_rules_with_options
patch_export_fields_manual
get_export_field_candidates
```

应用默认值逻辑：

```text
1. 读取已有草稿
2. 锁定 manual_override 字段
3. 构建商品任务/AI/原始采集基础字段
4. 应用选中的 default_rule
5. 自动补货号、标题、类目、SKU 基础值
6. 自动补图片字段
7. 写入 export_field_drafts
```

### 4.4 类目字段方案

现有：

```text
apps/api/app/models/listing_template.py
apps/api/app/api/routes/listing_templates.py
```

建议不删除，但产品语义改成：

```text
类目字段方案
```

用途：

- 保存不同类目的 SPU 商品属性字段。
- 保存字段默认值、排序、字段提示。
- 在上架台选择类目后提示用户需要填写哪些属性。

不用于：

- 不保存 Excel 模板文件路径。
- 不作为导出模板记录。
- 不对用户暴露 `template_id`。

如果后续要重命名表，可以另开迁移；第一期只改产品文案和使用方式。

### 4.5 导出检查服务

新增：

```text
apps/api/app/services/listing_validation.py
```

统一返回结构：

```json
{
  "errors": [
    {
      "field_name": "申报价格-美国站",
      "field_key": "申报价格-美国站",
      "row_index": 0,
      "type": "missing_required",
      "message": "申报价格-美国站为必填",
      "blocking": true
    }
  ],
  "warnings": [],
  "summary": {
    "error_count": 1,
    "warning_count": 0,
    "exportable": false
  }
}
```

阻断错误：

- 模板必填字段为空。
- `商品层级` 为空或不合法。
- `SPU货号` 为空。
- `SKU货号` 为空。
- `申报价格-美国站` 为空。
- `发货仓1` 为空。
- `发货仓1库存` 为空。
- `SKU预览图-英语` 为空。
- `商品轮播图1`、`商品轮播图2`、`商品轮播图3` 为空。
- 枚举字段值不在模板枚举中。

警告：

- 条件必填字段为空。
- 图片宽高低于 800px。
- 图片比例不是 1:1。
- 图片大小未知或超过限制。
- 详情图文为空。
- 主图视频为空。
- 详情视频为空。
- AI 标题或类目缺失。

图片检查：

- 优先用 `product_assets.width / height`。
- 本地文件可检查大小。
- 远程 URL 可访问性第一期作为警告。

### 4.6 导出适配器

新增目录：

```text
apps/api/app/services/export_adapters/
```

建议文件：

```text
base.py
registry.py
temu_half_managed_jewelry_upload.py
miaoshou_temu_non_apparel.py
```

第一期实现：

```text
temu_half_managed_jewelry_upload
```

后续预留：

```text
miaoshou_temu_non_apparel
```

适配器接口建议：

```python
class ExportAdapter:
    adapter_key: str
    display_name: str

    def get_template_meta(self) -> dict:
        ...

    def validate_rows(self, rows: list[dict], context: dict) -> dict:
        ...

    def write_excel(self, rows: list[dict], context: dict) -> str:
        ...
```

注册表：

```python
ADAPTERS = {
    "temu_half_managed_jewelry_upload": TemuHalfManagedJewelryUploadAdapter(),
}
```

用户看到的是导出格式：

```text
Temu美国站半托饰品商品上传模板
```

用户不看到：

```text
adapter_key
template_id
Excel 文件路径
字段映射表
```

#### 4.6.1 商品上传模板适配器

```text
adapter_key: temu_half_managed_jewelry_upload
display_name: Temu美国站半托饰品商品上传模板
file: 商品上传模版.xlsx
sheet: 模版
```

写入规则：

- 公共字段写第 2 行。
- 明细字段从第 6 行开始写。
- 按第 4 行中文表头定位列。
- 保留模板原有隐藏表、数据验证和样式。
- 导出文件写入 `storage/exports/`。

#### 4.6.2 妙手模板适配器

后续实现：

```text
adapter_key: miaoshou_temu_non_apparel
display_name: 妙手Temu非服饰导入模板
file: 妙手Temu导入模板-非服饰类模板 .xlsx
sheet: Sheet1
```

目标是复用同一份标准业务字段，转换成妙手字段。

典型映射方向：

```text
商品名称 -> 产品标题 / 商品标题
英文名称 -> 英文标题
SPU货号 -> 主编号 / 主货号
SKU货号 -> 平台SKU / SKU货号
规格类型1 -> 规格名称1
规格1内容 -> 规格属性值1
规格类型2 -> 规格名称2
规格2内容 -> 规格属性值2
申报价格-美国站 -> 申报价（CNY）
发货仓1库存 -> 库存
最长边（cm） -> 长（cm）
次长边（cm） -> 宽（cm）
最短边（cm） -> 高（cm）
重量（g） -> 重量（g）
商品轮播图1~商品轮播图10 -> 产品轮播图
SKU预览图-英语 -> 产品素材图 / SKU预览图
详情图文-英语 -> 产品说明书 / 详情图文
主图视频 -> 主图视频
货源链接 -> 货源链接 / 站外产品链接
```

实际字段必须以 `妙手Temu导入模板-非服饰类模板 .xlsx / Sheet1` 表头为准。

### 4.7 导出执行服务

改造：

```text
apps/api/app/services/export_runner.py
```

请求参数建议：

```json
{
  "product_task_ids": [1, 2, 3],
  "export_adapter": "temu_half_managed_jewelry_upload",
  "default_rule_id": 1,
  "export_only_valid": true
}
```

预览流程：

```text
1. 获取 adapter
2. 读取或生成每个任务的 export_field_draft
3. 构建标准业务字段 row
4. 执行标准校验
5. 执行适配器专属校验
6. 返回每个任务的 errors / warnings
```

导出流程：

```text
1. 执行预览/校验
2. 分离通过任务和失败任务
3. 如果 export_only_valid=true，只导出通过任务
4. 如果 export_only_valid=false，有错误则整体阻断
5. 调用 adapter.write_excel
6. 写入 export_batches / export_records
7. 返回下载链接和失败详情
```

批量导出不要因为一个任务失败而阻止所有任务。

### 4.8 API 调整

复用现有：

```text
POST /api/exports/preview
POST /api/exports/run
GET /api/exports/history
GET /api/exports/{batch_id}/download
```

请求体增加：

```json
{
  "export_adapter": "temu_half_managed_jewelry_upload",
  "default_rule_id": 1,
  "export_only_valid": true
}
```

新增可选接口：

```text
GET /api/exports/adapters
```

返回：

```json
{
  "items": [
    {
      "adapter_key": "temu_half_managed_jewelry_upload",
      "display_name": "Temu美国站半托饰品商品上传模板",
      "enabled": true,
      "is_default": true
    }
  ]
}
```

上架台抽屉可新增：

```text
POST /api/product-tasks/{task_id}/export-fields/validate
```

也可以复用 `/api/exports/preview` 传单个任务实现。

## 5. 前端实现方案

### 5.1 `/rules` 上架默认值页

复用：

```text
apps/web/src/app/rules/page.tsx
```

改造方向：

- 页面名称：上架默认值规则。
- 第一阶段默认显示 Temu 美国站半托饰品规则。
- 不显示模板 ID。
- 不做 Excel 模板管理。

分组：

```text
基础信息
公共上架信息
商品基础默认值
SPU 商品属性
SKU 与库存
尺寸重量
敏感属性
```

能力：

- 新建规则。
- 编辑规则。
- 复制规则。
- 停用规则。
- 动态添加 SPU 属性字段。
- 保存到 `default_rules.values_json`。

### 5.2 上架台抽屉

复用：

```text
apps/web/src/app/product-tasks/page.tsx
DefaultsTab
```

建议分组：

```text
导出检查摘要
默认值规则
基础信息
SPU 商品属性
SKU 规格与销售
尺寸重量
图片视频
动态字段
```

字段编辑：

- `商品名称`
- `英文名称`
- `商品产地`
- `产地省份`
- `镀层`
- `镶嵌材质`
- `主体材质`
- 动态 SPU 属性
- `SKU分类`
- `SKU数量`
- `SKU数量单位`
- `是否独立包装`
- `申报价格-美国站`
- `发货仓1`
- `发货仓1库存`
- `最长边（cm）`
- `次长边（cm）`
- `最短边（cm）`
- `重量（g）`

交互：

- 选择默认值规则。
- 应用默认值。
- 保存当前商品覆盖字段。
- 只看错误字段。
- 点击错误定位字段。
- 展示字段来源标签。

字段来源标签：

```text
默认值
AI
商品任务
图片资产
人工
系统
```

### 5.3 图片视频区

复用现有图片处理能力。

导出要求：

- `商品轮播图1`、`商品轮播图2`、`商品轮播图3` 必填。
- `SKU预览图-英语` 必填。
- 轮播图最多 10 张。
- 图片比例建议 1:1。
- 宽高不低于 800px。
- 大小不超过平台限制。

图片资产区应显示：

```text
是否已选为导出图
宽高
比例
大小
是否通过导出检查
```

### 5.4 `/exports` 导出中心

复用：

```text
apps/web/src/app/exports/page.tsx
```

定位：

- 导出历史。
- 下载文件。
- AI 填表导入。
- 固定导出入口可保留，但不是主编辑入口。

导出格式选择：

```text
Temu美国站半托饰品商品上传模板
```

后续增加：

```text
妙手Temu非服饰导入模板
```

不要显示：

```text
template_id
adapter_key
字段映射配置
```

### 5.5 AI 填表导入页面/Tab

保留在 `/exports` 的 AI 导入 tab。

流程：

```text
复制提示词
-> 粘贴外部 AI JSON
-> 解析
-> 默认值补齐
-> 草稿确认
-> 导出检查
-> 导出 Excel
```

固定 JSON：

```json
{
  "version": "1.0",
  "source": "external_ai_temu_template",
  "sheet_name": "模版",
  "common_fields": {},
  "headers": [],
  "rows": [],
  "warnings": []
}
```

规则：

- 字段名必须和模板中文字段一致。
- 图片、视频、详情图文字段保留字段名，但值留空。
- 系统不调用 AI。
- 系统不消耗 token。
- 用户确认后再导出。

## 6. 数据库策略

### 6.1 保留表

继续使用：

```text
default_rules
export_field_drafts
ai_import_batches
ai_import_drafts
product_assets
export_batches
export_records
```

### 6.2 不新增 Excel 模板记录表

不把 `商品上传模版.xlsx` 或 `妙手Temu导入模板-非服饰类模板 .xlsx` 保存为数据库模板记录。

### 6.3 导出批次记录适配器信息

推荐后续给 `export_batches` 增加字段：

```text
export_adapter
export_adapter_name
```

如果暂不改表，可以先写入记录 JSON 中。

### 6.4 类目字段方案

`listing_templates` 可以保留，但产品语义改为“类目字段方案”。

保存内容：

- 类目路径。
- 类目关键词。
- SPU 属性字段。
- 默认值。
- 字段提示。
- 字段顺序。

不保存内容：

- Excel 文件路径。
- Excel 模板版本。
- `template_id` 给用户选择。

## 7. 分阶段开发计划

### 阶段 1：固定模板解析

任务：

- 新增 `temu_upload_template.py`。
- 解析 `商品上传模版.xlsx / 模版`。
- 输出 132 个字段、必填、条件必填、枚举、分组。

验收：

- 后端能返回模板结构。
- 字段数量、必填数量与扫描结果一致。

### 阶段 2：字段名统一

任务：

- 抽屉字段改用模板中文字段。
- `export_field_drafts` 新写入字段使用模板中文字段。
- 保留旧字段兼容映射。

验收：

- 保存草稿后能看到 `申报价格-美国站`、`发货仓1库存` 等新字段。

### 阶段 3：默认值规则

任务：

- `/rules` 收敛为当前 Temu 半托饰品默认值。
- 支持动态 SPU 属性。
- 上架台可选择规则并应用。

验收：

- 规则能应用到单个任务和批量任务。
- 人工覆盖字段不会被默认值覆盖。

### 阶段 4：抽屉字段编辑

任务：

- 重构 `DefaultsTab` 分组。
- 支持 SPU 属性、SKU、价格、库存、尺寸重量编辑。
- 显示字段来源。

验收：

- 用户能在抽屉内补齐导出字段。

### 阶段 5：导出检查

任务：

- 新增 `listing_validation.py`。
- 支持标准业务字段检查。
- 支持图片尺寸、比例、大小检查。
- 支持枚举检查。

验收：

- 单任务和批量任务都能返回结构化错误。
- 抽屉能显示错误并定位字段。

### 阶段 6：导出适配器

任务：

- 新增 `export_adapters`。
- 实现 `temu_half_managed_jewelry_upload`。
- `/api/exports/preview` 和 `/api/exports/run` 支持 `export_adapter`。

验收：

- 可写出 `商品上传模版.xlsx / 模版` 格式 Excel。

### 阶段 7：批量导出

任务：

- 批量导出前执行检查。
- 支持只导出通过任务。
- 失败任务返回原因。
- 导出历史可下载。

验收：

- 20 个任务中 17 个通过时，可导出 17 个，失败 3 个保留原因。

### 阶段 8：AI 填表导入收敛

任务：

- 固定提示词。
- 粘贴 JSON。
- 解析草稿。
- 补默认值。
- 走同一套导出检查和适配器。

验收：

- 外部 AI JSON 可导入并导出 Excel。

### 阶段 9：妙手适配器

任务：

- 实现 `miaoshou_temu_non_apparel`。
- 按 `Sheet1` 表头做字段映射。
- 增加导出格式选项。

验收：

- 同一份导出草稿可导出妙手模板。

## 8. 风险点

### 8.1 字段名混乱

最大风险是旧字段和新模板字段混用。必须优先做字段统一和兼容映射。

### 8.2 SPU/SKU 行结构

`商品上传模版.xlsx` 区分 `SPU`、`SKU`、`单SKU商品`。导出写入前要明确每个任务生成几行。

第一期可先支持单 SKU 或每个任务一行，后续再完善多 SKU 多行。

### 8.3 图片字段

图片字段既可能是 URL，也可能是素材 ID。第一期建议：

- 系统生成图片用 URL。
- 素材 ID 作为后续扩展。
- URL 可访问性先做警告。

### 8.4 条件必填

模板里条件必填很多。第一期只对能解析到明确条件的字段做阻断，其余先做警告。

### 8.5 妙手模板差异

妙手模板不能影响第一期官方模板主链路。必须通过适配器隔离。

## 9. 验证清单

后端验证：

- 能解析 `商品上传模版.xlsx / 模版`。
- 能应用默认值规则。
- 能保存导出草稿。
- 能校验必填、枚举、图片。
- 能写出 Excel。
- 能返回部分成功的批量导出结果。

前端验证：

- `/rules` 能保存默认值。
- 上架台抽屉能选择规则。
- 抽屉能补 SPU 属性和 SKU 字段。
- 抽屉能显示导出检查错误。
- 批量导出能只导出通过任务。
- `/exports` 能下载历史文件。
- AI 导入 JSON 能生成草稿并导出。

文件验证：

- 导出的 Excel 保留原模板隐藏表和数据验证。
- 数据写入 `模版` sheet 正确行列。
- 公共字段写入第 2 行。
- 明细字段从第 6 行开始写。

## 10. 建议涉及文件

后端新增：

```text
apps/api/app/services/temu_upload_template.py
apps/api/app/services/listing_validation.py
apps/api/app/services/export_adapters/base.py
apps/api/app/services/export_adapters/registry.py
apps/api/app/services/export_adapters/temu_half_managed_jewelry_upload.py
```

后端改造：

```text
apps/api/app/services/export_fields.py
apps/api/app/services/export_runner.py
apps/api/app/services/ai_imports.py
apps/api/app/api/routes/exports.py
apps/api/app/api/routes/export_fields.py
apps/api/app/api/routes/default_rules.py
apps/api/app/models/export_batch.py
apps/api/app/models/export_record.py
```

前端改造：

```text
apps/web/src/app/rules/page.tsx
apps/web/src/app/product-tasks/page.tsx
apps/web/src/app/exports/page.tsx
```

文档维护：

```text
docs/temu-half-managed-listing-dev-plan.md
docs/temu-half-managed-listing-implementation.md
```
