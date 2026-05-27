# 前后端拆分与可维护性分析

本文只做现状分析和拆分建议，不涉及业务代码修改。当前仓库已有不少未提交改动，后续重构应尽量小步提交，避免把功能变更和结构调整混在一起。

## 1. 总体判断

当前项目已经从早期 demo 进入业务工作台阶段，但代码组织还停留在“页面/接口先堆起来”的形态。主要问题不是某个函数写得差，而是多个模块同时承担了以下职责：

- 类型定义
- API 请求
- 页面状态管理
- 业务规则判断
- UI 渲染
- 文件/图片处理
- 数据校验
- 导出适配
- 异步任务编排

这会导致两个直接后果：

- 上下文消耗很大：排查一个小问题时，必须把超长文件塞进上下文。
- 风险扩散：改一个按钮、一个字段映射或一个图片槽位规则，容易碰到不相关逻辑。

建议先做“无行为变化”的结构拆分，再做功能优化。

## 2. 前端热点

### 2.1 `apps/web/src/app/product-tasks/page.tsx`

这是当前前端最大维护风险，约 6800 行。它同时包含：

- 商品任务类型、原始采集类型、资产类型、导出字段类型。
- 列表查询、详情查询、时间线查询、行级 meta 查询。
- 批量操作状态与执行逻辑。
- 抽屉状态、抽屉 tab 切换、轮询。
- 表格/卡片视图。
- 图片资产编排、AI 生图、拖拽、上传、替换、删除、重排。
- 日志追踪 tab。
- 商品信息 tab。
- 默认值 tab。
- 原始数据 tab。
- 导出字段 tab。
- 提示词编辑弹窗。

典型症状：

- 同一批类型和工具函数已经在 `components/product-tasks/workbench-table.tsx` 里重复定义了一份。
- 页面里 `useState` 数量过多，列表、抽屉、批量默认值、图片编排状态混在一个组件作用域。
- 图片相关逻辑既有 UI 状态，又直接调用 `/generate-image`、`/assign-image`、`/remove-slot-image` 等接口。
- `/logs` 复用这个页面，但通过 pathname 分支控制行为，进一步放大了条件复杂度。

建议拆分顺序：

1. 抽出共享类型到 `apps/web/src/features/product-tasks/types.ts`。
2. 抽出纯工具到 `apps/web/src/features/product-tasks/utils.ts`，例如状态展示、时间线格式化、图片槽位选择、导出图编排。
3. 抽出 API 客户端到 `apps/web/src/features/product-tasks/api.ts`，统一处理 `fetch`、错误解析和返回类型。
4. 把页面主组件压缩成“数据装配 + 页面布局”，目标控制在 300-500 行。
5. 把抽屉拆成 `TaskDrawer`，再按 tab 拆成 `ImagesTab`、`TraceTab`、`InfoTab`、`DefaultsTab`、`RawDataTab`、`ExportFieldsTab`。
6. 把图片编排继续拆为 `image-workbench/` 目录，单独管理槽位、候选池、灯箱、上传、拖拽和生图操作。

建议目标结构：

```text
apps/web/src/features/product-tasks/
├── api.ts
├── types.ts
├── utils.ts
├── hooks/
│   ├── use-product-task-list.ts
│   ├── use-task-drawer.ts
│   └── use-task-row-meta.ts
├── components/
│   ├── product-tasks-page.tsx
│   ├── task-drawer.tsx
│   ├── review-board.tsx
│   ├── prompt-editor-modal.tsx
│   └── tabs/
│       ├── images-tab.tsx
│       ├── trace-tab.tsx
│       ├── info-tab.tsx
│       ├── defaults-tab.tsx
│       ├── raw-data-tab.tsx
│       └── export-fields-tab.tsx
└── image-workbench/
    ├── api.ts
    ├── slot-utils.ts
    ├── image-slot-card.tsx
    ├── candidate-pool-section.tsx
    ├── image-lightbox.tsx
    └── use-image-assets.ts
```

拆分后的 `app/product-tasks/page.tsx` 只保留：

```tsx
import { ProductTasksPage } from "@/features/product-tasks/components/product-tasks-page";

export default ProductTasksPage;
```

`app/logs/page.tsx` 也可以显式引用同一个 feature 组件，但传入 `mode="logs"`，避免继续依赖 pathname 推断。

### 2.2 `apps/web/src/app/raw-products/page.tsx`

约 1280 行，已经有几个底部子组件，但仍然把采集列表、详情编辑、图片分组、任务创建、任务资产对比放在一个页面内。

建议拆分：

- `features/raw-products/types.ts`
- `features/raw-products/api.ts`
- `features/raw-products/hooks/use-raw-products.ts`
- `features/raw-products/components/raw-product-list.tsx`
- `features/raw-products/components/raw-product-detail-drawer.tsx`
- `features/raw-products/components/image-group-editor.tsx`
- `features/raw-products/components/task-create-panel.tsx`

优先级低于 product-tasks，但很适合第二阶段处理。

### 2.3 `apps/web/src/app/rules/page.tsx`

约 900 行，最大问题是页面内硬编码了大量字段定义和快速模板。字段定义本质是配置数据，不应该和 React 组件混在一起。

建议拆分：

- `features/default-rules/field-definitions.ts`
- `features/default-rules/quick-templates.ts`
- `features/default-rules/types.ts`
- `features/default-rules/api.ts`
- `features/default-rules/components/rule-editor.tsx`
- `features/default-rules/components/rule-list.tsx`

这类拆分风险较低，适合和 product-tasks 类型/API 抽取并行做。

### 2.4 `apps/web/src/app/exports/page.tsx`

约 326 行，不算大，但职责已经开始分叉：

- 固定任务导出。
- 外部 AI JSON 导入。
- 草稿编辑。
- 历史批次。

建议拆成三个 tab 组件：

- `fixed-export-tab.tsx`
- `ai-import-tab.tsx`
- `export-history-tab.tsx`

同时抽出 `buildPrompt`、`parseIds` 和导出相关 API。这个页面是当前打开文件，可以作为低风险试点。

### 2.5 前端全局 API 封装不足

`apps/web/src/lib/api.ts` 目前只有 `apiBaseUrl`。各页面直接写 `fetch`，错误解析、JSON 类型、`cache: "no-store"`、请求头重复散落。

建议新增：

```text
apps/web/src/lib/http.ts
```

提供：

- `apiGet<T>(path)`
- `apiPost<T>(path, body?, options?)`
- `apiPatch<T>(path, body?)`
- `readApiError(response)`

后续 feature API 再基于它封装业务请求。这样能明显减少页面噪音。

## 3. 后端热点

### 3.1 `apps/api/app/api/routes/image_jobs.py`

约 790 行，route 层过重。它不仅定义接口，还处理：

- 图片 URL/local/dataURL 读取。
- 图片尺寸识别。
- provider 解析。
- 生图任务创建。
- 后台任务启动。
- 资产分组查询。
- 资产设为最终图。
- 资产重生成。
- 图片手工分配。
- 轮播图删除和紧凑移动。
- 槽位交换。

建议拆分：

```text
apps/api/app/api/routes/image_jobs.py          # 只保留 HTTP 入参/出参
apps/api/app/services/image_asset_io.py        # URL/dataURL/local storage 读取、尺寸探测
apps/api/app/services/image_job_orchestrator.py# provider 解析、生图 job 创建、后台运行
apps/api/app/services/product_assets.py        # set final、assign、remove、reorder、slot 查询
```

注意：`remove_slot_image_endpoint` 当前会 `session.delete(asset)` 删除数据库记录。根据项目 AGENTS 规则，禁止批量删除文件或目录；这里不是文件删除，但业务上也建议改成软删除/状态标记，保留资产历史和排查线索。

### 3.2 `apps/api/app/services/ai_pipeline.py`

约 1100 行，职责包括：

- OpenAI 调用与 JSON fallback/repair。
- usage/cost 估算。
- prompt 解析与快照。
- 生成步骤依赖计算。
- product_info 归一化。
- title guardrail。
- image prompt package 构建。
- AI 结果落库。
- 任务状态推进。

建议拆分：

```text
apps/api/app/services/ai/
├── client_call.py          # parse/create fallback、JSON repair、usage 提取
├── pricing.py              # token pricing 与 cost 估算
├── step_planner.py         # generation_mode 和 prompt_types 到执行步骤
├── product_info.py         # ProductInfoOutput 与归一化
├── title_generation.py     # 标题相关 schema 与执行
├── image_prompt_package.py # 四宫格/轮播 prompt package 构建
└── pipeline.py             # 对外 run_* 编排入口
```

优先拆纯函数和 schema，最后再拆执行入口。这样行为变化最小。

### 3.3 `apps/api/app/services/export_runner.py`

约 736 行，已经有 adapter 目录，但 `export_runner.py` 仍然承担了太多：

- 导出批次创建与记录落库。
- draft/default rule 应用。
- row 构建。
- 图片字段 fallback。
- 资产尺寸校验。
- 远程媒体 URL 探测。
- 多语言轮播差异校验。
- Excel 写入旧逻辑。

建议拆分：

```text
apps/api/app/services/export/
├── runner.py              # 批次流程
├── row_builder.py         # draft + task + asset -> export row
├── media_fields.py        # 图片/视频字段识别和资产 fallback
├── validators.py          # 导出前校验、远程 URL 探测
└── records.py             # ExportBatch/ExportRecord 写入
```

同时保留 `services/export_runner.py` 作为兼容 facade，避免一次性改全部 import。

### 3.4 `apps/api/app/services/ai_imports.py`

约 770 行，职责包括：

- 批次/draft CRUD。
- 默认值补齐。
- 商品任务数据补齐。
- 模板解析。
- 外部 JSON 解析和归一化。
- 模板校验。
- SPU/SKU 校验。
- Excel 导出。

建议拆分：

```text
apps/api/app/services/ai_imports/
├── repository.py
├── parser.py
├── normalizer.py
├── supplement.py
├── validator.py
└── exporter.py
```

这个模块和导出模板强耦合，拆分时要先加几个低成本回归用例，至少覆盖：

- AI JSON parse。
- headers/rows normalize。
- 默认值补齐不覆盖已有值。
- 校验错误和 warning 合并。

### 3.5 `apps/api/app/services/export_fields.py`

约 645 行，是默认值应用和导出字段草稿的核心。它的复杂度合理但边界不清：

- base fields 构建。
- rule matching。
- field source 写入。
- SKU flatten。
- sensitive linkage。
- missing warnings。

建议先不急着拆执行逻辑，先把规则匹配和字段写入工具抽出来：

- `default_rule_matcher.py`
- `field_source_writer.py`
- `sku_fields.py`
- `listing_warnings.py`

这样可以降低 `product-tasks` 页面默认值 tab 和导出预览排查时的后端上下文成本。

## 4. 插件热点

`chrome-extension/content.js` 约 2950 行，是插件侧最大风险。它应该按职责拆成：

- 平台识别和 collector 调度。
- DOM 提取工具。
- 页面注入面板 UI。
- 消息通信。
- 图片/视频候选归一化。
- Temu/1688 特殊处理。

建议目标结构：

```text
chrome-extension/
├── content.js              # 入口与消息绑定
├── collectors/
│   ├── temu.js
│   ├── 1688.js
│   └── generic.js
├── ui/
│   └── injected-panel.js
├── lib/
│   ├── dom-utils.js
│   ├── image-utils.js
│   └── payload-normalizer.js
└── platform-collectors.js  # 可逐步迁移或保留兼容
```

插件拆分要特别小心 Manifest V3 加载路径，建议最后处理。

## 5. 优先级建议

### P0：先做低风险基础抽取

- 新增前端 `lib/http.ts`。
- 抽出 `product-tasks/types.ts`。
- 抽出 `product-tasks/utils.ts`。
- 消除 `page.tsx` 与 `workbench-table.tsx` 的重复类型和工具函数。

收益最大，风险最低。

### P1：拆 `product-tasks/page.tsx`

先拆 UI 组件，再拆 hooks：

1. `PromptEditorModal`
2. `ReviewBoard`
3. `TaskDrawer`
4. 各个 drawer tab
5. `useProductTaskList`
6. `useTaskDrawer`
7. `useBulkTaskActions`

拆到这里后，日常排查基本不再需要打开 6800 行文件。

### P2：后端图片和导出编排拆分

- `image_jobs.py` route 减肥。
- `export_runner.py` 拆 row builder/media validators。
- 给导出和图片槽位补最小测试。

### P3：AI pipeline 和 AI import 深拆

这两个模块业务风险更高，建议在 P0/P1 完成后做。先拆 schema/纯函数，再拆编排。

### P4：Chrome 插件拆分

插件最依赖真实页面和浏览器环境，建议等主工作台前后端稳定后再拆。

## 6. 不建议现在做的事

- 不建议一次性移动全部页面到 `features/`，会制造大量 import churn。
- 不建议同时改 UI 样式和业务拆分，难排查回归。
- 不建议先上状态管理库。当前更需要的是模块边界和 API 封装，不是全局 store。
- 不建议批量格式化全仓库，会污染 diff。
- 不建议删除已有业务文件；拆分时保留 facade 或逐步迁移。

## 7. 建议验收标准

每一阶段重构都应满足：

- 页面行为不变。
- TypeScript 能通过。
- 后端接口路径不变。
- 关键页面能正常打开。
- 文件职责明显收敛。

建议命令：

```bash
npm run dev:web
cd apps/api
python -m pytest
```

如果后端当前没有稳定测试集，至少对拆到的 service 增加局部单元测试，避免只靠手工点页面。

## 8. 第一轮实际改动建议

第一轮只做前端 product-tasks 的无行为拆分：

1. 新建 `apps/web/src/features/product-tasks/types.ts`。
2. 新建 `apps/web/src/features/product-tasks/utils.ts`。
3. 新建 `apps/web/src/features/product-tasks/api.ts`。
4. 修改 `workbench-table.tsx` 使用共享类型和工具。
5. 修改 `product-tasks/page.tsx` 使用共享类型和工具。

这一步完成后，虽然 `page.tsx` 仍然会很长，但重复定义会先消失，后续拆组件更稳。

