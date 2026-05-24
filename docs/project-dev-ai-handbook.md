# AI 跨境上架工作台（重梳理版 / 可交接）

> 本文是“代码对齐文档”，只讲当前仓库真实实现。用于开发者和 AI 代理快速接手、联调、排障、扩展。

---

## 0. 你先记住这 5 件事

1. 主链路是：`插件采集 -> raw_products -> product_tasks -> AI/图片 -> export fields -> exports`。  
2. `generation_mode` 决定任务创建后后台做多少事，不同模式流程不同。详见 `docs/generation-mode-flow.md`。  
3. 类目当前不是纯 LLM 分类，而是 **代码字典召回**（`temu_category_review_dict.json`）。  
4. 图片提示词包当前是 **动态上下文构建（code）**，不是再调一次 LLM。  
5. 上架加工工作台（`/product-tasks`）是总控台，几乎覆盖全部操作与排障。

### 优先阅读顺序（AI 续接专用）

1. `README.md`
2. `AGENTS.md`
3. `docs/generation-mode-flow.md` ← 三种生成模式与完整流程
4. `docs/generate-task-backend-flow.md`
5. `apps/api/app/main.py`
6. `apps/api/app/services/`
7. `apps/web/src/app/product-tasks/page.tsx`
8. `apps/web/src/app/raw-products/page.tsx`
9. `chrome-extension/content.js`

---

## 1. 端到端业务流（逐步到函数）

## 1.1 插件采集并入库

- 插件入口：`chrome-extension/popup.js` `collectAndSync()`  
- 页面抓取：`chrome-extension/content.js` `collectProductAsync()`  
- 平台细节：`chrome-extension/platform-collectors.js`  
- 截图：`background.js` `CAPTURE_VISIBLE_TAB` + `/sync/screenshot`  
- 入库：`POST /api/raw-products` -> `routes/raw_products.py` -> `services/raw_products.py:create_raw_product`

关键处理：
- 识别平台（Temu/1688/Amazon/淘宝/天猫/拼多多/SHEIN）。  
- 抓标题、价格、图片（主图/轮播/SKU/详情/尺寸候选）、视频、店铺、属性、SKU 文本。  
- Temu/1688 有脚本 URL 回退、UI 图片过滤、细分规则。  
- 上传截图前隐藏插件面板，避免截图污染。

## 1.2 raw -> task 创建

- 单条：`POST /api/raw-products/{id}/create-task`  
- 批量：`POST /api/raw-products/batch/create-tasks`

函数链：
- `routes/raw_products.py` / `routes/product_tasks.py`  
- `services/product_tasks.py:create_task_from_raw_product`  
- `background.add_task(_bg_bootstrap)` -> `services/task_bootstrap.py:run_task_bootstrap_pipeline`

## 1.3 bootstrap 后台流程

`task_bootstrap.run_task_bootstrap_pipeline()`：
1. `task_only/no_ai`：直接 `review_ready`。  
2. 其它模式：跑 `ai_pipeline.run_ai_pipeline_for_task()`。  
3. 成功后若模式需要：`image_generation.auto_generate_and_crop_4grid_for_task()` 自动四宫格。

## 1.4 AI 主流程

`services/ai_pipeline.py:run_ai_pipeline_for_task()`

执行顺序（按依赖和模式决定）：
1. `product_info_from_screenshot`（商品理解）  
2. `title_package` 或 `title_package_lite`（标题包）  
3. `category_match`（代码召回）  
4. `image_prompt_package`（动态图片上下文）

失败处理：
- 设置 `main_status=failed`，记录 `ai_pipeline_failed` 异常到 `product_tasks.exception_*`。

## 1.5 图片生成与资产

核心函数：
- `services/image_generation.py:create_job`  
- `services/image_generation.py:run_job`  
- `services/image_generation.py:auto_generate_and_crop_4grid_for_task`

资产操作 API：
- 生成：`/generate-images`、`/generate-image`、`/generate-selling-images`、`/generate-sku-image`、`/generate-size-image`  
- 资产：`/assets`、`/assets/{id}/set-final`、`/assets/{id}/regenerate`  
- 槽位：`/assign-image`、`/remove-slot-image`、`/reorder-slots`  
- 尺寸提取：`/dimension-extract`

## 1.6 导出链路

- 草稿：`GET /export-fields/preview`、`POST /apply-default-rules`、`PATCH /export-fields`、`PATCH /export-fields/choose`  
- 执行：`POST /api/exports/preview`、`POST /api/exports/run`  
- 历史：`GET /api/exports/history`、`GET /api/exports/{batch_id}/download`

函数链：
- `services/export_fields.py`：候选拼装 + 规则应用 + 字段来源管理。  
- `services/export_runner.py`：模板校验、行构建、媒体字段处理、Excel 写出。

---

## 2. 数据模型字段注释（高频排障字段）

## 2.1 `raw_products`（采集层）

文件：`apps/api/app/models/raw_product.py`

- `platform`：采集站点。  
- `url`：商品详情页 URL。  
- `title`：原始标题。  
- `price/original_price/currency`：价格信息。  
- `source_id/platform_sku`：来源唯一标识（平台侧）。  
- `category_path`：原页面类目路径。  
- `attributes_text/sku_text/stock`：原页面文本证据。  
- `collector`：采集人。  
- `main_image/screenshot_url/video_url`：主视觉与截图、视频。  
- `main_images/carousel_images/sku_images/detail_images/size_chart_images`：图片分组池。  
- `debug_payload`：采集调试信息。  
- `raw_payload`：原始提交 payload，排障关键。

## 2.2 `product_tasks`（任务层）

文件：`apps/api/app/models/product_task.py`

- `raw_product_id`：映射回采集数据。  
- `title`：任务标题（会被 AI 标题更新）。  
- `split_index/split_total`：拆分任务序号。  
- `generation_mode`：流程模式。  
- `main_status`：主阶段。  
- `category_status/title_status/image_prompt_status/image_status/export_status`：分阶段状态。  
- `selected_category_id`：最终选类结果。  
- `category_candidates_json`：候选类目及分数。  
- `exception_status/exception_level/exception_reasons_json/last_error_message`：异常池。  
- `retry_count`：重试次数。

## 2.3 `product_ai_results`（AI 结果层）

文件：`apps/api/app/models/product_ai_result.py`

- `prompt_snapshot`：模板解析快照（模板 id/scope/version/渲染文本）。  
- `product_info`：商品理解结果 JSON。  
- `category_match`：类目候选结果 JSON。  
- `title_package`：中英文标题包。  
- `image_prompt_package`：图片动态上下文包。  
- `title_en`：兼容性字段（很多场景镜像 title_package）。

---

## 3. 状态机与模式（精确说明）

## 3.1 主状态 `TaskMainStatus`

`draft/collected/normalized/ai_running/ai_ready/prompts_ready/image_running/review_ready/export_ready/exported/failed`

当前常见实际路径：
- 建任务后：`collected`  
- AI 执行：`ai_running` -> `prompts_ready`  
- 自动/手动生图：`image_running` -> `review_ready`  
- 导出完成：`exported`  
- 任一步失败：`failed`

## 3.2 模式 `GenerationMode`（真实影响）

- `task_only` / `no_ai`：
  - 不要求文本模型可用。  
  - bootstrap 直接 `review_ready`。

- `title_only`：
  - 跑 `product_info + title_package_lite + category recall`。  
  - 不自动触发四宫格。  
  - AI 完成通常停 `prompts_ready`（后续人工操作）。

- `title_and_4grid`：
  - 跑 `product_info + title_package + category recall + image_prompt_context`。  
  - bootstrap 尝试自动四宫格生成。  
  - 对图片 provider 有依赖。

- `title_and_image_prompts` / `full_later`：
  - 兼容旧模式，bootstrap 当前按需要四宫格的路径走。

---

## 4. AI 处理细节（字段如何被加工）

## 4.1 商品理解 `product_info`

输入源：
- raw 标题、类目、属性文本、SKU 文本、平台、URL、截图与图片摘要。

输出加工：
- 标准化结构 `ProductInfoOutput`。  
- 自动补齐 `product_core_v2`、`visual_facts`、`category_basis`、`image_generation_basis`。  
- 作为标题、类目、图片上下文的共同上游。

## 4.2 标题包 `title_package` / `title_package_lite`

输入：
- raw 标题 + 类目信息 + `product_info` + 属性/SKU 文本。

输出：
- `title_cn/title_en/title_cn_translation`  
- `core_product_words/selling_points`  
- `category_search_keywords/suggested_category_search_query`

处理规则：
- 注入 title quality guardrail，降低标题漂移和虚构风险。

## 4.3 类目召回 `category_match`

来源：
- `title_package` 关键词 + `product_info` 词 + raw 类目路径。

处理：
- `category_dictionary.recall_category_candidates_multi()` 打分召回。  
- 候选写入 `task.category_candidates_json`。  
- 第一候选可自动写入 `selected_category_id`。  
- 低分或候选不足 -> `category_status=low_confidence`。

## 4.4 图片提示词包 `image_prompt_package`

当前实现：
- 代码生成动态上下文，不额外调 LLM。  
- 生成 `shared_context`（类目、标题包、产品信息、参考图）。  
- 生成 `slot_contexts`（4宫格、轮播1~4、尺寸图等）。

---

## 5. 上架加工工作台（`/product-tasks`）深度说明

文件：`apps/web/src/app/product-tasks/page.tsx`

## 5.1 页面是“总控台”

它不是单一列表页，而是四层能力叠加：
1. 列表筛选与批量编排。  
2. 抽屉聚合（task+raw+assets+export_draft+timeline）。  
3. AI 与类目/标题纠偏。  
4. 图片资产和导出字段联动。

## 5.2 列表层调用矩阵

- 拉列表：`GET /api/product-tasks`  
- 拉时间线：`GET /api/product-tasks/{id}/timeline`  
- 拉聚合详情：`GET /api/product-tasks/{id}/workbench-detail`

批量动作：
- 跑 AI：`POST /run-ai`（逐任务）  
- 生成标题：`POST /generate-title-en-only`  
- 生成四宫格：`POST /generate-images`  
- 导出预校验：`POST /api/exports/preview`  
- 执行导出：`POST /api/exports/run`  
- 删除任务：`DELETE /api/product-tasks/{id}`

## 5.3 抽屉内 Tab（真实功能）

- `Info`：
  - 运行商品理解 `POST /run-product-info`  
  - 重生标题 `POST /generate-title-en-only`  
  - 选类目 `POST /select-category`  
  - 字段来源选择 `PATCH /field-choice`

- `Images`：
  - 4宫格/单图/SKU/尺寸/卖点图生成  
  - 设最终图、重生成  
  - 槽位分配、上传替换、拖拽换位、删除

- `ExportFields`：
  - 预览草稿 `GET /export-fields/preview`  
  - 应用默认规则 `POST /apply-default-rules`  
  - 保存手工字段 `PATCH /export-fields`  
  - 选择字段来源 `PATCH /export-fields/choose`

- `Trace`：
  - 展示 AI 分步骤事件、prompt/model/usage/cost/error。

- `RawData`：
  - 原始字段与图片证据核对。

---

## 6. 插件流程（逐消息）

## 6.1 popup -> content 消息

- `COLLECT_PRODUCT`：触发采集。  
- `PSYNC_PREPARE_SHOT`：截图前隐藏 panel。  
- `PSYNC_FINISH_SHOT`：截图后恢复 panel。

## 6.2 popup -> background 消息

- `CAPTURE_VISIBLE_TAB`：可见区域截图。  
- `FETCH_TEXT`：跨域拉文本（某些平台辅助）。  
- `DOWNLOAD_IMAGES`：下载所选图片到本地目录。

## 6.3 popup -> backend

- `GET /health`：服务可用性探测。  
- `POST /sync/screenshot`：截图上传。  
- `POST /api/raw-products`：最终入库。

## 6.4 插件分组纠错

popup 内本地维护：
- `buckets.main/sku/detail/size`  
- `syncSelected`（哪些图参与提交）  
- 支持归类模式、跨组移动、下载选中。

---

## 7. 页面-接口矩阵（前端）

- `raw-products`：
  - `/api/raw-products`（列表/详情/更新/删除）  
  - `/sync/screenshot`  
  - `/api/raw-products/{id}/create-task`  
  - `/api/settings/task-readiness`

- `product-tasks`：
  - `/api/product-tasks*`（列表、详情、timeline、workbench）  
  - `/api/categories/search`  
  - `/api/product-tasks/{id}/run-ai`、`/run-product-info`、`/generate-title-en-only`、`/generate-images` 等  
  - `/api/assets/*`、`/api/jobs/*`  
  - `/api/product-tasks/{id}/export-fields*`、`/apply-default-rules`  
  - `/api/exports/preview`、`/api/exports/run`

- `prompts`：
  - `/api/system/prompt-types`、`/api/system/prompt-variables`  
  - `/api/prompt-templates*`、`/api/prompt-templates/render`

- `rules`：
  - `/api/default-rules*`、`/test-apply`

- `exports`：
  - `/api/export-templates`、`/api/export-field-mappings*`  
  - `/api/exports/history`、`/api/exports/run`、`/api/exports/preview`  
  - `/api/exports/ai-imports*`

- `settings`：
  - `/api/settings/overview`、`/api/system/health`  
  - `/api/provider-configs*`、`/api/cost-configs`  
  - `/api/ai/test-openai-compatible`

---

## 8. 排障优先顺序（实战）

1. 先看 `product_tasks`：`main_status`、`category_status`、`title_status`、`image_prompt_status`、`image_status`、`exception_*`。  
2. 再看 `product_ai_results`：各步骤 `input/output/error/prompt/model`。  
3. 图片问题看 `image_generation_jobs` + `product_assets`。  
4. 导出问题看 `export_field_draft` + `export_field_mappings` + `export_batches/export_records`。  
5. 插件问题先复现并看 `raw_payload/debug_payload`。

---

## 9. 现阶段风险点（代码层）

1. 插件 DOM 依赖高，平台改版会导致采集降级。  
2. 生产环境若仍用 stub 图片 provider，会影响真实交付。  
3. 导出强依赖模板字段与映射一致性。  
4. AI 向导（`/settings/ai`）是本地存储方案，和后端 provider 配置是两套体系。  
5. 类目召回质量受词典和关键词构造质量影响明显。

---

## 10. 继续深化建议（你下一步可以让 AI 直接干）

1. 输出”DB 字段血缘表”：每个导出字段来自 raw/ai/manual 哪个路径。  
2. 输出”接口契约清单”：每个 API 的请求体和错误码。  
3. 输出”模式回归用例”：`task_only/title_only/title_and_4grid` 三套最小可复现数据。  
4. 输出”插件采集回归脚本”：按平台抽样验证采集字段完整性。  
5. 补充”生成模式流程”专项文档 → `docs/generation-mode-flow.md`（已写入）。


---

## 11. 接口契约总表（合并在同一份文档）

> 这一节把“项目梳理 + 接口手册”合并在同一文件里，便于一份文档直接交接。

### 11.1 采集与原始商品

- `POST /sync/screenshot`
  - 入参：`{ productId, dataUrl }`
  - 出参：`{ ok, url }`
- `POST /api/raw-products`
  - 入参：`RawProductCreate`（平台、标题、价格、图片分组、截图、视频、调试字段）
  - 出参：`RawProductDetail`
- `GET /api/raw-products`
  - 查询：`limit, offset`
  - 出参：`RawProductListResponse`
- `GET /api/raw-products/{product_id}`
  - 出参：`RawProductDetail`
- `PATCH /api/raw-products/{product_id}`
  - 入参：`RawProductUpdate`
  - 出参：`RawProductDetail`
- `DELETE /api/raw-products/{product_id}`
- `POST /api/raw-products/batch/create-tasks`
  - 入参：`{ raw_product_ids, split_count, generation_mode }`
- `POST /api/raw-products/batch/delete`
  - 入参：`{ raw_product_ids }`

### 11.2 商品任务

- `POST /api/raw-products/{raw_product_id}/create-task`
  - 入参：`{ split_count, generation_mode }`
  - 出参：`ProductTaskCreateResponse`
- `GET /api/product-tasks`
  - 查询：`status, category_status, image_status, export_status, exception, low_confidence, keyword, limit, offset`
  - 出参：`ProductTaskListResponse`
- `GET /api/product-tasks/{task_id}`
  - 出参：`ProductTaskDetail`
- `GET /api/product-tasks/{task_id}/timeline`
  - 出参：`ProductTaskTimelineResponse`
- `GET /api/product-tasks/{task_id}/workbench-detail`
  - 出参：`{ task, raw, assets, export_draft }`
- `PATCH /api/product-tasks/{task_id}`
  - 入参：`ProductTaskUpdate`
- `DELETE /api/product-tasks/{task_id}`

### 11.3 AI 与类目/标题

- `POST /api/product-tasks/{task_id}/run-product-info`
- `POST /api/product-tasks/{task_id}/run-ai`
  - 入参可带 `prompt_types`
- `POST /api/product-tasks/{task_id}/generate-titles`
- `POST /api/product-tasks/{task_id}/generate-title-en-only`
- `GET /api/categories/search`
  - 查询：`query, limit`
- `POST /api/product-tasks/{task_id}/select-category`
  - 入参：`{ path }`
- `PATCH /api/product-tasks/{task_id}/field-choice`
  - 入参：字段来源选择（`raw/ai/manual`）

### 11.4 图片与资产

- `POST /api/product-tasks/{task_id}/generate-images`
- `POST /api/product-tasks/{task_id}/generate-image`
- `POST /api/product-tasks/{task_id}/generate-selling-images`
- `POST /api/product-tasks/{task_id}/generate-sku-image`
- `POST /api/product-tasks/{task_id}/generate-size-image`
- `GET /api/jobs/{job_id}`
- `GET /api/product-tasks/{task_id}/assets`
- `POST /api/assets/{asset_id}/set-final`
- `POST /api/assets/{asset_id}/regenerate`
- `POST /api/product-tasks/{task_id}/dimension-extract`
- `POST /api/product-tasks/{task_id}/assign-image`
- `POST /api/product-tasks/{task_id}/remove-slot-image`
- `POST /api/product-tasks/{task_id}/reorder-slots`
- `POST /api/assets/{asset_id}/add-to-batch-edit`
- `GET /api/batch-edit-queue`

### 11.5 默认规则与导出字段

- `GET /api/default-rules`
- `POST /api/default-rules`
- `GET /api/default-rules/{rule_id}`
- `PATCH /api/default-rules/{rule_id}`
- `DELETE /api/default-rules/{rule_id}`
- `POST /api/default-rules/{rule_id}/test-apply`

- `GET /api/product-tasks/{task_id}/export-fields/preview`
- `POST /api/product-tasks/{task_id}/apply-default-rules`
- `PATCH /api/product-tasks/{task_id}/export-fields`
- `PATCH /api/product-tasks/{task_id}/export-fields/choose`

### 11.6 模板、映射、导出批次

- `GET /api/export-templates`
- `POST /api/export-templates`
- `GET /api/export-templates/{template_id}`
- `PATCH /api/export-templates/{template_id}`
- `POST /api/export-templates/{template_id}/set-default`
- `GET /api/export-templates/{template_id}/fields`
- `GET /api/export-template/fields`

- `GET /api/export-field-mappings?template_id=...`
- `PATCH /api/export-field-mappings/{mapping_id}`
- `POST /api/export-field-mappings/batch-update`

- `POST /api/exports/preview`
- `POST /api/exports/run`
- `GET /api/exports/history`
- `GET /api/exports/{batch_id}/download`

### 11.7 AI 导入、配置与健康

- `POST /api/exports/ai-imports/upload-template`
- `POST /api/exports/ai-imports/parse`
- `GET /api/exports/ai-imports`
- `GET /api/exports/ai-imports/{batch_id}`
- `PATCH /api/exports/ai-imports/{batch_id}/draft`
- `POST /api/exports/ai-imports/{batch_id}/export`

- `GET /api/provider-configs`
- `POST /api/provider-configs`
- `PATCH /api/provider-configs/{provider_id}`
- `POST /api/provider-configs/{provider_id}/set-default`
- `GET /api/image-providers`
- `GET /api/image-providers/default`

- `GET /api/settings/overview`
- `GET /api/settings/task-readiness`
- `POST /api/ai/test-openai-compatible`
- `GET /api/system/health`
- `GET /health`
- `GET /api/cost-configs`
- `PATCH /api/cost-configs`

### 11.8 常见错误码（联调重点）

- `404`：资源不存在（raw/task/template/rule/asset）。
- `409`：AI Key 未配置但调用了需要 AI 的模式。
- `400`：参数不合法（如批量 ids 为空、JSON 结构错误）。
- `500`：Provider 调用失败、模板解析失败、导出运行期异常。


---

## 16. AI 外部导入（外部 JSON → Excel 模板）

> 来源：`apps/api/app/services/ai_imports.py`

### 16.1 业务流程（完整五步）

```
1. 上传模板  →  2. 解析外部 AI JSON  →  3. 校验与预览  →  4. 修正草稿  →  5. 回写导出 Excel
POST         POST parse              PATCH draft        POST export
```

相关 API（`routes/ai_imports.py`）：

| 步骤 | 接口 | 作用 |
|------|------|------|
| 上传模板 | `POST /api/exports/ai-imports/upload-template` | 保存原始 Temu Excel 模板文件至 `storage/imports/templates/` |
| 解析 JSON | `POST /api/exports/ai-imports/parse` | 接收外部 AI 输出的 JSON（包含 `common_fields`、`headers`、`rows`），解析并校验 |
| 查看草稿 | `GET /api/exports/ai-imports/{batch_id}` | 返回解析后的 headers/rows/common_fields + 校验警告 |
| 修正草稿 | `PATCH /api/exports/ai-imports/{batch_id}/draft` | 前端修改 headers/rows/common_fields 后提交重新校验 |
| 执行导出 | `POST /api/exports/ai-imports/{batch_id}/export` | 将数据回写到 Excel 模板并输出文件 |

### 16.2 JSON 输入格式约定

外部 AI 需要输出如下结构：

```json
{
  "sheet_name": "Sheet1",
  "common_fields": { "lei_mu_id": "50012234", "chan_di": "广东" },
  "headers": ["zhu_bian_hao", "chan_pin_biao_ti", "ying_wen_biao_ti", ...],
  "rows": [
    { "zhu_bian_hao": "A001", "chan_pin_biao_ti": "产品A", "ying_wen_biao_ti": "Product A", ... },
    { ... }
  ],
  "warnings": []
}
```

- `headers` 唯一、非空；`rows` 每项为对象
- 外部 JSON 可包含 `headers` 以外的额外字段，系统保留并发出警告
- `common_fields` 为跨行统一字段（如类目ID、产地），写入模板固定单元格

### 16.3 校验规则（`_validate_headers_rows`）

- `headers` / `rows` 不能为空
- `headers` 内部不允许重复
- 若 `rows` 中出现 `headers` 之外的字段 → warning，不丢弃
- 若任何行全部字段为空 → warning
- 若含图片/视频字段（名含"图"/"图片"/"视频"/"预览图"/"轮播图"）→ warning 建议留空（后续由系统资产填充）

### 16.4 Excel 回写逻辑（`_write_ai_import_excel`）

1. **加载原始模板**：按 `sheet_name` 找 sheet，找不到则用第一个
2. **定位表头行**：扫描前30行，匹配率最高的行作为表头行
3. **补充新列**：模板中没有的 `headers` 字段追加到表头行右侧
4. **写入通用字段**：扫描前20行固定区域，匹配 key 后写入右侧单元格；未匹配到的追加到表头行下方
5. **写入数据行**：每行从表头下一行开始，按列匹配写入

导出文件路径：`storage/exports/ai-import-export-{batch_id}-{uuid8}.xlsx`

### 16.5 数据模型（AiImportBatch / AiImportDraft）

| 模型 | 存储内容 |
|------|----------|
| `AiImportBatch` | `raw_json_text`（原始JSON）、`parsed_headers_json`（规范化表头）、`parsed_rows_json`（规范化数据）、`parsed_common_fields_json`、`validation_result_json`、`status`（`uploaded`→`parsed`→`confirmed`→`exported`）、`export_file_path` |
| `AiImportDraft` | `field_settings_json`（每个字段的 `export` 开关、`field_type`、`is_media_field`）、`headers_json`、`rows_json`、`common_fields_json`、`validation_result_json` |

---

## 17. 费用追踪系统

> 来源：`apps/api/app/models/cost_config.py`、`apps/api/app/models/cost_record.py`、`apps/api/app/services/costing.py`、`apps/api/app/services/cost_configs.py`、`apps/api/app/core/defaults.py`

### 17.1 默认限额（`core/defaults.py`）

```python
DEFAULT_LIMITS = {
    "daily_image_generation_limit": 200,      # 每日出图总量上限
    "task_regeneration_limit": 20,            # 单任务重生成上限
    "slot_regeneration_limit": 8,             # 单槽位重生成上限
    "provider_daily_image_generation_limit": 200,  # 提供商每日限额
}
```

### 17.2 费用配置（CostConfig）

数据库表 `cost_configs`，key-value 结构：

```json
{
  "limits": { ...DEFAULT_LIMITS },
  "daily_budget": null,   // 每日预算上限（null=不限制）
  "currency": "USD"
}
```

API：`GET /api/cost-configs` / `PATCH /api/cost-configs`

### 17.3 费用记录（CostRecord）

数据库表 `cost_records`，每次图片生成操作都会记录：

- `product_task_id`：关联任务
- `job_id`：关联图片任务
- `provider`：提供商名称
- `model_name`：模型名
- `job_type`：任务类型（`single_slot` / `carousel_4grid`）
- `estimated_cost`：预估费用
- `actual_cost`：实际费用
- `currency`：币种（默认 USD）

**计费说明**：`carousel_4grid` 计为 1 次 API 调用但生成 5 张图（1 张父图 + 4 张裁切图）。

### 17.4 费用预估 API

`POST /api/product-tasks/batch/estimate-image-cost`

入参：

```json
{
  "product_task_ids": [1, 2, 3],
  "job_type": "single_slot",     // 或 "carousel_4grid"
  "slots": ["carousel_1"],       // job_type=single_slot 时指定槽位列表
  "provider_config_id": null     // null=用默认图片 provider
}
```

返回：

```json
{
  "ok": true,
  "calls": 3,                    // 预估 API 调用次数
  "estimate": {
    "provider": "stub",
    "unit_cost": 0.0,
    "estimated_cost": 0.0,
    "currency": "USD"
  }
}
```

---

## 18. 批量操作与队列

### 18.1 批量重试失败图片（`POST /api/product-tasks/batch/retry-failed`）

入参：

```json
{
  "product_task_ids": [1, 2, 3],
  "retry_image_jobs": true
}
```

逻辑：
- 查询每个任务的 `failed` 状态图片任务（`ImageGenerationJob.status == "failed"`）
- 每任务最多重试最近 3 个失败任务
- 跳过"在该失败任务之后已有成功任务"的重复任务
- 异步后台执行重试

返回：

```json
{
  "ok": true,
  "queued_job_ids": [101, 102, 103],
  "count": 3
}
```

### 18.2 批量编辑队列（BatchEditQueue）

来源：`apps/api/app/models/batch_edit_queue.py`

表 `batch_edit_queue`，存储异步图片资产编辑任务：

| 字段 | 含义 |
|------|------|
| `product_task_id` | 关联任务 |
| `asset_id` | 关联图片资产 |
| `slot` | 槽位（如 `carousel_1`） |
| `operation_type` | 操作类型（字符串，如 `crop`/`resize`/`filter`） |
| `status` | 状态（`queued` / `processing` / `done` / `failed`） |
| `payload_json` | 操作参数字典 |

API：

- `POST /api/assets/{asset_id}/add-to-batch-edit` — 添加资产到队列
- `GET /api/batch-edit-queue` — 查询队列，支持 `?status=queued` 过滤

### 18.3 任务异常重新计算（`POST /api/product-tasks/{task_id}/recalculate-exceptions`）

来源：`apps/api/app/services/exceptions.py`

根据当前任务状态重新计算 `exception_level` 与 `exception_reasons_json`，返回：

```json
{
  "ok": true,
  "task_id": 1,
  "exception_level": null,
  "reasons": []
}
```

---

## 19. 工作台统计与系统健康

### 19.1 工作台统计数据（`GET /api/dashboard/stats`）

来源：`apps/api/app/api/routes/dashboard.py`

返回：

```json
{
  "ok": true,
  "today": "2026-05-23",
  "today_collected_raw_products": 42,
  "pending_ai_tasks": 15,
  "pending_image_tasks": 8,
  "exception_tasks": 3,
  "export_ready_tasks": 120,
  "export_failed_tasks": 2,
  "today_estimated_cost": 0.0
}
```

所有计数基于今日（UTC）统计，`estimated_cost` 来自 `cost_records` 表。

### 19.2 系统健康检查（`GET /api/system/health`）

来源：`apps/api/app/api/routes/system_health.py`

返回：

```json
{
  "ok": true,
  "api": { "ok": true },
  "db": { "ok": true, "error": null },
  "redis": { "ok": null, "note": "not configured" },
  "worker": { "ok": null, "note": "BackgroundTasks (no separate worker)" },
  "storage": { "ok": true, "root": "/path/to/storage" },
  "defaults": {
    "image_provider": { "id": 2, "provider_name": "stub", "display_name": "Stub", "enabled": true, "api_key_configured": false },
    "storage_provider": { "id": 3, "provider_name": "local", "display_name": "Local", "enabled": true, "api_key_configured": false },
    "export_template": { "id": 1, "version": "1.0.0" }
  }
}
```

---

## 20. 启动时 Seeding 机制

> 来源：`apps/api/app/db/init_db.py`

每次 API 服务启动（`app/start.py` 或 uvicorn 启动时调用 `init_db()`）执行以下初始化：

### 20.1 Prompt 模板 Seeding（`seed_default_prompt_templates`）

- 加载 `apps/api/app/data/default_prompt_templates.json`
- 按 `prompt_type` 分组
- 插入：`scope=global` + `is_active=true` + 模板内容
- 更新逻辑：**如果模板文本（`template_text`）发生变化，则更新记录**（按 `prompt_type` + `scope=global` + `name` 匹配）

### 20.2 Provider 配置 Seeding（`seed_default_provider_configs`）

初始化 3 个默认 Provider：

| provider_name | display_name | 来源 |
|--------------|-------------|------|
| `openai` | `OpenAI Compatible` | `OPENAI_API_KEY` 环境变量 |
| `stub` | `Stub` | 始终可用（测试用） |
| `local` | `Local Storage` | 始终可用 |

- 若同名记录已存在则跳过
- `openai` 类型：`text`；`stub` 类型：`image`；`local` 类型：`storage`

### 20.3 导出模板 Seeding（`seed_default_export_template`）

- 若不存在默认 Temu 导出模板则创建
- 若映射不存在则创建 30+ 个默认字段映射
- **自动生成 `export-template-fields.md`**：`export_seed.py` 末尾调用 `_generate_doc_md()` 输出到 `docs/export-template-fields.md`

---

## 21. 导出字段 source_field 映射表

> 来源：`apps/api/app/services/export_seed.py:_default_mapping_for_field`
>
> 详细字段说明另见 `docs/export-template-fields.md`（启动时由 `export_seed.py` 自动生成）

以下为代码中定义的 40+ 个字段来源映射规则（`source_path` 为导出字段草稿或图片资产中的字段名）：

| 导出字段 key | 导出字段名 | source_type | source_path | 默认值 |
|-------------|-----------|------------|------------|--------|
| `lei_mu_id` | 类目ID | `draft` | `selected_category_id` | — |
| `zhu_bian_hao` | 主编号 | `draft` | `master_no` | — |
| `chan_pin_biao_ti` | 产品标题 | `draft` | `product_title_cn` | — |
| `ying_wen_biao_ti` | 英文标题 | `draft` | `product_title_en` | — |
| `chan_pin_miao_shu` | 产品描述 | `draft` | `product_description` | — |
| `cheng_nuo_fa_huo_shi_xiao` | 承诺发货时效 | `draft` | `shipping_time` | `48小时` |
| `zhu_huo_hao` | 主货号 | `draft` | `master_item_no` | — |
| `chan_di` | 产地 | `draft` | `origin_country` | — |
| `gui_ge_ming_cheng_1` | 规格名称1 | `draft` | `sku_spec1_name` | — |
| `gui_ge_shu_xing_zhi_1` | 规格属性值1 | `draft` | `sku_spec1_value` | — |
| `gui_ge_ming_cheng_2` | 规格名称2 | `draft` | `sku_spec2_name` | — |
| `gui_ge_shu_xing_zhi_2` | 规格属性值2 | `draft` | `sku_spec2_value` | — |
| `yu_lan_tu` | 预览图 | `asset` | `preview_1,preview_2,preview_3` | — |
| `shen_bao_jie_cny` | 申报价（CNY） | `draft` | `declared_price_cny` | — |
| `jian_yi_shou_jie_cny` | 建议售价（CNY） | `draft` | `suggested_price_cny` | — |
| `chang_cm` | 长（cm） | `draft` | `length_cm` | — |
| `kuan_cm` | 宽（cm） | `draft` | `width_cm` | — |
| `gao_cm` | 高（cm） | `draft` | `height_cm` | — |
| `zhong_liang_g` | 重量（g） | `draft` | `weight_g` | — |
| `ku_cun` | 库存 | `draft` | `stock_qty` | — |
| `ping_tai_sku` | 平台SKU | `draft` | `platform_sku` | — |
| `chan_pin_lun_bo_tu` | 产品轮播图 | `asset` | `carousel_1,carousel_2,carousel_3,carousel_4,carousel_5,carousel_6,carousel_7,carousel_8` | — |
| `chan_pin_su_cai_tu` | 产品素材图 | `asset` | `preview_1,preview_2,preview_3` | — |
| `zhu_tu_shi_pin` | 主图视频 | `draft` | `main_video_url` | — |
| `chan_pin_shuo_ming_shu` | 产品说明书 | `draft` | `manual_url` | — |
| `huo_yuan_lian_jie` | 货源链接 | `draft` | `supplier_url` | — |
| `shi_fou_min_gan_shu_xing` | 是否敏感属性 | `draft` | `is_sensitive` | `否` |
| `min_gan_shu_xing_zhi` | 敏感属性值 | `draft` | `sensitive_type` | — |
| `ding_zhi_pin` | 定制品 | `draft` | `is_custom` | `否` |
| `zhan_wai_chan_pin_lian_jie` | 站外产品链接 | `draft` | `source_url` | — |
| `chu_dian_rong_liang` | 储电容量 | `draft` | `battery_capacity` | — |
| `dao_ju_chang_du` | 刀具长度 | `draft` | `blade_length` | — |
| `dao_ju_jian_du` | 刀具尖度 | `draft` | `blade_tip_sharpness` | — |
| `ye_ti_rong_liang` | 液体容量 | `draft` | `liquid_capacity` | — |
| `chan_pin_bian_ma_lei_xing` | 产品编码类型 | `draft` | `product_code_type` | — |
| `chan_pin_bian_ma` | 产品编码 | `draft` | `product_code` | — |
| `skufen_lei_lei_xing` | SKU分类类型 | `draft` | `sku_class_type` | — |
| `skufen_lei_shu_liang` | SKU分类数量 | `draft` | `sku_class_count` | — |
| `skufen_lei_dan_wei` | SKU分类单位 | `draft` | `sku_class_unit` | — |
| `shi_fou_du_li_bao_zhuang` | 是否独立包装 | `draft` | `is_independent_packaging` | — |
| `bao_zhuang_qing_dan` | 包装清单 | `draft` | `packing_list` | — |
| `bao_zhuang_qing_dan_shu_liang` | 包装清单数量 | `draft` | `packing_list_count` | — |

> 注：`source_type` 可选值：`draft`（导出字段草稿）、`asset`（图片资产）、`manual`（手动填写）、空（未配置）。若 `source_type=manual` 则该字段不自动填充。

---

## 22. 快速参考补充

### 22.1 数据库表清单（完整）

| 表名 | 模型 | 用途 |
|------|------|------|
| `raw_products` | `RawProduct` | 采集原始数据 |
| `product_tasks` | `ProductTask` | 上架任务主表 |
| `product_ai_results` | `ProductAIResult` | AI 结果快照 |
| `image_generation_jobs` | `ImageGenerationJob` | 图片生成任务 |
| `product_assets` | `ProductAsset` | 图片资产 |
| `provider_configs` | `ProviderConfig` | AI/图片/存储 Provider |
| `prompt_templates` | `PromptTemplate` | 提示词模板 |
| `default_rules` | `DefaultRule` | 默认字段规则 |
| `export_templates` | `ExportTemplate` | 导出 Excel 模板 |
| `export_field_mappings` | `ExportFieldMapping` | 字段映射规则 |
| `export_batches` | `ExportBatch` | 导出批次 |
| `export_records` | `ExportRecord` | 导出记录 |
| `export_field_drafts` | `ExportFieldDraft` | 导出字段草稿 |
| `usage_limits` | `UsageLimit` | 用量限制记录 |
| `ai_import_batches` | `AiImportBatch` | AI 外部导入批次 |
| `ai_import_drafts` | `AiImportDraft` | AI 导入草稿 |
| `cost_configs` | `CostConfig` | 费用配置 |
| `cost_records` | `CostRecord` | 费用记录 |
| `batch_edit_queue` | `BatchEditQueueItem` | 批量编辑队列 |

### 22.2 状态值速查

**导出状态 `ExportStatus`**：`pending / ready / previewed / running / done / failed`

**图片状态 `ImageStatus`**：`pending / running / done / failed`

**AI 导入状态**：`uploaded / parsed / confirmed / exported`

**批量编辑状态**：`queued / processing / done / failed`

### 22.3 关键环境变量

| 变量 | 作用 | 默认值 |
|------|------|--------|
| `AI_CAIJI_DATABASE_URL` | PostgreSQL 连接 URL | `postgresql://localhost/ai_caiji` |
| `AI_CAIJI_STORAGE_ROOT` | 文件存储根目录 | `storage` |
| `AI_CAIJI_MODEL_NAME` | 文本模型 | `gpt-4o-2024-08-06` |
| `AI_CAIJI_VISION_MODEL_NAME` | 视觉模型 | `gpt-4.1-mini` |
| `OPENAI_API_KEY` | OpenAI Key（自动读取用于 Provider Seeding） | 无 |

### 12.1 Prompt 类型总表（后端允许类型）

来源：`apps/api/app/core/prompt_types.py`

- `product_info_from_screenshot`
- `title_en`
- `title_en_only`
- `title_package_lite`
- `title_package`
- `title_en_with_cn_translation`
- `image_prompt_package`
- `image_prompt_main`
- `image_prompt_carousel_1`
- `image_prompt_carousel_2`
- `image_prompt_carousel_3`
- `image_prompt_carousel_4`
- `image_prompt_carousel_4grid`
- `image_prompt_dimension`
- `dimension_extract_from_image`

---

### 12.2 Prompt 解析优先级

来源：`apps/api/app/services/prompt_templates.py:resolve_prompt`

同一个 `prompt_type` 下优先级：
1. `task` 级模板（`scope=task` 且 `task_id` 命中）
2. `category` 级模板（`scope=category` 且 `category_id` 命中）
3. `global` 级模板

同 scope 多版本：按 `version desc`、`updated_at desc`、`id desc` 选最新。

---

### 12.3 AI 流程里实际调用了哪些 Prompt

来源：`apps/api/app/services/ai_pipeline.py`

- 商品理解阶段：
  - 调用 `product_info_from_screenshot`
  - 函数：`_get_prompt(... prompt_type="product_info_from_screenshot")`

- 标题阶段：
  - `title_only` 模式调用 `title_package_lite`
  - 其他常见模式调用 `title_package`
  - 英文标题专用入口调用 `title_en_only`

- 类目阶段：
  - **不调用独立类目 Prompt**（当前是代码召回）
  - 类目输入主要来自 `product_info + title_package` 结果

- 图片提示词包阶段：
  - `image_prompt_package` 在当前实现中是“代码动态上下文”
  - 不走 LLM 模板渲染生成最终 prompt

---

### 12.4 图片生成时实际用到的 Prompt

来源：`apps/api/app/services/image_generation.py` + `apps/api/app/api/routes/image_jobs.py`

- 自动四宫格（bootstrap）：
  - `image_prompt_carousel_4grid`

- 手动单槽位生成：
  - `carousel_1` -> `image_prompt_carousel_1`
  - `carousel_2` -> `image_prompt_carousel_2`
  - `carousel_3` -> `image_prompt_carousel_3`
  - `carousel_4` -> `image_prompt_carousel_4`
  - `carousel_4grid` -> `image_prompt_carousel_4grid`
  - `size_chart` -> `image_prompt_dimension`（通过别名映射）
  - `sku_image` -> `image_prompt_main`（通过别名映射）

- 重新生成资产：
  - 按资产 `slot` 反推 `image_prompt_{slot}`（含别名映射）

---

### 12.5 尺寸提取用到的 Prompt

来源：`apps/api/app/services/dimension_extract.py`

- 尺寸识别固定使用：`dimension_extract_from_image`
- 用途：从尺寸图解析结构化尺寸字段（供尺寸相关导出字段与复核）

---

### 12.6 前端哪里在操作 Prompt

- 提示词中心：`apps/web/src/app/prompts/page.tsx`
  - 管理/编辑/新增/渲染测试所有 `prompt_type`

- 上架加工工作台：`apps/web/src/app/product-tasks/page.tsx`
  - 支持按场景快速打开 Prompt 编辑：
    - 标题处理：`product_info_from_screenshot`、`title_package`
    - 类目处理：`product_info_from_screenshot`
    - 四宫格：`title_package`、`image_prompt_package`、`image_prompt_carousel_4grid`
    - 尺寸图：`dimension_extract_from_image`、`image_prompt_dimension`
  - 支持通过 `/api/prompt-templates/resolve` 查看当前任务生效模板（task/category/global 解析结果）

---

### 12.7 当前容易误解的点（必须说明）

1. `image_prompt_package` 名字里有 prompt，但当前不是“再调一次 LLM 生成 prompt 文本”，而是代码拼上下文。  
2. 类目没有单独的 `category_match_prompt`；类目是字典召回，不是直接 LLM 选类。  
3. `title_en` 与 `title_package` 有兼容关系，当前很多场景以 `title_package` 为主，`title_en` 常作为镜像字段。


---

## 13. Prompt 依赖矩阵（`prompt_type -> 输入变量 -> 产出字段 -> 下游依赖`）

> 说明：这里按“当前源码主路径”整理，便于你改模板时判断影响面。

| prompt_type | 主要输入变量（示例） | 主要产出字段 | 直接下游依赖 |
|---|---|---|---|
| `product_info_from_screenshot` | `title`, `category_path`, `attributes_text`, `sku_text`, `platform`, `source_url`, `screenshot_notes`, `raw_payload` | `product_core_v2`, `visual_facts`, `category_basis`, `image_generation_basis`, `evidence` | `title_package/title_package_lite`、类目召回、图片动态上下文 |
| `title_package_lite` | `raw_title`, `product_info`, `attributes_text`, `sku_text`, `selected_category_path` | `title_cn`, `title_en`, `core_product_words`, `selling_points`, `category_search_keywords` | `task.title` 更新、类目召回关键词 |
| `title_package` | `raw_title`, `product_info`, `attributes_text`, `sku_text`, `selected_category_path`, `original_category_path` | `title_cn`, `title_en`, `title_cn_translation`, `core_product_words`, `selling_points`, `category_search_keywords`, `suggested_category_search_query` | `task.title` 更新、类目召回、图片动态上下文 |
| `title_en_only` | `raw_title`, `product_info`, `attributes_text`, `sku_text`, `platform`, `target_language=en` | `title_en`, `title_en_short`, `core_product_words` | 英文标题快速重生（任务页手动触发） |
| `image_prompt_package` | `selected_category_path`, `product_info`, `title_package`, `raw_images` | `shared_context`, `slot_contexts`（动态上下文包） | 各槽位 prompt 渲染变量来源（四宫格/轮播/SKU/尺寸） |
| `image_prompt_carousel_4grid` | `optimized_title_cn`, `selected_category_path`, `title_en_with_cn_translation`, `product_info_context`, `selling_points`, `reference_images` | 最终四宫格生图 prompt 文本 | 自动/手动四宫格生成，裁切 `carousel_1~4` |
| `image_prompt_carousel_1` | 同上（偏主图语义） | 槽位 `carousel_1` prompt | 单槽位生图 |
| `image_prompt_carousel_2` | 同上（偏卖点/局部） | 槽位 `carousel_2` prompt | 单槽位生图 |
| `image_prompt_carousel_3` | 同上（偏场景/差异） | 槽位 `carousel_3` prompt | 单槽位生图 |
| `image_prompt_carousel_4` | 同上（偏补充卖点） | 槽位 `carousel_4` prompt | 单槽位生图 |
| `image_prompt_main` | 同上（主图 / SKU 图变量） | 主图或 `sku_image` prompt（别名映射） | SKU 图生成、部分单图生成 |
| `image_prompt_dimension` | `dimension_data`, `product_info_context`, `title_en_with_cn_translation`, `selected_category_path` | 尺寸图生成 prompt | 尺寸图生图 |
| `dimension_extract_from_image` | 尺寸图 URL / data、`product_info_context`、标题/类目上下文 | 结构化尺寸识别结果（尺寸字段候选） | 尺寸字段回填、导出字段草稿辅助 |

### 13.1 槽位别名映射（代码里真实存在）

来源：`apps/api/app/services/image_generation.py`

- `image_prompt_sku_image` -> `image_prompt_main`
- `image_prompt_size_chart` -> `image_prompt_dimension`

### 13.2 改 Prompt 前的影响面检查清单

1. 改 `product_info_from_screenshot`：会连带影响标题、类目、图片全部后续链路。  
2. 改 `title_package`：会影响标题展示、类目召回关键词、图片上下文。  
3. 改 `image_prompt_carousel_4grid`：直接影响自动四宫格产图质量。  
4. 改 `dimension_extract_from_image`：会影响尺寸相关字段与尺寸图链路。  
5. 若新增变量占位符，先确认该变量在 `build_image_prompt_variables()` 或 AI 输入组装中真实存在。


---

## 14. 按页面按钮反推 Prompt 调用链（操作 -> 接口 -> prompt_type）

> 目标：你在前端点一个按钮，能直接知道后端会走哪些 Prompt。

### 14.1 页面：`/raw-products`

#### 按钮：创建任务（`generation_mode=task_only`）
- 接口：`POST /api/raw-products/{id}/create-task`（或批量接口）
- Prompt：**不调用**
- 结果：任务直接进入 `review_ready`

#### 按钮：创建任务（`generation_mode=title_only`）
- 接口：同上
- bootstrap -> AI：
  1. `product_info_from_screenshot`
  2. `title_package_lite`
  3. 类目代码召回（非 LLM）
- 不会自动触发：四宫格生图

#### 按钮：创建任务（`generation_mode=title_and_4grid`）
- 接口：同上
- bootstrap -> AI：
  1. `product_info_from_screenshot`
  2. `title_package`
  3. 类目代码召回（非 LLM）
  4. `image_prompt_package`（动态上下文）
- bootstrap -> 图片：
  5. `image_prompt_carousel_4grid`（四宫格自动生成）

---

### 14.2 页面：`/product-tasks` 列表区

#### 按钮：运行 AI（单条或批量）
- 接口：`POST /api/product-tasks/{task_id}/run-ai`
- 默认 Prompt 组合（无 `prompt_types` 时）取决于任务模式：
  - `title_only`：`product_info_from_screenshot` + `title_package_lite`
  - 其它常见模式：`product_info_from_screenshot` + `title_package` + `image_prompt_package`

#### 按钮：生成标题（单条或批量）
- 接口：`POST /api/product-tasks/{task_id}/generate-title-en-only`
- Prompt：`title_en_only`

#### 按钮：生成四宫格（单条或批量）
- 接口：`POST /api/product-tasks/{task_id}/generate-images`
- Prompt：`image_prompt_carousel_4grid`

---

### 14.3 页面：`/product-tasks` 抽屉 Info Tab

#### 按钮：运行商品理解
- 接口：`POST /api/product-tasks/{task_id}/run-product-info`
- Prompt：`product_info_from_screenshot`

#### 按钮：重生标题
- 接口：`POST /api/product-tasks/{task_id}/generate-title-en-only`
- Prompt：`title_en_only`

#### 操作：选择类目
- 接口：`POST /api/product-tasks/{task_id}/select-category`
- Prompt：**不调用**（直接写任务字段）

---

### 14.4 页面：`/product-tasks` 抽屉 Images Tab

#### 按钮：生成四宫格
- 接口：`POST /api/product-tasks/{task_id}/generate-images`
- Prompt：`image_prompt_carousel_4grid`

#### 按钮：生成单槽位图（轮播1/2/3/4）
- 接口：`POST /api/product-tasks/{task_id}/generate-image`
- Prompt：
  - `carousel_1` -> `image_prompt_carousel_1`
  - `carousel_2` -> `image_prompt_carousel_2`
  - `carousel_3` -> `image_prompt_carousel_3`
  - `carousel_4` -> `image_prompt_carousel_4`

#### 按钮：生成 SKU 图
- 接口：`POST /api/product-tasks/{task_id}/generate-sku-image`
- Prompt：`image_prompt_main`（槽位别名映射）

#### 按钮：生成尺寸图
- 接口：`POST /api/product-tasks/{task_id}/generate-size-image`
- Prompt：`image_prompt_dimension`（槽位别名映射）

#### 按钮：批量卖点图
- 接口：`POST /api/product-tasks/{task_id}/generate-selling-images`
- Prompt：按目标槽位使用对应 `image_prompt_{slot}`

#### 按钮：尺寸识别
- 接口：`POST /api/product-tasks/{task_id}/dimension-extract`
- Prompt：`dimension_extract_from_image`

#### 按钮：重生成资产
- 接口：`POST /api/assets/{asset_id}/regenerate`
- Prompt：按 `asset.slot` 反推 `image_prompt_{slot}`（含别名映射）

---

### 14.5 页面：`/product-tasks` Prompt 编辑弹窗

#### 操作：查看“当前生效模板”
- 接口：`GET /api/prompt-templates/resolve?prompt_type=...&task_id=...`
- 用途：查看 task/category/global 三层解析后的最终模板

#### 操作：保存覆盖模板
- 接口：`POST /api/prompt-templates` 或 `PATCH /api/prompt-templates/{id}`
- 结果：下次执行同 `prompt_type` 时会按优先级命中新的模板

#### 操作：保存后重跑
- 接口：`POST /api/product-tasks/{task_id}/run-ai`（携带指定 `prompt_types`）
- Prompt：仅重跑所选类型对应链路

---

### 14.6 页面：`/prompts`

#### 按钮：渲染测试
- 接口：`POST /api/prompt-templates/render`
- Prompt：仅模板渲染，不执行 AI

#### 按钮：创建/编辑模板
- 接口：`POST /api/prompt-templates`、`PATCH /api/prompt-templates/{id}`
- Prompt：更新模板仓，不直接触发任务执行

---

### 14.7 快速判断图（最常用）

- 想改“商品理解”：改 `product_info_from_screenshot`
- 想改“标题质量”：改 `title_package` / `title_package_lite` / `title_en_only`
- 想改“四宫格质量”：改 `image_prompt_carousel_4grid`
- 想改“SKU 图风格”：改 `image_prompt_main`
- 想改“尺寸识别”：改 `dimension_extract_from_image`
- 想改“尺寸图生成”：改 `image_prompt_dimension`


---

## 15. 按异常现象排障对照表（现象 -> 先查哪里 -> 可能原因 -> 处理动作）

| 异常现象 | 先查位置 | 常见原因 | 处理动作 |
|---|---|---|---|
| 创建任务后一直不动 | `product_tasks.main_status`、`exception_status` | bootstrap 异步失败、AI key 未配置 | 看 `exception_reasons_json`；检查 `/api/settings/task-readiness` 与 provider 配置 |
| 任务直接 `failed` | `product_tasks.last_error_message`、`timeline` | AI 调用失败、模板缺失、provider 报错 | 在 Trace 看失败 stage；补齐对应 prompt template；重跑 `/run-ai` |
| 标题为空或质量差 | `product_ai_results.title_package` / `title_en` | `title_package` 模板不合理、`product_info` 输入弱 | 先看 `product_info.output` 是否充分，再调 `title_package` 模板 |
| 类目总是低置信度 | `category_status`、`category_candidates_json` | 召回词弱、词典覆盖不足、标题关键词偏差 | 看 `category_match.input.queries`；补充 `temu_category_review_dict.json`；优化标题关键词模板 |
| 类目看着不对但状态 success | `selected_category_id` 与 `category_candidates_json` | top1 分数高但业务语义偏差 | 在任务页手动 `select-category`；必要时加类目排除词策略 |
| 四宫格没自动出图 | `main_status/image_status`、`image_jobs` | 图片 provider 未配置/未启用；prompt 缺失 | 检查 `/api/image-providers/default`；确认 `image_prompt_carousel_4grid` 模板启用 |
| 单图生成失败 | `image_generation_jobs.status/error_message` | 槽位 prompt 缺失、provider 超时/限流 | 看对应 `image_prompt_{slot}` 是否存在；重试或降并发 |
| 生成出来图不符合预期 | `image_jobs.final_prompt`、模板内容 | prompt 约束不足、变量缺失 | 从任务页打开 prompt 编辑，按槽位调整模板并重生成 |
| 尺寸识别失败 | `dimension-extract` 接口返回、`exception` | `dimension_extract_from_image` 模板不稳定、尺寸图质量差 | 优化尺寸模板；先手动指定更清晰尺寸图再识别 |
| 导出预览报错 | `/api/exports/preview` 返回 errors | 字段草稿缺失、必填字段空、映射配置错误 | 先 `apply-default-rules`，再查 mapping 和模板字段 |
| 导出运行失败 | `export_batches/export_records`、接口报错 | 模板路径不存在、Excel 写入异常、媒体字段异常 | 检查默认模板文件存在；检查媒体 URL/字段映射 |
| 导出图片列为空 | `product_assets.selected_for_export`、mapping | 未设最终图或字段映射到错误 source_path | 在 Images 里设 final；校对 `export_field_mappings` |
| Prompt 改了但任务没生效 | `resolve` 接口结果、template scope | 命中了更高优先级模板（task/category） | 用 `/api/prompt-templates/resolve` 确认命中模板；改对应 scope |
| 同一任务不同页面结果不一致 | `workbench-detail` vs 列表缓存 | 前端缓存未刷新、异步任务尚未完成 | 手动刷新列表与抽屉；轮询 job 状态直到完成 |
| 插件显示采集成功但入库没有 | 浏览器插件状态 + `/api/raw-products` | 后端地址填错、服务没起、请求被拦截 | 检查 popup 的 serverUrl；先测 `/health` 再重试 |
| 插件采不到图 | `content.js` 逻辑 + `debug_payload` | 页面 DOM 改版、平台策略失效 | 优先修 `platform-collectors.js` 选择器与脚本回退规则 |

### 15.1 快速排障顺序（推荐固定动作）

1. 看任务：`main_status` + 子状态 + `exception_*`。  
2. 看时间线：`/api/product-tasks/{id}/timeline` 定位失败 stage。  
3. 看 AI 快照：`product_ai_results` 的 `input/output/error/prompt`。  
4. 看图片任务：`/api/jobs/{job_id}` 与 `product_assets`。  
5. 看导出：`export-fields preview` -> `exports preview` -> `exports run`。

### 15.2 高频修复入口（按问题类型）

- 文案问题：`/prompts` 调 `title_package` / `title_package_lite` / `title_en_only`。  
- 类目问题：先手选类目，再优化标题关键词与类目词典。  
- 生图问题：先查 provider，再改槽位 prompt。  
- 导出问题：先补字段草稿，再校正 mapping。  
- 采集问题：优先修插件选择器和 URL 过滤规则。

