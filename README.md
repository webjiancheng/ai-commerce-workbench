# AI 跨境上架工作台

一个面向跨境电商运营的本地工作台。核心目标不是做复杂 ERP，而是把 `插件采集 -> 原始数据入库 -> 商品任务处理 -> AI 补全 -> 图片资产管理 -> Excel 导出` 这一条链路打通，并且优先支持批量操作。

## 项目定位

- 面向 Temu 等跨境平台的上架准备工作
- 面向运营、选品、助理，而不是纯技术人员
- 强调批量处理效率、字段可追溯、图片可管理、导出可落地
- 默认本地部署，方便接浏览器插件和本地 Excel 模板

## 当前能力

### 已打通的主链路

1. Chrome 插件从商品详情页采集标题、价格、主图、SKU 图、详情图、尺寸图候选、视频、截图
2. 采集结果同步到后端原始采集池 `raw_products`
3. 原始采集数据可手动筛选，并批量生成商品任务 `product_tasks`
4. 商品任务创建后会自动完成商品理解、类目召回、标题包、图片提示词包
5. 商品任务支持任务日志排查、图片生成、图片版本管理、最终图选择
6. 按 Temu 模板映射导出 Excel，并保留导出批次记录

### 后台主要页面

- `工作台`
- `原始采集数据`
- `商品任务`
- `任务日志`
- `上架默认值`
- `提示词中心`
- `导出中心`
- `系统设置`
- `批图队列`

## 整体流程

```text
Chrome 插件采集页面
  -> /sync/screenshot 上传截图
  -> /api/raw-products 写入原始采集数据
  -> 后台原始采集数据页筛选/删除/批量生成任务
  -> /api/raw-products/{id}/create-task 或批量接口
  -> 后台 bootstrap 自动跑 AI 商品理解/类目/标题包/图片提示词包
  -> 商品任务页或任务日志页排查结果
  -> 按需生成图片 / 设定最终图
  -> 按需应用默认值规则
  -> /api/exports/preview
  -> /api/exports/run
  -> 导出 Excel
```

## 仓库结构

```text
chrome-extension/    浏览器采集插件
apps/api/            FastAPI 后端
apps/web/            Next.js 后台前端
docs/                模板字段等文档
storage/             截图、导出文件、本地静态资源
```

## 技术栈

### 前端

- Next.js 15
- React 19
- Tailwind CSS 4

### 后端

- FastAPI
- SQLAlchemy 2
- PostgreSQL
- Pydantic Settings
- OpenPyXL
- Pillow

### 插件

- Chrome Extension Manifest V3
- `content.js` 页面采集与悬浮操作面板
- `popup.js` 扩展弹窗式采集和纠错
- `background.js` 抓图、跨域抓文本、批量下载

## 数据模型概览

- `raw_products`
  采集插件同步过来的原始商品数据
- `product_tasks`
  正式进入工作流的商品任务
- `product_ai_results`
  AI 生成的类目、标题、描述、DNA 等结果
- `product_assets`
  图片资产，包括四宫格母图、轮播图、预览图、尺寸图
- `image_generation_jobs`
  图片生成任务与进度
- `default_rules`
  上架默认值规则
- `export_field_drafts`
  导出字段草稿
- `export_templates`
  导出模板
- `export_field_mappings`
  导出字段映射
- `export_batches` / `export_records`
  导出批次与导出记录

## 插件采集说明

### 采集内容

- 标题
- 当前价格 / 原价
- 平台
- 原始链接
- 来源 ID / 平台 SKU
- 主图 / 轮播图
- SKU 图
- 详情图
- 尺寸图候选
- 视频
- 页面截图
- 采集人

### 支持的同步方式

- 扩展弹窗 `popup.js`
- 页面悬浮采集面板 `content.js`

这两条路径现在都会把 `collector` 一并写入后端，避免出现同一商品由不同入口采集时字段不一致。

## 启动方式

### 1. 准备数据库

```bash
createdb ai_caiji
```

默认数据库连接：

```text
postgresql+psycopg:///ai_caiji
```

如需修改，可通过环境变量：

```bash
export AI_CAIJI_DATABASE_URL='postgresql+psycopg:///your_db'
```

### 2. 启动后端

```bash
cd apps/api
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
uvicorn app.main:app --reload
```

默认地址：

```text
http://127.0.0.1:8000
```

健康检查：

```bash
curl http://127.0.0.1:8000/health
```

### 3. 启动前端

```bash
npm install
npm run dev:web
```

默认地址：

```text
http://127.0.0.1:3000
```

### 4. 安装 Chrome 插件

1. 打开 Chrome 扩展管理页
2. 开启开发者模式
3. 加载已解压的扩展程序
4. 选择仓库里的 `chrome-extension/`
5. 在插件弹窗中确认本地服务地址，默认是 `http://127.0.0.1:8000`

## 启动后会自动做的事

后端启动时会自动：

- 初始化表结构
- 补齐阶段性 schema
- 写入默认提示词模板
- 写入默认 Provider 配置
- 尝试加载默认 Temu Excel 模板并生成字段映射

当前 AI 运行时配置优先级：

1. 服务端默认 `text provider`
2. 环境变量 `AI_CAIJI_OPENAI_API_KEY / OPENAI_API_KEY`

也就是说，生产链路不再只依赖 `.env`。

## 默认文件与存储

- 截图目录：`storage/screenshots/`
- 导出目录：`storage/exports/`
- 默认 Excel 模板：
  `妙手Temu导入模板-非服饰类模板 .xlsx`

如果默认模板文件不存在，导出模板能力不会自动完成种子初始化。

## 常用接口

### 采集与原始数据

- `POST /sync/screenshot`
- `POST /api/raw-products`
- `GET /api/raw-products`
- `GET /api/raw-products/{id}`
- `DELETE /api/raw-products/{id}`
- `POST /api/raw-products/batch/create-tasks`
- `POST /api/raw-products/batch/delete`

### 商品任务

- `POST /api/raw-products/{id}/create-task`
- `GET /api/product-tasks`
- `GET /api/product-tasks/{id}`
- `GET /api/product-tasks/{id}/timeline`
- `PATCH /api/product-tasks/{id}`
- `POST /api/product-tasks/{id}/run-ai`

### 图片资产

- `POST /api/product-tasks/{id}/generate-images`
- `POST /api/product-tasks/{id}/generate-image`
- `GET /api/jobs/{job_id}`
- `GET /api/product-tasks/{id}/assets`
- `POST /api/assets/{id}/set-final`
- `POST /api/assets/{id}/regenerate`
- `POST /api/product-tasks/{id}/dimension-extract`

### 默认值与导出

- `GET /api/default-rules`
- `POST /api/default-rules`
- `POST /api/product-tasks/{id}/apply-default-rules`
- `GET /api/product-tasks/{id}/export-fields/preview`
- `PATCH /api/product-tasks/{id}/export-fields`
- `GET /api/export-templates`
- `GET /api/export-field-mappings`
- `PATCH /api/export-field-mappings/{id}`
- `POST /api/exports/preview`
- `POST /api/exports/run`
- `GET /api/exports/history`

## 开发建议

### 适合先做的事

- 在“供应商配置”里配置默认文本 provider，验证 AI 商品理解、类目、标题包链路
- 在“任务日志”页验证异常筛选和低置信度类目排查链路
- 补一条批量跑 AI 的后端接口，而不是前端循环提交
- 补更多任务状态统计和导出前校验项
- 给图片链路增加参考图选择、尺寸图确认流、版本回滚

### 当前限制

- 批量操作里有一部分仍是前端循环调用单条接口
- 浏览器插件采集质量取决于站点 DOM 结构，平台变动时需要更新选择器
- 图片生成当前默认可走 stub provider
- 导出模板依赖本地 Excel 模板文件存在
- 部分页面已经业务化，但仍有继续美化和收口空间

## 验证命令

前端构建和检查：

```bash
npm run build:web
npm run lint:web
```

后端基础语法检查：

```bash
python3 -m py_compile apps/api/app/api/routes/raw_products.py
python3 -m py_compile apps/api/app/services/export_runner.py
```

## 适合谁使用

- 跨境电商运营
- 选品助理
- 商品上架专员
- 需要把插件采集结果快速整理成平台导入表格的小团队
