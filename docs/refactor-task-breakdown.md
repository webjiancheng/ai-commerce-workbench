# 重构开发任务拆分

本文把 `docs/refactor-analysis.md` 里的分析拆成可执行任务。原则是先做低风险、无行为变化的结构整理，再拆业务模块，最后处理高风险链路。

## 执行原则

- 每个任务尽量小于半天到一天。
- 同一个 PR/提交内只做一种事情：类型抽取、组件拆分、API 封装、service 拆分不要混在一起。
- 第一轮不改接口路径、不改字段名、不改页面交互。
- 拆分时保留 facade 或 re-export，降低 import 大面积震荡。
- 不批量删除文件；如确实要清理旧文件，单个明确路径处理。

## 阶段 0：准备与基线

### T0.1 确认当前可运行基线

目标：

- 明确当前前端、后端能否启动。
- 记录已有失败项，避免后续把历史问题算成重构引入。

范围：

- 不改代码。
- 只运行检查命令。

建议命令：

```bash
npm run dev:web
cd apps/api
python -m pytest
```

验收：

- 记录前端启动结果。
- 记录后端测试结果。
- 如果没有测试或测试失败，写明现状原因。

风险：

- 当前工作区已有未提交改动，先不要做格式化或大范围变更。

### T0.2 建立重构目录约定

目标：

- 先创建前端 feature 目录骨架，不迁移大量代码。

建议目录：

```text
apps/web/src/features/product-tasks/
├── api.ts
├── types.ts
├── utils.ts
└── components/
```

验收：

- 目录存在。
- 暂不影响任何现有页面。

## 阶段 1：前端 product-tasks 基础抽取

这是最高优先级。先降低 `product-tasks/page.tsx` 的上下文体积和重复定义。

### T1.1 抽取 product-tasks 共享类型

目标：

- 把 `ProductTaskListItem`、`ProductTaskDetail`、`RawProductDetail`、`ProductAsset`、`AssetsBySlotResponse`、`RowMeta` 等类型移到共享文件。

文件：

- 新增 `apps/web/src/features/product-tasks/types.ts`
- 修改 `apps/web/src/app/product-tasks/page.tsx`
- 修改 `apps/web/src/components/product-tasks/workbench-table.tsx`

验收：

- 两个组件都从共享类型导入。
- 不再各自复制同名类型。
- TypeScript 无新增错误。

风险：

- 类型字段有轻微差异时，不要强行删字段，先取并集。

### T1.2 抽取 product-tasks 纯工具函数

目标：

- 把无 React 状态依赖的函数抽到 `utils.ts`。

候选函数：

- `normalizeGenerationMode`
- `getGenerationModeLabel`
- `formatDateTime`
- `formatJson`
- `status` / timeline 展示辅助函数
- `latestAsset`
- `selectedSlotAsset`
- `slotHasRemovalMarker`
- `rawCarouselSequence`
- `rawImageForCarouselSlot`
- `tableSlotImage`
- `taskThumbnail`
- `normalizeExportImageSettings`
- `insertItemAtPosition`

文件：

- 新增 `apps/web/src/features/product-tasks/utils.ts`
- 修改 `apps/web/src/app/product-tasks/page.tsx`
- 修改 `apps/web/src/components/product-tasks/workbench-table.tsx`

验收：

- `page.tsx` 和 `workbench-table.tsx` 不再重复图片槽位工具。
- 工具函数不依赖 React。
- 页面行为不变。

风险：

- `taskThumbnail` 当前优先级需要保持原样，避免列表缩略图变化。

### T1.3 抽取 product-tasks API 客户端

目标：

- 把页面里的散落 `fetch` 收敛到 feature API。

新增：

```text
apps/web/src/features/product-tasks/api.ts
```

先封装这些接口：

- `listProductTasks`
- `getProductTaskTimeline`
- `getWorkbenchDetail`
- `runTaskAi`
- `generateTaskTitles`
- `generateFourGrid`
- `patchTaskFieldChoice`
- `patchProductTask`

验收：

- `ProductTasksPageInner` 内直接拼 URL 的列表/详情/AI 相关请求明显减少。
- 错误信息和原逻辑保持一致。

风险：

- 先不要一次性迁移图片 tab 内所有接口，图片链路放到后续任务。

### T1.4 抽取列表数据 hook

目标：

- 从页面主组件中拿走列表查询、分页、过滤、轮询。

新增：

```text
apps/web/src/features/product-tasks/hooks/use-product-task-list.ts
```

包含：

- `keyword`
- `status`
- `categoryStatus`
- `exportStatus`
- `exceptionOnly`
- `lowConfidenceOnly`
- `data`
- `loading`
- `error`
- `loadList`
- `changePage`
- `changePageSize`

验收：

- `ProductTasksPageInner` 中列表相关 state 明显减少。
- 列表筛选、分页、自动刷新行为不变。

风险：

- `rowMeta` 和 `timelineMap` 可以先留在页面，避免一次拆太多。

### T1.5 抽取 row meta/timeline hook

目标：

- 把每行详情 meta 和 timeline 加载从页面剥离。

新增：

```text
apps/web/src/features/product-tasks/hooks/use-task-row-meta.ts
```

包含：

- `rowMeta`
- `timelineMap`
- `loadRowMeta`
- `loadTimelines`
- `loadWorkbenchDetail`

验收：

- 表格、卡片仍能显示缩略图、导出草稿、状态时间线。
- 打开抽屉后外层表格能同步刷新。

风险：

- 这里和抽屉详情共享数据，接口设计要保守。

## 阶段 2：前端 product-tasks 组件拆分

### T2.1 抽出 `PromptEditorModal`

目标：

- 把 `PromptEditorModal` 从 `page.tsx` 移到独立组件。

文件：

- 新增 `apps/web/src/features/product-tasks/components/prompt-editor-modal.tsx`

验收：

- 提示词弹窗打开、保存、关闭行为不变。
- 页面减少约数百行。

### T2.2 抽出 `ReviewBoard`

目标：

- 把卡片视图从 `page.tsx` 移到独立组件。

文件：

- 新增 `apps/web/src/features/product-tasks/components/review-board.tsx`

验收：

- `/logs` 卡片视图显示不变。
- 点击卡片打开抽屉不变。

### T2.3 抽出 `TaskDrawer`

目标：

- 把抽屉外壳、尺寸、tab 切换从页面主组件移出。

文件：

- 新增 `apps/web/src/features/product-tasks/components/task-drawer.tsx`

验收：

- 抽屉打开、关闭、尺寸记忆、tab 切换不变。
- `ProductTasksPageInner` 只传入 `taskDetail`、`rawDetail`、`timeline`、回调。

### T2.4 拆分 drawer tabs

目标：

- 将各 tab 独立成文件。

新增：

```text
apps/web/src/features/product-tasks/components/tabs/
├── images-tab.tsx
├── trace-tab.tsx
├── info-tab.tsx
├── defaults-tab.tsx
├── raw-data-tab.tsx
└── export-fields-tab.tsx
```

验收：

- 每个 tab 可单独打开文件排查。
- `page.tsx` 不再包含大型 tab JSX。

风险：

- `ImagesTab` 最大，建议单独任务拆。

## 阶段 3：图片工作台拆分

### T3.1 抽取图片资产 API

目标：

- 把 `ImagesTab` 内的图片请求统一封装。

新增：

```text
apps/web/src/features/product-tasks/image-workbench/api.ts
```

包含：

- `listTaskAssets`
- `generateCarousel4Grid`
- `generateSingleImage`
- `generateSellingImages`
- `generateSkuImage`
- `generateSizeImage`
- `setFinalAsset`
- `regenerateAsset`
- `assignImageToSlot`
- `removeSlotImage`
- `reorderSlots`
- `dimensionExtract`

验收：

- `ImagesTab` 中直接 `fetch` 明显减少。
- 错误提示仍显示后端 detail。

### T3.2 抽取 `useImageAssets`

目标：

- 管理 assets、loading、busySlots、jobStatus、pollJob。

新增：

```text
apps/web/src/features/product-tasks/image-workbench/use-image-assets.ts
```

验收：

- 生图、轮询、刷新资产行为不变。
- `ImagesTab` 只负责布局和调用 hook。

### T3.3 拆图片 UI 小组件

目标：

- 把图片工作台拆成可读组件。

新增：

```text
apps/web/src/features/product-tasks/image-workbench/
├── image-lightbox.tsx
├── candidate-pool-section.tsx
├── image-gallery-section.tsx
├── four-grid-center-card.tsx
├── layout-compare-card.tsx
└── slot-card.tsx
```

验收：

- `images-tab.tsx` 控制在 500-800 行以内。
- 拖拽、预览、替换、删除、同步表格行为不变。

## 阶段 4：导出中心拆分

这个阶段适合在 product-tasks 初步拆完后做，也可以作为独立低风险任务。

### T4.1 抽取 exports 类型与 API

新增：

```text
apps/web/src/features/exports/types.ts
apps/web/src/features/exports/api.ts
apps/web/src/features/exports/utils.ts
```

迁移：

- `TabKey`
- `ExportBatch`
- `DefaultRule`
- `ExportAdapter`
- `TemplateMeta`
- `AiImportBatch`
- `AiImportDraft`
- `parseIds`
- `buildPrompt`

验收：

- `apps/web/src/app/exports/page.tsx` 只保留页面状态和布局。

### T4.2 拆分 exports 三个 tab

新增：

```text
apps/web/src/features/exports/components/fixed-export-tab.tsx
apps/web/src/features/exports/components/ai-import-tab.tsx
apps/web/src/features/exports/components/export-history-tab.tsx
```

验收：

- 固定导出、AI 导入、历史记录三个区域可独立维护。
- 当前导出流程不变。

## 阶段 5：默认值规则页面拆分

### T5.1 抽出字段定义和模板

新增：

```text
apps/web/src/features/default-rules/field-definitions.ts
apps/web/src/features/default-rules/quick-templates.ts
apps/web/src/features/default-rules/types.ts
```

验收：

- `rules/page.tsx` 不再包含大段字段配置。
- 字段顺序和默认模板不变。

### T5.2 拆规则编辑器和列表

新增：

```text
apps/web/src/features/default-rules/components/rule-editor.tsx
apps/web/src/features/default-rules/components/rule-list.tsx
apps/web/src/features/default-rules/api.ts
```

验收：

- 创建、编辑、禁用规则行为不变。

## 阶段 6：后端图片接口减肥

### T6.1 抽图片 IO 工具

目标：

- 从 `api/routes/image_jobs.py` 抽出图片读取和尺寸识别。

新增：

```text
apps/api/app/services/image_asset_io.py
```

迁移：

- `_guess_ext`
- `_load_image_bytes_from_url`
- `_decode_data_url`
- `_image_size`

验收：

- 图片上传、URL 选择、手工分配行为不变。

### T6.2 抽 product asset service

新增：

```text
apps/api/app/services/product_assets.py
```

迁移：

- set final
- assign image to slot
- preferred slot asset
- mark slot removed
- remove slot image
- reorder slots

验收：

- `image_jobs.py` route 只负责 HTTP 参数和错误映射。
- 资产选择、删除、重排行为不变。

### T6.3 抽 image job orchestrator

新增：

```text
apps/api/app/services/image_job_orchestrator.py
```

迁移：

- provider 解析。
- create image jobs。
- background run 包装。
- regenerate job 创建。

验收：

- `/generate-images`、`/generate-image`、`/regenerate` 路径不变。
- 后台生图仍能执行。

## 阶段 7：后端导出链路拆分

### T7.1 抽导出 row builder

新增：

```text
apps/api/app/services/export/row_builder.py
apps/api/app/services/export/media_fields.py
```

迁移：

- `_build_row_v2`
- `_fill_media_field_by_name`
- `_arranged_carousel_assets`
- `_format_asset_output`
- `_load_selected_assets`

验收：

- 预览和实际导出的字段值不变。

### T7.2 抽导出 validators

新增：

```text
apps/api/app/services/export/validators.py
```

迁移：

- AI readiness 校验。
- 资产尺寸校验。
- 远程媒体 URL 探测。
- 多语言轮播差异校验。

验收：

- 导出前错误和 warning 文案不变。

### T7.3 保留兼容 facade

目标：

- `apps/api/app/services/export_runner.py` 继续提供原函数名。

验收：

- route import 不需要大面积修改。

## 阶段 8：AI pipeline 拆分

高风险，放在后面。

### T8.1 抽 AI 调用通用层

新增：

```text
apps/api/app/services/ai/client_call.py
apps/api/app/services/ai/pricing.py
```

迁移：

- `_parse_with_fallback`
- `_repair_json_payload`
- `_extract_usage_metrics`
- `_estimate_text_cost`
- `_resolve_text_pricing`

验收：

- product info、title、image prompt 调用结果结构不变。

### T8.2 抽 step planner

新增：

```text
apps/api/app/services/ai/step_planner.py
```

迁移：

- `_normalize_requested_steps`
- `_expand_wanted_with_dependencies`
- `_normalize_generation_mode`

验收：

- 三种生成模式执行步骤不变。

### T8.3 分离 product info/title/image prompt 包

新增：

```text
apps/api/app/services/ai/product_info.py
apps/api/app/services/ai/title_generation.py
apps/api/app/services/ai/image_prompt_package.py
```

验收：

- AI 结果落库字段不变。
- 任务状态推进不变。

## 阶段 9：AI 外部导入拆分

### T9.1 抽 parser/normalizer

新增：

```text
apps/api/app/services/ai_imports/parser.py
apps/api/app/services/ai_imports/normalizer.py
```

迁移：

- `_parse_external_ai_json`
- `_normalize_headers`
- `_normalize_rows`
- `_stringify_common_fields`
- `_normalize_ai_common_fields`
- `_normalize_ai_rows`

验收：

- 同一份 AI JSON 解析结果不变。

### T9.2 抽 supplement/validator/exporter

新增：

```text
apps/api/app/services/ai_imports/supplement.py
apps/api/app/services/ai_imports/validator.py
apps/api/app/services/ai_imports/exporter.py
```

验收：

- 默认值补齐不覆盖已有字段。
- 导出文件路径和下载 URL 不变。

## 阶段 10：Chrome 插件拆分

最后做，避免影响采集主链路。

### T10.1 抽 DOM 和图片工具

新增：

```text
chrome-extension/lib/dom-utils.js
chrome-extension/lib/image-utils.js
chrome-extension/lib/payload-normalizer.js
```

验收：

- 采集 payload 字段不变。

### T10.2 拆平台 collector

新增：

```text
chrome-extension/collectors/temu.js
chrome-extension/collectors/1688.js
chrome-extension/collectors/generic.js
```

验收：

- Temu、1688、通用页面基础采集不变。

## 推荐第一批任务

建议第一批只做这 5 个：

1. `T0.1` 确认当前可运行基线。
2. `T1.1` 抽取 product-tasks 共享类型。
3. `T1.2` 抽取 product-tasks 纯工具函数。
4. `T1.3` 抽取 product-tasks API 客户端。
5. `T2.1` 抽出 `PromptEditorModal`。

第一批完成后，`product-tasks/page.tsx` 的重复定义和尾部弹窗会明显减少，后续拆抽屉和图片工作台会稳很多。

