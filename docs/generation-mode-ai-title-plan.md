# AI 标题模式（模式 2）执行方案

本文不是“当前真实实现说明”，而是面向后续改造的目标设计与执行计划。

目标模式：

- 名称：`AI 标题模式`
- 定义：`1 次轻量标题 AI + 1 次代码类目召回 + 原始素材回显`
- 目标：在尽量少消耗 token 的前提下，完成标题预处理与类目候选召回，不默认生成图片提示词或图片结果。

## 1. 目标行为

### 1.1 创建任务时默认要做的事

1. 创建 `product_tasks`
2. 同步原始采集素材与基础字段
3. 回显原始主图、轮播图、SKU 图、详情图、尺寸图候选
4. 调用 1 次轻量标题 AI
5. 基于 AI 返回的类目检索字段做代码召回
6. 默认采用第 1 个候选类目作为“建议值”
7. 标记“待人工确认”
8. 任务进入 `review_ready`

### 1.2 创建任务时默认不做的事

- 不调用 `product_info_from_screenshot`
- 不调用 `image_prompt_package`
- 不默认生成主图
- 不默认生成 SKU 图
- 不默认生成四宫格
- 不默认生成主图轮播图
- 不默认生成导出草稿

### 1.3 前端默认回显内容

- 原始标题
- AI 优化标题
- 原始类目路径
- AI 类目检索字段
- 代码召回候选列表
- 默认第 1 候选类目
- 原始轮播图
- 原始 SKU 图
- 原始详情图

### 1.4 用户后续主动触发内容

- 批量标题重生成
- 主图生成
- SKU 图生成
- 四宫格生成
- 主图轮播图生成
- 默认值应用
- 导出预览 / 导出执行

## 2. 与当前实现的关键差异

当前 `title_only` 已接近目标模式，但仍有几个偏差：

1. 会因为依赖补齐逻辑自动补跑 `product_info`
2. `title_package` 模板过重，不适合轻量模式
3. 日志抽屉没有把“AI 检索字段 -> 代码召回 -> 默认第 1 候选”单独拆开
4. 前端没有足够明确地区分“原始回显字段”和“AI 生成字段”

## 3. 后端改动清单

### 3.1 调整模式 2 的依赖规则

目标：

- `AI 标题模式` 默认只跑标题 AI
- 不再因 `title_package` 自动补 `product_info`

建议改动点：

- 文件：`apps/api/app/services/ai_pipeline.py`
- 重点函数：
  - `_normalize_requested_steps(...)`
  - `_expand_wanted_with_dependencies(...)`
  - `run_ai_pipeline_for_task(...)`

建议策略：

- 当 `generation_mode == title_only` 时，走独立轻量分支
- 该分支仅允许：
  - `title_package_lite`
  - `category_match`（代码召回）
- 禁止自动补齐：
  - `product_info`
  - `image_prompt_package`

### 3.2 引入轻量标题模板

目标：

- 让模式 2 的标题调用只承载“标题 + 类目检索字段”职责
- 降低 prompt token 与 completion token

建议新增：

- prompt type：`title_package_lite`

建议输入最小集：

- `raw_title`
- `original_category_path`
- `attributes_text`
- `sku_text`
- `platform`

建议输出最小集：

- `title_cn`
- `title_en`
- `core_product_words`
- `category_search_keywords`
- `suggested_category_search_query`
- `suggested_category_path_keywords`
- `avoid_claims`

建议不在轻量模式默认输出：

- 多组候选标题
- 大段类目冲突解释
- 大量平台规则派生字段
- 图片相关字段

### 3.3 保留类目代码召回，但加强调试信息

目标：

- 类目仍然由代码召回，不增加 LLM 调用
- 增强调试信息，便于日志抽屉显示

保留：

- `recall_category_candidates_multi(...)`

建议补充输出：

- AI 检索关键词来源
- 实际参与召回的 query 列表
- exclude terms
- 每个候选的命中词
- 默认第 1 候选为何排第 1

建议落库位置：

- `product_ai_results.category_match.output`
- `product_tasks.category_candidates_json`

### 3.4 明确模式 2 的任务状态

建议状态顺序：

1. `collected`
2. `ai_running`
3. `prompts_ready`
4. `review_ready`

其中：

- `title_status = success`
- `image_prompt_status = pending`
- `image_status = pending`
- `export_status = pending`

## 4. 前端改动清单

### 4.1 原始采集页模式文案

文件：

- `apps/web/src/app/raw-products/page.tsx`

建议文案：

- `只建任务`
- `AI 标题`
- `AI 标题 + 提示词`

其中 `AI 标题` 的副说明建议写明：

- 只生成标题与类目检索字段
- 图片素材仍按原始采集结果回显
- 不默认生成主图 / 四宫格 / SKU 图

### 4.2 上架台字段边界要明确

文件：

- `apps/web/src/app/product-tasks/page.tsx`

建议拆成两类标签：

- `原始回显`
- `AI 生成`

建议标记：

- 轮播图：原始回显
- SKU 图：原始回显
- 标题：AI 生成
- 类目检索字段：AI 生成
- 默认候选类目：代码召回结果

### 4.3 图片动作统一变成后续主动触发

模式 2 下，前端不应让用户误以为“创建任务时已经生成图片结果”。

建议默认按钮状态：

- 主图：可生成
- SKU 图：可生成
- 四宫格：可生成
- 主图轮播图：可生成

## 5. 日志抽屉改造方案

模式 2 的日志抽屉要围绕“少步骤、易排查”设计。

### 5.1 顶部总览

建议展示：

- 任务 ID
- 原始采集 ID
- 生成模式：`AI 标题`
- 当前状态
- 当前卡点
- AI 调用次数：`1 / 1`
- 图片生成次数：`0 / 按需`

### 5.2 主链路阶段

固定展示 5 个阶段：

1. 任务创建
2. 素材同步
3. AI 标题生成
4. 类目候选召回
5. 人工待确认

不要把图片生成、导出草稿混进主链路。

### 5.3 类目处理专项区

这是模式 2 日志里最重要的区块。

建议展示：

- 原始类目路径
- AI 类目检索字段
- AI 建议搜索短语
- 代码召回候选数
- 默认第 1 候选
- 是否人工改过类目

候选表建议字段：

- 排名
- 类目路径
- 分数
- 命中词
- 来源字段

### 5.4 AI 调用明细区

模式 2 默认应只有 1 条 AI 调用卡片：

- 步骤：标题生成
- 模板：`title_package_lite`
- provider / model
- 输入摘要
- 输出摘要
- prompt tokens
- completion tokens
- estimated cost

### 5.5 后续动作区

单独展示，不属于创建任务默认链路：

- 主图生成
- SKU 图生成
- 四宫格生成
- 主图轮播图生成
- 导出草稿
- 导出执行

## 6. 省 token 方案

### 6.1 第一优先级：禁止补跑 `product_info`

这是模式 2 最重要的省 token 改动。

原因：

- 当前最大的额外开销来自“只想生成标题，但后端又补跑了商品理解”

改完后的目标：

- 模式 2 始终只消耗 1 次文本 AI

### 6.2 第二优先级：轻量模板替代重模板

当前 `title_package` 模板过长，适合模式 3，不适合模式 2。

建议：

- 新增 `title_package_lite`
- 减少规则长度
- 减少输出字段数量
- 默认不返回多组候选标题

### 6.3 第三优先级：输入字段最小化

模式 2 的标题 AI 默认不要传：

- `product_info`
- `raw_payload`
- `reference_images`
- 全量截图备注

默认只传：

- `raw_title`
- `original_category_path`
- `attributes_text`
- `sku_text`
- `platform`

### 6.4 第四优先级：候选标题按需生成

默认只返回：

- 主中文标题
- 主英文标题

可选返回：

- 1 条备选标题

不建议在创建任务阶段默认生成多组候选。

### 6.5 第五优先级：类目判断交给代码

LLM 只负责：

- 类目检索词
- 类目搜索短语
- 排除词 / 风险词

最终候选召回继续交给代码，避免增加第二次 LLM 调用。

## 7. 执行顺序

建议按以下顺序推进：

### 第 1 阶段：先收紧模式定义

- 前端模式文案收敛
- 文档确认模式 2 默认动作和非默认动作
- 日志抽屉主链路改成 5 步

### 第 2 阶段：落轻量标题链路

- 新增 `title_package_lite`
- 模式 2 禁止补 `product_info`
- 压缩输入输出 schema

### 第 3 阶段：补类目处理可视化

- 增强 `category_match` 调试输出
- 前端抽屉加入类目专项区

### 第 4 阶段：收尾体验

- 上架台区分“原始回显 / AI 生成”
- 图片入口明确改为“后续主动触发”

## 8. 验收标准

模式 2 改造完成后，应满足：

1. 创建任务默认只触发 1 次文本 AI
2. 不会自动补跑 `product_info`
3. 不会自动生成图片提示词
4. 不会自动生成图片结果
5. 类目链路清晰展示为：
   - `AI 检索字段 -> 代码召回 -> 默认第 1 候选 -> 人工确认`
6. 日志抽屉能清楚区分：
   - 原始回显字段
   - AI 生成字段
   - 后续主动触发动作

## 9. 开发执行清单

本节把方案直接映射到当前代码入口，方便按文件拆任务。

### 9.1 后端第一批：压缩模式 2 的默认 AI 调用

文件：

- `apps/api/app/services/ai_pipeline.py`
- `apps/api/app/core/prompt_types.py`
- `apps/api/app/data/default_prompt_templates.json`

任务：

1. 为模式 2 增加轻量标题输出模型
2. 新增 `title_package_lite` prompt type
3. 在默认 prompt 模板种子中增加 `title_package_lite`
4. 调整 `title_only` 的步骤归一逻辑
5. 阻止 `title_only` 自动补齐 `product_info`

建议具体改动：

- 在 `ai_pipeline.py` 中新增轻量输出 schema
  - 例如：`TitlePackageLiteOutput`
- 改 `_normalize_requested_steps(...)`
  - `title_only` 不再映射到重型 `title_package`
  - 改为映射到轻量标题步骤
- 改 `_expand_wanted_with_dependencies(...)`
  - 当模式为 `title_only` 时，不触发 `product_info` 依赖补齐
- 改 `run_ai_pipeline_for_task(...)`
  - 为模式 2 增加轻量执行分支
  - 该分支仅做：
    - 渲染 `title_package_lite`
    - 解析轻量标题输出
    - 写入 `ai_row.title_package`
    - 执行 `category_match` 代码召回

### 9.2 后端第二批：保持兼容落库

文件：

- `apps/api/app/services/product_tasks.py`
- `apps/api/app/services/export_fields.py`
- `apps/api/app/services/image_generation.py`

任务：

1. 保证轻量标题结果仍兼容现有摘要逻辑
2. 保证导出字段读取标题时不报错
3. 保证后续图片生成仍能在需要时补齐上游

建议具体改动：

- `product_tasks.py`
  - `build_ai_summary(...)` 继续优先读 `title_package`
  - 允许 `title_package` 为轻量结构
- `export_fields.py`
  - 继续从 `title_package.output.title_cn / title_en` 取值
  - 不强依赖重型字段
- `image_generation.py`
  - 保持现有“按需补齐”逻辑
  - 也就是：即使模式 2 创建阶段没跑 `product_info`，用户后续点击图片生成时仍可补跑

### 9.3 后端第三批：增强类目召回可视化数据

文件：

- `apps/api/app/services/ai_pipeline.py`
- `apps/api/app/services/product_tasks.py`

任务：

1. 丰富 `category_match.output`
2. 把类目检索与候选排序原因暴露给时间线

建议补充字段：

- `query_sources`
- `queries`
- `exclude_terms`
- `matched_terms`
- `top_candidate_reason`

建议具体改动：

- 在 `ai_pipeline.py` 的类目召回结果中增加这些调试字段
- 在 `product_tasks.py` 的 `_build_ai_events(...)` 中，把这些字段带进 `event.meta`

### 9.4 前端第一批：模式文案和运行时选择

文件：

- `apps/web/src/app/raw-products/page.tsx`
- `apps/web/src/lib/local-settings.ts`

任务：

1. 把模式文案改成业务化表达
2. 调整模式 2 的 AI purpose 路由

建议具体改动：

- `raw-products/page.tsx`
  - 把 `只要 AI 标题` 改成 `AI 标题`
  - 为模式选择补副说明
- `getCreateTaskPurposes(...)`
  - 当前模式 2 返回：`["title_package", "title", "product_info"]`
  - 目标改成只返回轻量标题相关 purpose
  - 建议：`["title_package_lite", "title"]`
- `local-settings.ts`
  - 若 purpose 白名单需要扩展，增加 `title_package_lite`

### 9.5 前端第二批：日志抽屉结构改造

文件：

- `apps/web/src/app/product-tasks/page.tsx`

重点区域：

- `TraceTab(...)`
- `buildAiRequestHeaders(...)`
- 任务详情抽屉内各 Tab

任务：

1. 把模式 2 的主链路改成 5 步
2. 单独增加“类目处理”专项区
3. 区分“原始回显”和“AI 生成”
4. 区分“默认链路”和“后续主动触发”

建议具体改动：

- `TraceTab(...)`
  - 模式 2 的 `expectedAiStages` 只保留：
    - `ai.title_package`
    - `ai.category_match`
  - `flowPlan` 改成：
    - 标题生成
    - 类目候选召回
- 新增一个类目专项渲染块
  - 读取 `category_match.output`
  - 展示：
    - AI 检索词
    - query_sources
    - top candidates
    - 默认第 1 候选
- 当前“图片任务 / 导出草稿”仍保留，但放入后续动作区，不混入主链路

### 9.6 前端第三批：上架台标签边界

文件：

- `apps/web/src/app/product-tasks/page.tsx`

任务：

1. 给字段加来源标签
2. 减少用户误解“这些是不是 AI 自动生成的”

建议标记：

- 标题：`AI 生成`
- 类目检索词：`AI 生成`
- 默认候选类目：`代码召回`
- 轮播图：`原始回显`
- SKU 图：`原始回显`

## 10. 推荐实施顺序

### 第 1 步：先落后端轻量链路

原因：

- 这是省 token 的最大收益点
- 不先改后端，前端文案再好也会继续多跑一次 AI

完成标志：

- `title_only` 创建任务时只调用 1 次文本 AI

### 第 2 步：补轻量 prompt 模板和运行时 purpose

原因：

- 否则前端路由到的仍然是重型标题能力

完成标志：

- 模式 2 使用 `title_package_lite`

### 第 3 步：改日志抽屉

原因：

- 用户最先感知到的就是“这条任务到底做了什么”

完成标志：

- 抽屉里能清晰看到：
  - 标题 AI
  - 类目代码召回
  - 原始素材回显
  - 后续动作未执行

### 第 4 步：收尾前端文案和来源标签

原因：

- 这一步风险最低，但能明显减少误解

完成标志：

- 用户能区分原始回显字段和 AI 生成字段

## 11. 风险与兼容点

### 11.1 图片链路兼容

风险：

- 现有图片生成逻辑默认依赖 `title_package`，有时还会补 `product_info`

处理方式：

- 模式 2 仅在创建阶段不跑 `product_info`
- 图片生成入口继续保留按需补齐逻辑

### 11.2 导出链路兼容

风险：

- 导出字段逻辑可能读取重型标题字段

处理方式：

- 轻量标题结构至少保留：
  - `title_cn`
  - `title_en`

### 11.3 提示词中心兼容

风险：

- 新增 `title_package_lite` 后，提示词中心和 prompt type 列表需要同步

处理方式：

- 同步更新：
  - `apps/api/app/core/prompt_types.py`
  - `apps/web/src/app/prompts/page.tsx`
  - 任何 prompt type label 映射处

## 12. 当前完成状态

### 12.1 已完成

1. 模式 2 的默认依赖已收紧
2. `title_only` 不再自动补跑 `product_info`
3. 模式 2 已接入 `title_package_lite`
4. 原始采集页的本地运行时 purpose 已切到轻量标题链路
5. 日志抽屉已补齐：
   - `AI 检索字段 -> 代码召回 -> 默认第 1 候选`
6. 日志抽屉已拆成：
   - 默认链路
   - 后续主动触发
   - 关键时间线
   - 折叠明细

### 12.2 待完成

1. 模式文案统一收口
2. 图片生成策略三档落地
3. 导出校验前端规则清单
4. 文档与页面说明同步更新

## 13. 提示词分层策略

### 13.1 总原则

提示词体系采用：

1. 统一的提示词解析与渲染机制
2. 按 `prompt_type` 区分任务职责
3. 同类任务优先统一骨架模板
4. 通过“裁剪输入字段”和“裁剪输出字段”优先省 token
5. 只有当任务职责明显不同，才拆成 `lite / full`

### 13.2 当前建议分层

#### 标题类

- `title_package_lite`
- `title_package`

说明：

- `lite` 用于模式 2
- `full` 用于模式 3

#### 商品理解类

- `product_info_from_screenshot`

说明：

- 独立承担商品理解 / DNA 职责
- 不与标题模板混用

#### 图片提示词类

- 当前保留 `image_prompt_package`
- 后续可按成本拆 `lite / full`

#### 导出校验类

- `export_validation` 先保留占位
- 当前阶段不纳入 AI 实现
- 先由前端规则校验承担

## 14. 图片生成策略

图片生成策略不属于“创建任务默认模式”，而属于“后续图片动作模式”。

建议与创建任务模式分层：

- 创建任务模式：
  - `只建任务`
  - `AI 标题`
  - `AI 标题 + 提示词`
- 图片生成策略：
  - `快速模式（4宫格）`
  - `标准模式`
  - `完整模式`

### 14.1 快速模式（4宫格）

目标：

- 最低成本先验证商品图感

默认输出：

- 4 宫格

默认不输出：

- 主图
- SKU 图
- 全套轮播图
- 尺寸图

适用场景：

- 批量商品初筛
- 先看是否值得继续精修
- 先做低成本试图

特点：

- 速度最快
- 成本最低
- 更适合做“试做图”

### 14.2 标准模式

目标：

- 满足常规上架图片需求

默认输出建议：

- 主图
- 4 宫格
- 1 至 2 张轮播图

默认不输出：

- 全套精品图
- 尺寸图（除非手动触发）

适用场景：

- 普通商品常规上架
- 成本和质量平衡

特点：

- 适合作为默认图片策略
- 是日常生产模式

### 14.3 完整模式

目标：

- 生成完整视觉资产包

默认输出建议：

- 主图
- SKU 图
- 4 宫格
- 轮播图
- 尺寸图

适用场景：

- 主推款
- 爆款候选
- 高价值商品

特点：

- 成本最高
- 速度最慢
- 质量潜力最高

### 14.4 图片生成策略的作用

核心作用不是增加一个技术配置项，而是做三层分流：

1. 成本分层
2. 时间分层
3. 质量分层

没有这层策略会出现的问题：

- 所有商品都走重流程，太贵太慢
- 或所有商品都走轻流程，重点品质量不够

所以建议在页面上把它表达成运营策略，而不是技术术语：

- `先试图`
- `常规出图`
- `精品出图`

## 15. 导出校验

`export_validation` 当前先不做 AI 化，优先用前端规则校验落地。

### 15.1 当前建议

先在前端做规则校验：

- 标题为空或过短
- 类目未确认
- 必填导出字段缺失
- 图片未选择最终图
- 尺寸 / 材质 / 数量字段缺失或冲突

### 15.2 当前结论

- 先不纳入本轮后端 AI 改造
- 保留 prompt type 占位
- 后续如果规则校验不够，再考虑补 AI 校验
