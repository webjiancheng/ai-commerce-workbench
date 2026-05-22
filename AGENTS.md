# AI 跨境上架工作台 项目续接说明

## 1. 项目一句话
这是一个面向跨境电商运营的本地工作台，核心目标是把“浏览器插件采集商品页面 -> 后端入库 -> 生成商品任务 -> AI 补全信息/类目/标题/图片提示词 -> 图片资产管理 -> 按 Temu 模板导出 Excel”这一条链路打通，并优先支持批量处理。

## 2. 项目定位
- 不是重型 ERP。
- 是给运营、选品、上架助理使用的批量上架加工工具。
- 默认本地部署，方便接浏览器插件、本地截图、本地 Excel 模板。
- 当前平台语境明显偏 `Temu`，但采集插件也兼容 `1688 / Amazon / 淘宝 / 天猫 / 拼多多 / SHEIN` 等页面的基础采集。

## 3. 当前仓库结构
```text
.
├── AGENTS.md                    当前文件，建议作为 AI 续接上下文入口
├── README.md                    面向项目整体的说明
├── apps/
│   ├── api/                     FastAPI 后端
│   └── web/                     Next.js 管理后台
├── chrome-extension/            Chrome 采集插件（Manifest V3）
├── docs/                        流程和模板字段文档
├── scripts/                     临时/辅助脚本
├── storage/                     本地存储目录（截图、导出文件、静态资源）
├── temu_category_review_dict.json 类目召回相关大字典/数据文件
└── 妙手Temu导入模板-非服饰类模板 .xlsx  默认 Temu 导出模板
```

## 4. 技术栈
### 前端
- `Next.js 15`
- `React 19`
- `TypeScript`
- `Tailwind CSS 4`

### 后端
- `FastAPI`
- `SQLAlchemy 2`
- `PostgreSQL`
- `Pydantic Settings`
- `OpenAI Python SDK`
- `OpenPyXL`
- `Pillow`
- `cryptography`

### 插件
- `Chrome Extension Manifest V3`
- `content.js` 负责页面采集
- `background.js` 负责截图、抓文本、下载图片
- `popup.js` 负责弹窗交互与同步

## 5. 业务主链路
```text
商品详情页
  -> Chrome 插件采集标题/价格/图片/视频/截图/属性
  -> POST /sync/screenshot 上传截图
  -> POST /api/raw-products 写入 raw_products
  -> 在前端“原始采集数据”页筛选、拆分、修正图片
  -> 单条或批量创建 product_tasks
  -> 后台 bootstrap 异步执行 AI 流程
     -> 商品理解
     -> 类目召回
     -> 标题包生成
     -> 图片提示词包生成（按模式决定）
  -> 任务进入 review_ready，供人工检查
  -> 按需触发图片生成 / 默认值补齐 / 导出字段预览
  -> POST /api/exports/run 导出 Excel
```

## 6. 当前真实实现状态
### 已经存在并可见的前端页面
- `/` 工作台首页
- `/raw-products` 原始采集数据
- `/product-tasks` 上架加工工作台
- `/logs` 任务日志（实际上复用商品任务页）
- `/prompts` 提示词中心
- `/rules` 上架默认值
- `/exports` 导出中心
- `/batch-edit` 批图队列
- `/settings` 系统设置总览
- `/settings/ai` AI 配置向导
- `/settings/providers` Provider 配置
- `/settings/cost` 费用限制配置

### 后端已经接入的主要路由分组
- `raw_products`
- `product_tasks`
- `prompt_templates`
- `provider_configs`
- `image_jobs`
- `default_rules`
- `export_fields`
- `export_templates`
- `export_mappings`
- `exports`
- `exceptions`
- `dashboard`
- `batch_ops`
- `batch_edit`
- `cost_configs`
- `settings`
- `system_health`
- `health`

### 文档与代码的偏差
- `apps/api/README.md` 仍在讲“phase-2”，但代码里的 `current_phase` 默认值已经是 `phase-5`。
- 一些 README 描述仍偏“最小实现”，但当前前后端实际已经扩展到任务日志、导出中心、提示词中心、批图队列、费用控制、异常管理等。
- 如果说明文档和代码冲突，应优先相信源码，其次参考 `docs/`。

## 7. 关键数据模型理解
### 原始采集层
- `raw_products`
  - 插件同步上来的原始商品数据。
  - 保存标题、价格、链接、截图、主图、SKU 图、详情图、尺寸图候选、视频、采集人等。

### 工作任务层
- `product_tasks`
  - 正式进入加工链路的商品任务。
  - 从 `raw_products` 复制关键字段并挂载状态机。

### AI 结果层
- `product_ai_results`
  - 存放 AI 结构化结果。
  - 包括 `product_info / category_match / title_package / image_prompt_package` 等。

### 图片层
- `image_generation_jobs`
  - 生图任务记录与状态。
- `product_assets`
  - 图片资产与版本管理。
  - 包括槽位、版本、来源、是否选为最终导出图等。

### 导出层
- `export_templates`
  - 导出模板。
- `export_field_mappings`
  - 模板字段映射关系。
- `export_field_drafts`
  - 单任务导出字段草稿。
- `export_batches / export_records`
  - 导出批次和导出记录。

### 规则与配置层
- `default_rules`
  - 上架默认值规则。
- `prompt_templates`
  - 提示词模板。
- `provider_configs`
  - 文本/图片/存储 provider 配置。
- `cost_config / cost_record / usage_limit`
  - 成本控制与限额相关。

## 8. 商品任务生成的真实行为
基于 `docs/generate-task-backend-flow.md` 和现有代码，当前“生成任务”后的后台行为如下：

1. 创建一条 `product_tasks` 记录。
2. 异步执行 bootstrap。
3. bootstrap 默认执行 AI 流程：
   - `product_info_from_screenshot`
   - `category_match`（当前更偏代码召回，而不是纯 LLM 选类）
   - `title_package`
   - `image_prompt_package`（取决于模式）
4. 成功后把任务推进到 `review_ready`。

### 目前不会在创建任务时自动做的事
- 不会自动生成导出字段草稿。
- 不会自动触发四宫格生图。

### 这些动作是按需触发的
- 导出字段草稿：在导出预览、导出执行、应用默认值等入口触发。
- 图片生成：在图片接口或批图入口显式触发。

## 9. 任务状态理解
### `product_tasks.main_status` 常见值
- `collected`
- `ai_running`
- `prompts_ready`
- `review_ready`
- `image_running`
- `export_ready`
- `exported`
- `failed`

### 子状态常见维度
- `category_status`
- `title_status`
- `image_prompt_status`
- `image_status`
- `export_status`

### 异常排查字段
- `exception_status`
- `exception_level`
- `last_error_message`
- `exception_reasons_json`
- `exception_updated_at`

如果任务链路异常，优先看这几个字段，再去查 `product_ai_results` 是否真实落库。

## 10. 前端当前职责
### `apps/web` 整体特征
- 单独工作区包，根目录通过 `npm run dev:web` 启动。
- 使用 App Router。
- API 地址默认走 `NEXT_PUBLIC_API_BASE_URL`，未配置时默认 `http://127.0.0.1:8000`。
- UI 已明显业务化，不是 demo 风格。

### 关键页面职责
- `raw-products`
  - 查看采集池。
  - 看详情。
  - 手工修正图片分组。
  - 创建单任务或批量任务。
- `product-tasks`
  - 任务列表、状态查看、AI 结果查看、时间线查看。
  - 图片资产、导出草稿、原始数据联动查看。
- `logs`
  - 复用任务页，但定位是偏排查和异常筛查。
- `rules`
  - 管理默认值规则。
  - 已内置 Temu 常见字段模板草稿。
- `prompts`
  - 管理和渲染提示词模板。
- `exports`
  - 看模板、字段映射、导出历史、执行导出。
- `settings`
  - 汇总 provider、存储、导出模板、费用控制、系统健康状态。

## 11. 后端当前职责
### 入口
- `apps/api/app/main.py`
  - 注册全部路由。
  - 启动时执行 `init_db()`。
  - 挂载 `/storage` 静态目录。

### 配置
- `apps/api/app/core/config.py`
  - 使用 `AI_CAIJI_` 前缀读取环境变量。
  - 默认数据库是 `postgresql+psycopg:///ai_caiji`。
  - 默认存储根目录是仓库下的 `storage/`。
  - 默认导出模板是仓库根目录那份 Temu xlsx。

### 核心 service 分层
- `raw_products.py`
  - 原始商品的入库、查询、编辑。
- `product_tasks.py`
  - 从原始商品创建任务、状态推进、时间线数据。
- `task_bootstrap.py`
  - 创建任务后的异步初始化流程。
- `ai_pipeline.py`
  - 商品理解、类目、标题、图片提示词主链路。
- `image_generation.py`
  - 图片 prompt 解析、任务创建、图片生成。
- `default_rules.py`
  - 默认值规则应用。
- `export_fields.py`
  - 单任务导出字段草稿生成。
- `export_runner.py`
  - 导出执行、批次落库、文件输出。
- `export_seed.py / prompt_seed.py / provider_seed.py`
  - 初始化种子数据。
- `category_dictionary.py`
  - 类目字典和召回逻辑。
- `task_exceptions.py / exceptions.py`
  - 异常收敛和排查。
- `costing.py / cost_configs.py / usage_limits.py`
  - 成本、额度、限制逻辑。

### 图片 provider
当前能明确看到：
- `image_providers/stub_provider.py`

说明：图片链路允许 stub 跑通流程，未必已经接好真实生产 provider。

## 12. Chrome 插件当前能力
### 文件
- `manifest.json`
- `content.js`
- `background.js`
- `platform-collectors.js`
- `popup.html / popup.js / popup.css`

### 已知行为
- 通过 content script 在商品详情页抓取：
  - 标题
  - 当前价 / 原价
  - 主图 / 轮播图
  - SKU 图
  - 详情图
  - 尺寸图候选
  - 视频
  - 类目路径
  - 店铺名
  - 属性文本
  - SKU 文本
  - 库存文本
- 可调用 background 截当前页可见区域截图。
- 可下载图片到本地文件夹。
- 支持通过 popup 或页面注入面板两种方式操作。
- 对不同平台有不同解析策略，`Temu` 和 `1688` 处理更重。

## 13. 默认运行方式
### 根目录前端
```bash
npm install
npm run dev:web
```
访问：`http://127.0.0.1:3000`

### 后端
```bash
cd apps/api
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
uvicorn app.main:app --reload
```
访问：`http://127.0.0.1:8000`

### 数据库
默认：
```text
postgresql+psycopg:///ai_caiji
```

创建数据库示例：
```bash
createdb ai_caiji
```

## 14. 当前关键环境变量
参考 `apps/api/.env.example`：
- `AI_CAIJI_DATABASE_URL`
- `AI_CAIJI_PUBLIC_BASE_URL`
- `AI_CAIJI_STORAGE_ROOT`
- `AI_CAIJI_DEFAULT_EXPORT_TEMPLATE_PATH`
- `AI_CAIJI_OPENAI_API_KEY`
- `AI_CAIJI_CORS_ORIGINS`
- `AI_CAIJI_OPENAI_VISION_MODEL`
- `AI_CAIJI_SETTINGS_SECRET_KEY`

前端常用：
- `NEXT_PUBLIC_API_BASE_URL`

## 15. 本地文件与存储约定
- 截图目录：`storage/screenshots/`
- 导出目录：`storage/exports/`
- 本地静态挂载：后端通过 `/storage` 暴露
- 默认 Excel 模板缺失时，导出模板种子初始化不会完整成功

## 16. 对 AI 续接最重要的事实
### 先看哪里
如果重新接手这个项目，优先阅读顺序建议：
1. `README.md`
2. `AGENTS.md`
3. `docs/generate-task-backend-flow.md`
4. `apps/api/app/main.py`
5. `apps/api/app/services/`
6. `apps/web/src/app/product-tasks/page.tsx`
7. `apps/web/src/app/raw-products/page.tsx`
8. `chrome-extension/content.js`

### 需要牢记的判断
- 这是“本地工作台 + 插件 + Excel 导出”的项目，不是纯 SaaS 后台。
- 主链路核心是“原始采集 -> 商品任务 -> AI -> 图片/导出”。
- 任务创建后不会自动触发所有后续动作，很多步骤已经改成按需触发。
- 文档存在滞后，遇到冲突优先看源码。
- 当前实现已经包含不少业务功能，不应再把它当成只有 raw-products 列表页的早期 demo。

## 17. 当前可预见的风险点
- 插件采集质量依赖页面 DOM，平台改版后容易失效。
- 图片生成默认可能仍依赖 stub provider，真实生产 provider 能力要单独确认。
- 导出强依赖本地 Excel 模板存在。
- 文档与代码存在阶段差异，改动时要以当前源码为准。
- 仓库里有 `.next/`、`node_modules/` 等本地产物，做搜索时要尽量避开噪音目录。

## 18. 适合继续扩展的方向
- 增强批量任务接口，减少前端循环调单条接口。
- 补更多导出前校验。
- 优化图片版本回滚、参考图选择、尺寸图确认流。
- 强化异常排查面板和低置信度类目处理流程。
- 继续收敛 provider 配置、成本控制和健康检查的一致性。

## 19. 这份文件的用途
这份 `AGENTS.md` 不是给终端用户看的产品文案，而是给重新接手项目的人或 AI 用的“快速恢复上下文说明”。

目标是让新的上下文在几分钟内理解：
- 这个项目是做什么的
- 当前代码已经做到哪一步
- 关键目录和模块分别负责什么
- 主链路在哪里
- 哪些文档可信，哪些可能已经过时
