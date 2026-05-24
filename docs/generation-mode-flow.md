# 原始采集 → 商品任务：生成模式与完整流程

## 1. 三种生成模式的本质区别

代码里有 6 个 enum 值，但实际只有 **3 种功能模式**：

| enum 值 | 功能模式 | 说明 |
|---|---|---|
| `task_only` / `no_ai` | **纯任务模式** | 不跑任何 AI，直接到 `review_ready` |
| `title_only` | **标题模式** | 跑 AI 生成标题/类目/图提示词，**不**生成图 |
| `title_and_4grid` / `title_and_image_prompts` / `full_later` | **全量模式** | 跑 AI + 自动生成四宫格图 |

**默认模式**：`title_and_4grid`（最完整的那条路）

> `no_ai`、`title_and_image_prompts`、`full_later` 是历史兼容别名，前端不必显示它们，逻辑上等同于对应的第一列值。

---

## 2. 完整主链路（插件采集 → 任务创建 → bootstrap）

```
插件采集商品页（1688 / Amazon / 淘宝 / 天猫 / 拼多多 / SHEIN / Temu）
  │
  ├─ POST /api/raw-products          单条同步（popup 触发）
  └─ POST /api/raw-products/batch   批量同步（content script 触发）
        │
        ▼
  保存到 raw_products 表
  ├── 标题 / 当前价 / 原价 / 链接
  ├── 主图 / 轮播图 / SKU图 / 详情图 / 尺寸图候选
  ├── 视频 / 类目路径 / 店铺名
  ├── 属性文本 / SKU文本 / 库存文本
  ├── 采集来源 / 采集人 / 截图路径
  └── image_asset_ids（关联的 ProductAsset ID 列表）
        │
        ▼
  前端 /raw-products 页面
    → 筛选 / 搜索
    → 修正图片分组（可选）
    → 单条或批量选中
    → 点击"创建任务"
        │
        ▼
  POST /api/raw-products/{raw_product_id}/create-task
  请求体：
  {
    "generation_mode": "title_and_4grid",   // 默认值
    "split_count": 1,                        // 每条 raw 拆成 N 个 task
    "image_asset_ids": []                    // 可选，手动指定关联的图片资产
  }
  请求头（可选，覆盖运行时 AI 配置）：
  {
    "X-AI-API-Key": "sk-...",
    "X-AI-Base-Url": "https://api.openai.com",
    "X-AI-Model": "gpt-4o"
  }
        │
        ▼
  ┌─ generation_mode in {task_only, no_ai}
  │     → ✅ 跳过 AI Key 检查，直接进入 bootstrap
  │
  └─ generation_mode in {title_only, title_and_4grid, ...}（需要 AI）
        → 检查 session 中是否有可用文本类 provider
        → 或使用 header 覆盖
        → 未配置 → HTTP 409 "AI 文本模型 API Key 未配置..."
        → 已配置 → 继续
        │
        ▼
  写入 product_tasks 表（main_status = collected）
        │
        ▼
  BackgroundTasks 异步执行 run_task_bootstrap_pipeline
  bootstrap 内部根据 generation_mode 走不同分支
```

---

## 3. Bootstrap 三条分支（task_bootstrap.py 核心逻辑）

```
run_task_bootstrap_pipeline(session, task_id)
  │
  ├─ 模式A: task_only / no_ai
  │     │
  │     ▼
  │   task.main_status = "review_ready"
  │   （不触发任何 AI，直接进入人工检查阶段）
  │
  ├─ 模式B: title_only
  │     │
  │     ▼
  │   run_ai_pipeline_for_task(session, task_id)
  │     ├─ product_info_from_screenshot   商品理解
  │     ├─ category_match                  类目召回
  │     ├─ title_package                  标题包生成
  │     └─ image_prompt_package           图片提示词包
  │     │
  │     ▼
  │   task.main_status = "review_ready"
  │   （不触发四宫格，停在 AI 结果待检查状态）
  │
  └─ 模式C: title_and_4grid / title_and_image_prompts / full_later
        │
        ▼
      run_ai_pipeline_for_task(session, task_id)
        ├─ product_info_from_screenshot
        ├─ category_match
        ├─ title_package
        └─ image_prompt_package
        │
        ▼
      auto_generate_and_crop_4grid_for_task(session, task=task)
        ├─ 从原始图片（carousel 图）中选取 4 张
        ├─ 按比例裁剪为正方形
        └─ 存为 4 个 product_assets
            → preview_1（主预览图）
            → preview_2 / preview_3（素材图）
            → carousel_1（轮播图第1张）
        │
        ▼
      task.main_status = "review_ready"
```

---

## 4. 任务到达 `review_ready` 之后：两条后续路径

```
任务状态 = review_ready（AI 结果已生成，四宫格已就位）
  │
  ├─ 路径1：商品任务页面（/product-tasks）→ 人工检查/修改
  │     │
  │     ├─ 查看 AI 结果：标题 / 类目 / 图提示词
  │     ├─ [可选] 重新运行 AI（POST /run-ai）
  │     ├─ [可选] 重新生成标题（POST /generate-titles）
  │     ├─ [可选] 切换类目（POST /select-category）
  │     ├─ [可选] 手动调整图片资产
  │     ├─ [可选] 触发图片生成（POST /api/image-jobs/generate）
  │     └─ [可选] 执行导出（POST /api/exports/run）
  │
  └─ 路径2：AI 外部导入（/exports 页）→ 独立分支
        │
        ├─ 上传原始 Temu 模板
        │     POST /api/exports/ai-imports/upload-template
        ├─ 粘贴外部 AI 输出的 JSON
        │     POST /api/exports/ai-imports/parse
        │     └── 解析：headers / rows / common_fields + 校验
        ├─ [可选] 修正草稿字段
        │     PATCH /api/exports/ai-imports/{batch_id}/draft
        └─ 执行导出
              POST /api/exports/ai-imports/{batch_id}/export
              │
              ▼
            输出文件：
            storage/exports/ai-import-export-{batch_id}-{uuid8}.xlsx
```

---

## 5. 各模式状态流转图

```
                    ┌─────────────────┐
                    │   raw_products  │
                    │   （采集完成）   │
                    └────────┬────────┘
                             │ POST /create-task
              ┌──────────────┴──────────────┐
              ▼                              ▼
    ┌────────────────┐              ┌────────────────┐
    │   task_only    │              │  title_only    │
    │   / no_ai      │              │  / title_and   │
    │                │              │  _4grid        │
    └────┬───────────┘              └────┬───────────┘
         │                                │
         ▼                                ▼
   collected(直接)                  collected
         │                                │
         ▼                                ▼
   review_ready                    ai_running
   (无需AI)                        (跑AI流程)
                                          │
                               ┌──────────┴──────────┐
                               ▼                     ▼
                        title_only               title_and_4grid
                        → review_ready           → image_running
                                                  (四宫格生成)
                                                      │
                                                      ▼
                                                 review_ready

  注：路径2（AI外部导入）完全独立，不走 product_tasks 表，
  直接上传模板+JSON，校验后回写 Excel 文件。
```

---

## 6. 为什么 `task_only` 不需要 AI Key

`task_only` 和 `no_ai` 跳过整个 AI 流程：
- 不调用 `run_ai_pipeline_for_task`
- 不调用 `auto_generate_and_crop_4grid_for_task`
- 直接把 `main_status` 设为 `review_ready`

所以即使没有配置任何 provider，任务也能创建成功，适合**人工填写标题/选图**的场景。

---

## 7. 运营操作参考

```
① 确认 AI Key 配置
   ├─ 已配置 → 使用默认的 title_and_4grid（全自动）
   └─ 未配置 → 使用 task_only（纯手动）

② 采集 raw-products（插件同步）
③ /raw-products 页 → 选中 → 创建任务
④ 等待 bootstrap 跑完
   状态变化：collected → ai_running → review_ready
⑤ /product-tasks 页检查 AI 结果
⑥ 按需：手动调图 / 触发图片生成 / 执行导出
```

---

## 8. 相关文件索引

| 文件 | 职责 |
|---|---|
| `apps/api/app/core/task_status.py` | GenerationMode enum 定义 |
| `apps/api/app/services/task_bootstrap.py` | bootstrap 分支逻辑（核心） |
| `apps/api/app/services/ai_pipeline.py` | AI 主流程（商品理解→标题→类目→图提示词） |
| `apps/api/app/services/product_tasks.py` | `create_task_from_raw_product` |
| `apps/api/app/api/routes/product_tasks.py` | 创建任务 API 入口 + AI Key 检查 |
| `apps/api/app/services/ai_imports.py` | AI 外部导入完整流程 |
| `apps/api/app/services/image_generation.py` | 四宫格 + 图片生成 |
| `docs/export-template-fields.md` | 导出字段 source_path 映射 |