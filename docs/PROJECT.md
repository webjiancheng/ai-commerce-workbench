# AI 跨境上架工作台 - 项目说明文档

## 一、项目概述

### 1.1 项目定位

**AI 跨境上架工作台**是一个面向跨境电商运营的本地工作台，核心目标是将"浏览器插件采集商品页面 → 后端入库 → 生成商品任务 → AI 补全信息/类目/标题/图片提示词 → 图片资产管理 → 按 Temu 模板导出 Excel"这一整条链路打通，并优先支持批量操作。

项目强调：
- **本地部署**：方便接浏览器插件、本地截图、本地 Excel 模板
- **批量处理**：面向运营、选品、上架助理，而非纯技术人员
- **字段可追溯**：导出数据可完整回溯到原始采集记录
- **平台适配**：主要面向 Temu，同时兼容 1688 / Amazon / 淘宝 / 天猫 / 拼多多 / SHEIN 等平台

### 1.2 项目一句话总结

把"插件采集 → 原始数据入库 → 商品任务处理 → AI 补全 → 图片资产管理 → Excel 导出"这条链路打通，优先支持批量操作的跨境电商上架工具。

---

## 二、技术栈

### 2.1 前端

| 技术 | 版本 | 用途 |
|------|------|------|
| Next.js | 15 | React 框架，App Router |
| React | 19 | UI 组件库 |
| TypeScript | 5.x | 类型安全 |
| Tailwind CSS | 4 | CSS 样式 |
| react-select | 5.10.2 | 下拉选择组件 |

### 2.2 后端

| 技术 | 版本 | 用途 |
|------|------|------|
| FastAPI | 0.115+ | Python Web 框架 |
| SQLAlchemy | 2.0+ | ORM |
| PostgreSQL | - | 数据库 |
| Pydantic Settings | 2.4+ | 配置管理 |
| OpenAI SDK | 1.0+ | AI 接口调用 |
| OpenPyXL | 3.1+ | Excel 操作 |
| Pillow | 10.4+ | 图片处理 |
| cryptography | 42.0+ | 加密功能 |

### 2.3 浏览器插件

| 技术 | 版本 | 用途 |
|------|------|------|
| Chrome Extension Manifest V3 | - | 插件架构 |
| content.js | - | 页面采集与悬浮面板 |
| popup.js | - | 扩展弹窗采集 |
| background.js | - | 截图、跨域抓取、批量下载 |

---

## 三、项目结构

```
ai-caiji/
├── AGENTS.md                          # AI 续接说明文档（重要）
├── README.md                          # 项目总体说明
├── package.json                       # 根目录 npm 配置
├── apps/
│   ├── api/                           # FastAPI 后端
│   │   ├── pyproject.toml             # Python 项目配置
│   │   ├── .env.example               # 环境变量示例
│   │   ├── .venv/                     # Python 虚拟环境
│   │   └── app/
│   │       ├── main.py                # 应用入口，注册全部路由
│   │       ├── __init__.py
│   │       ├── core/                   # 核心模块
│   │       │   ├── config.py          # 配置管理（AI_CAIJI_ 前缀环境变量）
│   │       │   ├── task_status.py     # 任务状态与生成模式枚举
│   │       │   ├── prompt_types.py    # 提示词类型定义
│   │       │   ├── defaults.py         # 默认值配置
│   │       │   └── crypto.py          # 加密工具
│   │       ├── models/                 # 数据模型（18 个核心表）
│   │       │   ├── raw_product.py      # 原始商品采集数据
│   │       │   ├── product_task.py     # 商品任务
│   │       │   ├── product_ai_result.py # AI 结果
│   │       │   ├── product_asset.py    # 图片资产
│   │       │   ├── image_generation_job.py # 图片生成任务
│   │       │   ├── export_template.py   # 导出模板
│   │       │   ├── export_field_mapping.py # 字段映射
│   │       │   ├── export_field_draft.py # 导出字段草稿
│   │       │   ├── export_batch.py     # 导出批次
│   │       │   ├── export_record.py    # 导出记录
│   │       │   ├── default_rule.py     # 上架默认值规则
│   │       │   ├── prompt_template.py  # 提示词模板
│   │       │   ├── provider_config.py  # Provider 配置
│   │       │   ├── cost_config.py     # 成本配置
│   │       │   ├── cost_record.py      # 成本记录
│   │       │   ├── usage_limit.py      # 使用限制
│   │       │   ├── batch_edit_queue.py # 批量编辑队列
│   │       │   ├── ai_import_batch.py  # AI 导入批次
│   │       │   ├── ai_import_draft.py  # AI 导入草稿
│   │       │   └── listing_template.py # 上架模板
│   │       ├── schemas/                # Pydantic 数据校验模式
│   │       ├── api/                    # API 路由
│   │       │   └── routes/
│   │       │       ├── raw_products.py
│   │       │       ├── product_tasks.py
│   │       │       ├── prompt_templates.py
│   │       │       ├── provider_configs.py
│   │       │       ├── image_jobs.py
│   │       │       ├── default_rules.py
│   │       │       ├── export_fields.py
│   │       │       ├── export_templates.py
│   │       │       ├── export_mappings.py
│   │       │       ├── exports.py
│   │       │       ├── dashboard.py
│   │       │       ├── batch_ops.py
│   │       │       ├── batch_edit.py
│   │       │       ├── exceptions.py
│   │       │       ├── cost_configs.py
│   │       │       ├── settings.py
│   │       │       ├── system_health.py
│   │       │       ├── listing_templates.py
│   │       │       └── health.py
│   │       ├── services/               # 业务逻辑层（核心）
│   │       │   ├── raw_products.py
│   │       │   ├── product_tasks.py
│   │       │   ├── task_bootstrap.py   # 任务创建后异步初始化
│   │       │   ├── ai_pipeline.py      # AI 主流程
│   │       │   ├── image_generation.py # 图片生成
│   │       │   ├── default_rules.py
│   │       │   ├── export_fields.py
│   │       │   ├── export_runner.py    # 导出执行
│   │       │   ├── export_seed.py
│   │       │   ├── export_templates.py
│   │       │   ├── export_template_parser.py
│   │       │   ├── export_mappings.py
│   │       │   ├── ai_imports.py       # AI 外部导入
│   │       │   ├── costing.py
│   │       │   ├── cost_configs.py
│   │       │   ├── usage_limits.py
│   │       │   ├── provider_configs.py
│   │       │   ├── provider_seed.py
│   │       │   ├── prompt_seed.py
│   │       │   ├── prompt_templates.py
│   │       │   ├── category_dictionary.py # 类目字典
│   │       │   ├── task_exceptions.py
│   │       │   ├── exceptions.py
│   │       │   ├── file_storage.py
│   │       │   ├── storage_provider.py
│   │       │   ├── openai_client.py
│   │       │   ├── dimension_extract.py
│   │       │   ├── listing_template_seed.py
│   │       │   ├── listing_default_fields.py
│   │       │   └── image_providers/     # 图片 Provider
│   │       │       ├── base.py
│   │       │       ├── stub_provider.py # Stub 实现
│   │       │       └── registry.py
│   │       ├── db/                     # 数据库相关
│   │       │   ├── base.py
│   │       │   ├── session.py
│   │       │   ├── schema_sync.py
│   │       │   └── init_db.py
│   │       └── data/
│   │           └── default_prompt_templates.json
│   │
│   └── web/                           # Next.js 前端
│       ├── package.json
│       ├── tsconfig.json
│       ├── next.config.ts
│       ├── .eslintrc.json
│       ├── postcss.config.mjs
│       └── src/
│           ├── app/                   # App Router 页面
│           │   ├── layout.tsx         # 根布局
│           │   ├── page.tsx          # 工作台首页
│           │   ├── raw-products/      # 原始采集数据页
│           │   ├── product-tasks/     # 商品任务页
│           │   ├── logs/             # 任务日志页
│           │   ├── prompts/          # 提示词中心
│           │   ├── rules/            # 上架默认值页
│           │   ├── exports/          # 导出中心
│           │   ├── batch-edit/       # 批图队列页
│           │   └── settings/         # 系统设置
│           │       ├── page.tsx      # 设置总览
│           │       ├── ai/           # AI 配置向导
│           │       ├── providers/    # Provider 配置
│           │       └── cost/         # 费用限制配置
│           ├── components/            # 公共组件
│           │   ├── workbench-shell.tsx
│           │   └── hover-zoom-image.tsx
│           └── lib/                   # 工具库
│               ├── api.ts
│               └── local-settings.ts
│
├── chrome-extension/                  # Chrome 采集插件
│   ├── manifest.json                 # Manifest V3 配置
│   ├── content.js                    # 页面内容脚本
│   ├── background.js                 # 后台服务脚本
│   ├── popup.html                   # 弹窗页面
│   ├── popup.js                     # 弹窗逻辑
│   ├── popup.css                    # 弹窗样式
│   ├── platform-collectors.js       # 平台采集器
│   └── icons/                       # 图标资源
│       ├── icon-16.png
│       ├── icon-32.png
│       ├── icon-48.png
│       └── icon-128.png
│
├── docs/                             # 文档目录
│   ├── generation-mode-flow.md       # 生成模式与完整流程（重要）
│   ├── export-template-fields.md     # 导出字段映射文档
│   ├── ai对话.md
│   ├── design-listing-default.md
│   ├── project-dev-ai-handbook.md
│   └── 上架默认值与批量导出功能设计开发文档.md
│
├── scripts/                          # 辅助脚本目录
├── storage/                          # 本地存储目录
│   ├── screenshots/                 # 商品截图
│   └── exports/                      # 导出文件
├── data/                             # 数据文件
│   └── temu_category_review_dict.json # 类目召回字典
├── temu_category_review_dict.json    # 同上（根目录副本）
├── 妙手Temu导入模板-非服饰类模板 .xlsx  # 默认 Temu 导出模板
├── package-lock.json
├── .gitignore
└── .claude/
    └── settings.local.json
```

---

## 四、业务流程

### 4.1 主链路概览

```
Chrome 插件采集商品页
  │
  ├─ POST /sync/screenshot      上传截图
  └─ POST /api/raw-products     写入原始采集数据
        │
        ▼
  保存到 raw_products 表
  ├── 标题 / 价格 / 链接
  ├── 主图 / 轮播图 / SKU图 / 详情图 / 尺寸图候选
  ├── 视频 / 类目路径 / 店铺名
  ├── 属性文本 / SKU文本 / 库存文本
  └── 采集来源 / 采集人 / 截图路径
        │
        ▼
  前端 /raw-products 页面
    → 筛选 / 搜索 / 修正图片分组
    → 单条或批量选中 → 点击"创建任务"
        │
        ▼
  POST /api/raw-products/{id}/create-task
  请求体：{ generation_mode, split_count, image_asset_ids }
        │
        ▼
  后台 BackgroundTasks 异步执行 run_task_bootstrap_pipeline
        │
        ├─ 模式A: task_only / no_ai
        │     → 直接进入 review_ready（不跑 AI）
        │
        ├─ 模式B: title_only
        │     → 跑 AI 流程（商品理解→类目→标题→图提示词）
        │     → 进入 review_ready
        │
        └─ 模式C: title_and_4grid
              → 跑 AI 流程
              → 自动生成四宫格图（选取 4 张，裁剪为正方形）
              → 进入 review_ready
        │
        ▼
  任务状态 = review_ready（AI 结果已生成，四宫格已就位）
        │
        ├─ 路径1：商品任务页面 → 人工检查/修改
        │     ├─ 查看 AI 结果：标题 / 类目 / 图提示词
        │     ├─ [可选] 重新运行 AI
        │     ├─ [可选] 触发图片生成
        │     ├─ [可选] 应用默认值规则
        │     └─ [可选] 执行导出
        │
        └─ 路径2：AI 外部导入 → 独立分支
              ├─ 上传原始 Temu 模板
              ├─ 粘贴外部 AI 输出的 JSON
              ├─ [可选] 修正草稿字段
              └─ 执行导出
```

### 4.2 生成模式详解

代码中定义了 6 个 enum 值，但实际只有 **3 种功能模式**：

| enum 值 | 功能模式 | 说明 |
|---|---|---|
| `task_only` / `no_ai` | **纯任务模式** | 不跑任何 AI，直接到 `review_ready` |
| `title_only` | **标题模式** | 跑 AI 生成标题/类目/图提示词，**不**生成图 |
| `title_and_4grid` / `title_and_image_prompts` / `full_later` | **全量模式** | 跑 AI + 自动生成四宫格图 |

**默认模式**：`title_and_4grid`（最完整的那条路）

> `no_ai`、`title_and_image_prompts`、`full_later` 是历史兼容别名，逻辑上等同于对应的第一列值。

### 4.3 任务状态流转

| main_status | 说明 |
|---|---|
| `collected` | 任务已创建，等待 AI 处理 |
| `ai_running` | AI 流程执行中 |
| `prompts_ready` | AI 提示词已生成 |
| `review_ready` | 可进入人工检查阶段 |
| `image_running` | 图片生成中 |
| `export_ready` | 可导出 |
| `exported` | 已导出 |
| `failed` | 执行失败 |

---

## 五、数据模型

### 5.1 核心数据表

#### raw_products（原始采集层）
- 插件同步上来的原始商品数据
- 保存标题、价格、链接、截图、主图、SKU 图、详情图、尺寸图候选、视频、采集人等
- 关联 image_asset_ids（图片资产 ID 列表）

#### product_tasks（工作任务层）
- 正式进入加工链路的商品任务
- 从 raw_products 复制关键字段并挂载状态机
- 包含 main_status 和各维度子状态

#### product_ai_results（AI 结果层）
- 存放 AI 结构化结果
- 包括 product_info / category_match / title_package / image_prompt_package 等

#### product_assets（图片资产层）
- 图片资产与版本管理
- 包括槽位（preview_1/preview_2/preview_3/carousel_1 等）、版本、来源、是否选为最终导出图

#### image_generation_jobs（图片生成层）
- 生图任务记录与状态
- 状态：pending / processing / done / failed

#### export_field_drafts（导出草稿层）
- 单任务导出字段草稿
- 在导出预览、导出执行、应用默认值等入口触发生成

#### export_templates / export_field_mappings（导出配置层）
- 导出模板定义
- 模板字段映射关系

#### export_batches / export_records（导出记录层）
- 导出批次和导出记录

#### default_rules（规则层）
- 上架默认值规则
- 支持字段级别的默认值填充

#### prompt_templates（提示词层）
- 提示词模板管理
- 用于 AI 商品理解、类目召回、标题生成等

#### provider_configs（Provider 配置层）
- 文本/图片/存储 provider 配置
- 支持多 Provider 切换

#### batch_edit_queue（批量编辑队列）
- 异步图片资产编辑队列
- 支持 operation_type + payload_json
- 状态：queued / processing / done / failed

#### ai_import_batches / ai_import_drafts（AI 外部导入层）
- AI 外部导入批次
- 存储外部 JSON 解析结果、校验警告、导出文件路径
- 状态：uploaded / parsed / confirmed / exported

---

## 六、API 接口

### 6.1 采集与原始数据

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/sync/screenshot` | 上传截图 |
| POST | `/api/raw-products` | 单条同步 |
| POST | `/api/raw-products/batch` | 批量同步 |
| GET | `/api/raw-products` | 列表查询 |
| GET | `/api/raw-products/{id}` | 详情查看 |
| DELETE | `/api/raw-products/{id}` | 删除 |
| POST | `/api/raw-products/{id}/create-task` | 创建任务 |
| POST | `/api/raw-products/batch/create-tasks` | 批量创建任务 |
| POST | `/api/raw-products/batch/delete` | 批量删除 |

### 6.2 商品任务

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/product-tasks` | 列表查询 |
| GET | `/api/product-tasks/{id}` | 详情查看 |
| GET | `/api/product-tasks/{id}/timeline` | 时间线查看 |
| PATCH | `/api/product-tasks/{id}` | 更新任务 |
| POST | `/api/product-tasks/{id}/run-ai` | 重新运行 AI |
| POST | `/api/product-tasks/{id}/generate-titles` | 重新生成标题 |
| POST | `/api/product-tasks/{id}/select-category` | 切换类目 |
| POST | `/api/product-tasks/{id}/apply-default-rules` | 应用默认值 |

### 6.3 图片资产

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/product-tasks/{id}/generate-images` | 生成图片（批量） |
| POST | `/api/product-tasks/{id}/generate-image` | 生成图片（单张） |
| POST | `/api/image-jobs/generate` | 创建图片生成任务 |
| GET | `/api/jobs/{job_id}` | 查询任务状态 |
| GET | `/api/product-tasks/{id}/assets` | 获取图片资产 |
| POST | `/api/assets/{id}/set-final` | 设为最终图 |
| POST | `/api/assets/{id}/regenerate` | 重新生成 |
| POST | `/api/assets/{id}/add-to-batch-edit` | 添加到批量编辑 |
| GET | `/api/batch-edit-queue` | 查看批量编辑队列 |

### 6.4 默认值与导出

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/default-rules` | 列表查询 |
| POST | `/api/default-rules` | 创建规则 |
| GET | `/api/product-tasks/{id}/export-fields/preview` | 导出字段预览 |
| PATCH | `/api/product-tasks/{id}/export-fields` | 修改导出字段 |
| GET | `/api/export-templates` | 获取导出模板 |
| GET | `/api/export-field-mappings` | 获取字段映射 |
| PATCH | `/api/export-field-mappings/{id}` | 修改字段映射 |
| POST | `/api/exports/preview` | 导出预览 |
| POST | `/api/exports/run` | 执行导出 |
| GET | `/api/exports/history` | 导出历史 |

### 6.5 AI 外部导入

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/exports/ai-imports/upload-template` | 上传原始模板 |
| POST | `/api/exports/ai-imports/parse` | 解析外部 AI JSON |
| GET | `/api/exports/ai-imports` | 批次列表 |
| GET | `/api/exports/ai-imports/{batch_id}` | 草稿详情 |
| PATCH | `/api/exports/ai-imports/{batch_id}/draft` | 修改草稿 |
| POST | `/api/exports/ai-imports/{batch_id}/export` | 执行导出 |

### 6.6 其他接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/dashboard` | 工作台数据 |
| GET | `/api/prompt-templates` | 提示词模板 |
| GET | `/api/provider-configs` | Provider 配置 |
| GET | `/api/cost-configs` | 成本配置 |
| GET | `/api/health` | 健康检查 |
| GET | `/api/system-health` | 系统健康状态 |

---

## 七、前端页面

| 页面 | 路径 | 说明 |
|------|------|------|
| 工作台 | `/` | 首页概览 |
| 原始采集数据 | `/raw-products` | 查看采集池、创建任务 |
| 商品任务 | `/product-tasks` | 任务列表、AI 结果查看、图片资产 |
| 任务日志 | `/logs` | 异常排查和低置信度筛查 |
| 提示词中心 | `/prompts` | 管理和渲染提示词模板 |
| 上架默认值 | `/rules` | 管理默认值规则 |
| 导出中心 | `/exports` | 模板、字段映射、导出历史、执行导出 |
| 批图队列 | `/batch-edit` | 批量图片编辑队列 |
| 系统设置 | `/settings` | 设置总览 |
| AI 配置向导 | `/settings/ai` | AI 配置引导 |
| Provider 配置 | `/settings/providers` | Provider 管理 |
| 费用限制 | `/settings/cost` | 成本控制和限额 |

---

## 八、环境配置

### 8.1 后端环境变量

创建 `apps/api/.env` 文件，参考 `.env.example`：

```bash
# 数据库
AI_CAIJI_DATABASE_URL=postgresql+psycopg:///ai_caiji

# 公共地址（用于插件回调）
AI_CAIJI_PUBLIC_BASE_URL=http://127.0.0.1:8000

# 存储根目录
AI_CAIJI_STORAGE_ROOT=./storage

# 默认导出模板路径
AI_CAIJI_DEFAULT_EXPORT_TEMPLATE_PATH=./妙手Temu导入模板-非服饰类模板 .xlsx

# AI 配置（优先级：环境变量 > 服务端默认配置）
AI_CAIJI_OPENAI_API_KEY=sk-...

# CORS
AI_CAIJI_CORS_ORIGINS=http://127.0.0.1:3000

# 其他
AI_CAIJI_OPENAI_VISION_MODEL=gpt-4o
AI_CAIJI_SETTINGS_SECRET_KEY=your-secret-key
```

### 8.2 前端环境变量

```bash
# API 地址（可选，未配置时默认 http://127.0.0.1:8000）
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

---

## 九、启动方式

### 9.1 准备数据库

```bash
createdb ai_caiji
```

### 9.2 启动后端

```bash
cd apps/api
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
uvicorn app.main:app --reload
```

访问：http://127.0.0.1:8000

健康检查：
```bash
curl http://127.0.0.1:8000/health
```

### 9.3 启动前端

```bash
npm install
npm run dev:web
```

访问：http://127.0.0.1:3000

### 9.4 安装 Chrome 插件

1. 打开 Chrome 扩展管理页
2. 开启开发者模式
3. 加载已解压的扩展程序
4. 选择仓库里的 `chrome-extension/` 目录

---

## 十、存储与文件

### 10.1 本地存储目录

- **截图目录**：`storage/screenshots/`
- **导出目录**：`storage/exports/`
- **本地静态资源**：后端通过 `/storage` 路由暴露

### 10.2 默认文件

- **默认 Excel 模板**：`妙手Temu导入模板-非服饰类模板 .xlsx`
- **类目字典**：`temu_category_review_dict.json` / `data/temu_category_review_dict.json`

---

## 十一、启动后自动做的事

后端启动时会自动：

1. 初始化表结构（通过 `init_db()`）
2. 补齐阶段性 schema
3. 写入默认提示词模板（通过 `prompt_seed.py`）
4. 写入默认 Provider 配置（通过 `provider_seed.py`）
5. 尝试加载默认 Temu Excel 模板并生成字段映射（通过 `export_seed.py`）

---

## 十二、开发建议

### 12.1 适合先做的事

1. 在"供应商配置"里配置默认文本 provider，验证 AI 商品理解、类目、标题包链路
2. 在"任务日志"页验证异常筛选和低置信度类目排查链路
3. 补一条批量跑 AI 的后端接口，而不是前端循环提交
4. 补更多任务状态统计和导出前校验项
5. 给图片链路增加参考图选择、尺寸图确认流、版本回滚

### 12.2 当前限制

- 批量操作里有一部分仍是前端循环调用单条接口
- 浏览器插件采集质量取决于站点 DOM 结构，平台变动时需要更新选择器
- 图片生成当前默认可走 stub provider
- 导出模板依赖本地 Excel 模板文件存在
- 部分页面已经业务化，但仍有继续美化和收口空间

---

## 十三、相关文档

| 文档 | 说明 |
|------|------|
| `README.md` | 项目整体说明和使用指南 |
| `AGENTS.md` | AI 续接说明文档，项目上下文入口 |
| `docs/generation-mode-flow.md` | 三种生成模式与完整流程详解 |
| `docs/export-template-fields.md` | 导出字段 source_path 映射 |
| `docs/ai对话.md` | AI 对话记录 |
| `docs/design-listing-default.md` | 上架默认值设计文档 |
| `docs/project-dev-ai-handbook.md` | 项目开发 AI 手册 |

---

## 十四、验证命令

### 前端

```bash
npm run build:web    # 构建
npm run lint:web     # 代码检查
```

### 后端

```bash
python3 -m py_compile apps/api/app/api/routes/raw_products.py
python3 -m py_compile apps/api/app/services/export_runner.py
```