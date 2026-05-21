# 点击“生成任务”后台流程说明

本文按当前代码实现说明用户在前端点击“生成任务”后，后台真实做了什么，以及哪些步骤已经改成按需触发。

关联代码入口：

- 路由入口：[apps/api/app/api/routes/product_tasks.py](/Users/city/Desktop/赣州-电商/ai-caiji/apps/api/app/api/routes/product_tasks.py)
- 任务创建与时间线：[apps/api/app/services/product_tasks.py](/Users/city/Desktop/赣州-电商/ai-caiji/apps/api/app/services/product_tasks.py)
- bootstrap 流程：[apps/api/app/services/task_bootstrap.py](/Users/city/Desktop/赣州-电商/ai-caiji/apps/api/app/services/task_bootstrap.py)
- AI 流程：[apps/api/app/services/ai_pipeline.py](/Users/city/Desktop/赣州-电商/ai-caiji/apps/api/app/services/ai_pipeline.py)
- 图片提示词与生图：[apps/api/app/services/image_generation.py](/Users/city/Desktop/赣州-电商/ai-caiji/apps/api/app/services/image_generation.py)
- 导出字段草稿：[apps/api/app/services/export_fields.py](/Users/city/Desktop/赣州-电商/ai-caiji/apps/api/app/services/export_fields.py)
- 设置与可用性检查：[apps/api/app/api/routes/settings.py](/Users/city/Desktop/赣州-电商/ai-caiji/apps/api/app/api/routes/settings.py)

## 1. 总览

点击“生成任务”后，当前后台只做两件事：

1. 创建一条 `product_tasks` 任务记录。
2. 异步执行 bootstrap：
   `AI 商品理解/类目/标题/图片提示词 -> 任务进入待复核`

当前 bootstrap 不会自动做两件历史上做过的事：

- 不会自动生成导出草稿
- 不会自动发起四宫格生图

这两段现在改成按需触发：

- 导出草稿：在导出预览、导出执行，或单任务“应用默认值”时生成
- 图片任务：在图片相关接口或批图入口显式触发

## 2. 第一步：创建任务记录

接口入口：

- `POST /api/raw-products/{raw_product_id}/create-task`
- `POST /api/raw-products/batch/create-tasks`

创建逻辑：

- `create_task_from_raw_product(...)`

从 `raw_products` 复制到 `product_tasks` 的核心字段：

- `raw_product_id`
- `title`
- `source_url`
- `product_platform`
- `source_id`
- `platform_sku`
- `screenshot_url`
- `split_index`
- `split_total`
- `generation_mode`

初始状态：

- `main_status = collected`
- `category_status = pending`
- `title_status = pending`
- `image_prompt_status = pending`
- `image_status = pending`
- `export_status = pending`

## 3. 创建前的 AI 可用性检查

如果 `generation_mode != no_ai`，接口会先检查文本模型是否可用。

检查逻辑：

- `is_openai_configured(session)`

配置优先级当前是：

1. 服务端默认 `text provider`
2. 环境变量 `AI_CAIJI_OPENAI_API_KEY / OPENAI_API_KEY`

也就是说，系统不再只依赖 `.env`。如果数据库里已经配置了默认文本 provider，任务创建和 AI 流程会优先使用那套配置。

可用性接口：

- `GET /api/settings/task-readiness`

总览接口：

- `GET /api/settings/overview`

## 4. 第二步：异步 bootstrap

后台异步入口：

- `run_task_bootstrap_pipeline(session, task_id=...)`

当前真实行为：

1. 如果 `generation_mode = no_ai`，直接把任务推进到 `review_ready`
2. 否则执行 `run_ai_pipeline_for_task(...)`
3. AI 未失败时，把任务主状态推进到 `review_ready`

注意：

- bootstrap 当前不会自动应用默认值规则
- bootstrap 当前不会自动创建图片任务

这和旧文档里的“AI -> 导出草稿 -> 四宫格生成”已经不同。

## 5. AI 流程当前跑哪些步骤

执行函数：

- `run_ai_pipeline_for_task(session, task_id=..., prompt_types=None)`

默认情况下会跑：

1. `product_info_from_screenshot`
2. `category_match`（当前由代码字典召回完成，不再调 AI 选类）
3. `title_package`
4. `image_prompt_package`（仅当 `generation_mode` 允许图片提示词）

统一写入：

- `product_ai_results`

### 5.1 AI 运行前状态切换

进入 AI 阶段时会更新：

- `main_status = ai_running`
- `category_status = running`
- `title_status = running` 或 `pending`
- `image_prompt_status = running` 或 `pending`

同时会把本次解析出来的运行时配置记录进：

- `product_ai_results.prompt_snapshot._runtime`

这里会留下：

- `provider_source`
- `provider_id`
- `provider_name`
- `provider_display_name`
- `model`
- `resolved_at`

方便后续排查这条任务到底用了哪套 provider。

## 6. 第 1 步：`product_info_from_screenshot`

这一步的输入已经对齐到当前模板变量，核心包括：

- `title`
- `category_path`
- `attributes_text`
- `sku_text`
- `platform`
- `source_url`
- `screenshot_notes`

兼容旧模板的别名也仍然会传：

- `raw_title`
- `raw_category_path`
- `main_image`
- `main_images`
- `carousel_images`
- `detail_images`
- `screenshot_url`
- `raw_payload`

产出结构化商品理解：

- `source_visible`
- `product_core`
- `category_search`
- `temu_category_search`
- `title_basis`
- `image_basis`
- `dimension_basis`
- `evidence_notes`

结果写入：

- `product_ai_results.product_info`

## 7. 第 2 步：`category_match`

当前类目处理不是再让 LLM 从候选里选，而是代码召回并直接落结果。

召回来源：

- `temu_category_search.raw_category_path_cn`
- `search_priority`
- `core_leaf_terms_cn / en`
- `category_terms_cn / en`
- `parent_terms_cn`
- `exclude_terms_cn`

召回逻辑：

- `recall_category_candidates_multi(...)`

改动后的特点：

- 会使用 `exclude_terms` 降权
- 会按整词、叶子词、路径命中做更细的评分
- 会保留 `matched_terms`

结果写入：

- `product_tasks.category_candidates_json`
- `product_ai_results.category_match`

当前 `category_match.output` 关键字段：

- `best_path`
- `selected_category`
- `confidence`
- `top3`
- `candidates`

如果任务还没有人工选类目，系统会自动把第一候选写入：

- `task.selected_category_id`

状态规则：

- 候选不足或分数偏低时：`category_status = low_confidence`
- 否则：`category_status = success`

## 8. 第 3 步：`title_package`

当前标题链路已经收敛成一个统一产物，不再以旧文档里的 `title_cn` 和 `title_en_with_cn_translation` 为主链路。

输入：

- `raw_title`
- `title`
- `selected_category_path`
- `category_path`
- `product_info`
- `attributes_text`
- `sku_text`

产出：

- `title_cn`
- `title_en`
- `title_cn_translation`
- `title_en_short`
- `core_product_words`
- `selling_points`
- `used_basis_fields`
- `avoid_claims`

结果写入：

- `product_ai_results.title_package`

为了兼容旧读取逻辑，代码还会同步：

- `product_ai_results.title_cn = title_package`
- `product_ai_results.title_en = title_package`

任务联动更新：

- `title_status = success`
- `task.title = title_package.title_cn`（有值时）

## 9. 第 4 步：`image_prompt_package`

仅当任务模式允许图片提示词时执行。

输入：

- `raw_title`
- `title`
- `selected_category_path`
- `category_path`
- `product_info`
- `title_package`
- `title_en_with_cn_translation`
- `reference_images`

产出的是整包图片提示词，而不是单条字符串：

- `carousel_4grid`
- `carousel_1`
- `carousel_2`
- `carousel_3`
- `carousel_4`
- `size_chart`

每个槽位当前都可能包含：

- `prompt`
- `negative_prompt`
- `basis_fields`
- `role`
- `panel_plan`
- `dimension_labels`
- `requires_manual_dimension`

结果写入：

- `product_ai_results.image_prompt_package`

任务联动更新：

- `image_prompt_status = ready`

## 10. 局部重跑现在的依赖补齐规则

`run_ai_pipeline_for_task(...)` 现在支持只跑部分 prompt type，但会自动补上缺失的上游依赖。

当前依赖展开规则：

- 重跑 `title_package` 时，如果缺少 `product_info`，会先补跑 `product_info`
- 重跑 `image_prompt_package` 或任一图片提示词时，如果缺少 `title_package`，会先补跑 `title_package`
- 重跑 `image_prompt_package` 时，如果缺少 `product_info`，也会继续向上补跑 `product_info`

别名也已经统一到同一个依赖图：

- `image_prompt_main`
- `image_prompt_preview_1`
- `image_prompt_preview_2`
- `image_prompt_preview_3`
- `image_prompt_dimension`

都会归并到 `image_prompt_package`

这意味着前端只点“重生成标题”或“重生成图片提示词”，系统也能自动补齐上游，而不是因为中间产物缺失直接失败。

## 11. AI 流程结束后的状态

AI 成功后，`run_ai_pipeline_for_task(...)` 会先把任务推进到：

- `main_status = prompts_ready`

随后 bootstrap 会把未失败任务进一步推进到：

- `main_status = review_ready`

如果 `generation_mode = title_only`：

- `image_prompt_status = pending`
- `main_status` 仍会先写成 `prompts_ready`

失败时：

- `main_status = failed`
- `category_status = failed`
- `title_status = failed`
- `image_prompt_status = failed`

异常会记录为：

- `ai_pipeline_failed`

## 12. 图片提示词解析和按需补上游

图片接口在解析最终 prompt 前，会先调用：

- `_ensure_prompt_upstream_outputs(...)`

也就是说，即使这条任务之前没完整跑过 AI，只要你现在去：

- 重生成主图提示词
- 重生成四宫格提示词
- 重生成尺寸图提示词

系统也会先补齐缺失的：

- `product_info`
- `title_package`

之后再渲染实际 prompt。

相关代码：

- [apps/api/app/services/image_generation.py](/Users/city/Desktop/赣州-电商/ai-caiji/apps/api/app/services/image_generation.py)

## 13. 导出字段草稿什么时候生成

当前不是在“生成任务”时自动生成。

会触发 `apply_default_rules(...)` 的典型入口：

- `POST /api/product-tasks/{id}/apply-default-rules`
- `GET /api/product-tasks/{id}/export-fields/preview`
- `POST /api/exports/preview`
- `POST /api/exports/run`

基础字段来源已经更新为优先读取当前链路产物：

- 类目优先 `category_match.output.best_path / selected_category`
- 标题优先 `title_package.title_cn / title_en`

规则匹配当前也支持：

- `category_id`
- `category_path_contains`

并且会同时兼容：

- `selected_category_id`
- `category_path`

## 14. 图片生成什么时候发起

当前也不是在“生成任务”时自动发起。

相关入口：

- `POST /api/product-tasks/{id}/generate-images`
- `POST /api/product-tasks/{id}/generate-image`
- 批量图片操作入口

在真正创建 `image_generation_jobs` 之前，系统会先：

1. 解析图片 provider
2. 解析 prompt template
3. 自动补齐缺失的上游 AI 结果
4. 生成 `prompt_snapshot` 与 `final_prompt`

再由：

- `create_job(...)`
- `run_job(...)`

执行真实生图。

## 15. 任务日志和排查入口

现在“任务日志”已经前移到主导航，路由是：

- `/logs`

这个页面本质上复用了商品任务页，但默认更偏排查模式：

- 默认切到日志/卡片视图
- 支持 `exception=true`
- 支持 `low_confidence=true`

对应接口：

- `GET /api/product-tasks`
- `GET /api/product-tasks/{id}/timeline`

时间线主要从这些地方组装：

- `product_tasks` 状态字段
- `product_ai_results` 各步骤快照
- 异常字段
- 导出草稿状态
- 图片任务状态

## 16. 异常写在哪里

任务异常统一记录在 `product_tasks`：

- `exception_status`
- `exception_level`
- `last_error_message`
- `exception_reasons_json`
- `exception_updated_at`

常见异常码：

- `ai_pipeline_failed`
- `bootstrap_failed`
- `image_provider_missing`
- `image_generation_failed`

## 17. 一条任务常见会落到哪些表

- `raw_products`
- `product_tasks`
- `product_ai_results`
- `export_field_drafts`
- `image_generation_jobs`
- `product_assets`

但要注意：

- `export_field_drafts` 只有触发导出草稿相关入口后才会生成
- `image_generation_jobs / product_assets` 只有触发生图入口后才会生成

## 18. 简化版链路图

```text
前端点击生成任务
  -> POST /api/raw-products/{raw_product_id}/create-task
  -> 创建 product_task
  -> 后台 run_task_bootstrap_pipeline(task_id)
     -> run_ai_pipeline_for_task
        -> product_info_from_screenshot
        -> category_match(代码召回)
        -> title_package
        -> image_prompt_package(按模式决定)
        -> 写 product_ai_results
        -> 更新 task: prompts_ready
     -> 更新 task: review_ready

后续按需动作
  -> 导出预览 / 导出执行
     -> apply_default_rules
     -> 写 export_field_drafts
  -> 发起图片生成
     -> resolve_image_prompt
     -> 自动补 product_info/title_package
     -> create_job / run_job
     -> 写 image_generation_jobs / product_assets
```

## 19. 当前优先排查顺序

如果“生成任务”结果不对，优先看：

1. `GET /api/settings/task-readiness` 是否通过
2. `product_tasks.main_status` 是否进入 `ai_running / prompts_ready / review_ready`
3. `product_ai_results.product_info / category_match / title_package / image_prompt_package` 是否真实落库
4. `product_ai_results.prompt_snapshot._runtime` 用的是哪套 provider
5. `category_status` 是否为 `low_confidence`
6. `exception_reasons_json / last_error_message` 里记录了什么
7. 如果是导出问题，再看 `export_field_drafts`
8. 如果是图片问题，再看 `image_generation_jobs / product_assets`
