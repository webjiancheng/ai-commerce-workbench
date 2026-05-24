# AI 对话链路代码核实报告

> 核实日期：2026-05-23
> 核实范围：后端 API + 前端页面，重点覆盖 prompt 调用链

---

## 一、三模式归一化核实

### 1.1 后端归一化函数

**文件**：`apps/api/app/services/ai_pipeline.py`
**函数**：`_normalize_generation_mode(mode: str | None) -> str`（第 437-443 行）

```python
def _normalize_generation_mode(mode: str | None) -> str:
    token = str(mode or "").strip()
    if token in {GenerationMode.task_only.value, GenerationMode.no_ai.value}:
        return GenerationMode.task_only.value
    if token == GenerationMode.title_only.value:
        return GenerationMode.title_only.value
    return GenerationMode.title_and_4grid.value
```

| 后端原始值 | 归一化结果 | 触发条件 |
|-----------|-----------|---------|
| `no_ai` | `task_only` | `_normalize_generation_mode` |
| `task_only` | `task_only` | `_normalize_generation_mode` |
| `title_only` | `title_only` | `_normalize_generation_mode` |
| `title_and_image_prompts` | `title_and_4grid` | `_normalize_generation_mode` |
| `full_later` | `title_and_4grid` | `_normalize_generation_mode` |
| `title_and_4grid` | `title_and_4grid` | `_normalize_generation_mode` |

**涉及文件汇总**：
- `apps/api/app/core/task_status.py:71-73` — 枚举定义
- `apps/api/app/services/ai_pipeline.py:437-443` — 归一化函数
- `apps/api/app/services/task_bootstrap.py:17,33-34` — bootstrap 引用
- `apps/api/app/api/routes/raw_products.py:149,155-158` — API 校验引用
- `apps/api/app/api/routes/product_tasks.py:116,122` — API 校验引用
- `apps/api/app/api/routes/settings.py:106` — readiness 校验引用

---

### 1.2 前端 /raw-products

**文件**：`apps/web/src/app/raw-products/page.tsx`
**行号**：78、181-185

```typescript
// 行78 - 类型定义只暴露3个模式
type GenerationMode = "task_only" | "title_only" | "title_and_4grid";

// 行181-185 - getCreateTaskPurposes 函数
function getCreateTaskPurposes(mode: GenerationMode): AiPurpose[] {
  if (mode === "task_only") return ["title"];
  if (mode === "title_only") return ["title_package_lite", "title"];
  return ["image_prompt_package", "title_package", "product_info", "title"];  // title_and_4grid
}
```

**结论**：✅ `/raw-products` 只展示 3 个模式，符合产品口径。

---

### 1.3 前端 /product-tasks

**文件**：`apps/web/src/app/product-tasks/page.tsx`

| 行号 | 问题 |
|------|------|
| 27 | `type GenerationMode = "task_only" \| "title_only" \| "title_and_4grid" \| "no_ai" \| "title_and_image_prompts" \| "full_later";` — 类型暴露历史 enum |
| 4335 | `if (task.generation_mode === "title_and_image_prompts" \|\| task.generation_mode === "full_later")` — 条件分支仍处理历史 enum |
| 4356 | 同上 |
| 4573-4575 | `no_ai` 硬编码在判断条件中 |
| 5449 | 直接渲染 `task.generation_mode` 原始值 |

**结论**：❌ `/product-tasks` 暴露历史 enum，前端需新增归一化映射函数。

---

## 二、prompt 调用链全量核查

### 2.1 `title_package_lite`

| 项目 | 详情 |
|------|------|
| 定义位置 | `apps/api/app/data/default_prompt_templates.json` — prompt_type = `"title_package_lite"` |
| 调用位置 | `apps/api/app/services/ai_pipeline.py:1052-1091` — 函数 `run_ai_pipeline_for_task()` 内 |
| 调用链 | `_normalize_requested_steps()` 返回 `{"title_package"}` → `_expand_wanted_with_dependencies()` → 检测 `title_prompt_type = "title_package_lite"`（仅 `title_only` 模式）→ `_get_prompt()` |
| 触发条件 | `title_only` 模式且无已有输出 |
| 输入 | `raw.title`、`raw.category_path`、`task.selected_category_id`、`product_info`（可选）、`attributes_text`、`sku_text`、`platform` |
| 输出写入 | `product_ai_results.title_package`（JSONB 字段） |
| 后续消费 | 写入 `ProductTask.title`（第 1109 行）；`_build_category_candidates()` 作为类目召回输入（第 1118-1123 行）；`_build_title_category_context()`（第 735-762 行） |
| 前端消费 | `/product-tasks/page.tsx:67, 4433, 5284, 5468` — 读取 `task.ai.title_package` |
| 是否冲突 | ✅ `title_only` 模式正确使用 lite |

**补充说明**：`title_package_lite` 输出后经 `_upgrade_lite_title_package_output()`（第 765-784 行）升级补字段再落库，与 `title_package` 输出结构一致。

---

### 2.2 `title_package`（完整版）

| 项目 | 详情 |
|------|------|
| 定义位置 | `apps/api/app/data/default_prompt_templates.json` — prompt_type = `"title_package"` |
| 调用位置 | **未被直接调用** |
| 实际调用方 | `ai_pipeline.py:1052` 条件：仅当 `normalized_mode != title_only` 时使用，但实际传入的是 `title_package` 字符串（第 1071 行 `title_prompt_type` 变量），该变量由第 1055 行赋值为 `"title_package"`（非 `"title_package_lite"`） |
| 触发条件 | `title_and_4grid` 模式默认步数（第 385 行） |
| 涉及文件 | `apps/api/app/services/ai_pipeline.py:1052-1105` — 条件判断分支 |
| 前端配置 | `/product-tasks/page.tsx:2297, 2299-2302, 3642, 3660, 4412-4436` — 手动触发时传 `"title_package"` |

**结论**：⚠️ `title_package` 在 `title_and_4grid` 模式默认步数中被引用（第 392 行 `title_package_lite` 被映射为 `title_package`），但实际调用模板时用的是字符串 `"title_package"`。这意味着 `title_and_4grid` 实际调用的是完整版 `title_package` 而非 `title_package_lite`。

---

### 2.3 `product_info_from_screenshot`

| 项目 | 详情 |
|------|------|
| 定义位置 | `apps/api/app/data/default_prompt_templates.json` — prompt_type = `"product_info_from_screenshot"` |
| 调用位置 | `apps/api/app/services/ai_pipeline.py:971-998` — `run_ai_pipeline_for_task()` |
| 调用链 | `_normalize_requested_steps()` 返回 `{"product_info"}`（仅 `title_and_4grid`）→ `_expand_wanted_with_dependencies()` 强制加入（428-429 行）→ `_get_prompt(prompt_type="product_info_from_screenshot")` |
| 触发条件 | `title_and_4grid` 且缺少 `product_info` 输出 |
| 输出写入 | `product_ai_results.product_info`（JSONB 字段） |
| 后续消费 | `_build_dynamic_image_prompt_package()`（第 1197-1202 行）；`_build_title_quality_guardrail()`（第 1077-1078 行）；`_build_category_candidates()`（第 790-878 行）；`dimension_extract.py:68-90` |
| 消费字段 | `product_core_v2`、`visual_facts`、`image_generation_basis`、`temu_category_search`、`title_basis`、`dimension_basis` |
| 前端消费 | `/product-tasks/page.tsx:64, 4412-4415, 5222, 5480` |
| 是否冲突 | ⚠️ **越界使用**：`product_info` 同时参与标题护栏（`_build_title_quality_guardrail`）和类目召回（`_build_category_candidates`），超出产品定义的"只服务图片"边界 |

---

### 2.4 `title_en_only`

| 项目 | 详情 |
|------|------|
| 定义位置 | `apps/api/app/data/default_prompt_templates.json` — prompt_type = `"title_en_only"` |
| 调用位置 | `apps/api/app/services/ai_pipeline.py:1005-1049` — `run_ai_pipeline_for_task()` 内 |
| 调用链 | `_normalize_requested_steps()` 返回 `{"title_en_only"}` 时被映射（第 394 行）；`_expand_wanted_with_dependencies()` 强制加入 `product_info`（第 432-433 行） |
| 触发条件 | 手动调用且 prompt_types 含 `title_en_only` |
| 输出写入 | `product_ai_results.title_en`（JSONB 字段） |
| 后续消费 | `product_tasks.py:build_ai_summary()` — 读取 `ai_row.title_en` 作为标题兜底（第 155-196 行） |
| 是否冲突 | ⚠️ 无产品场景触发；前端无直接消费入口 |

---

### 2.5 `image_prompt_package`

| 项目 | 详情 |
|------|------|
| 定义位置 | **无 JSON 定义** — 代码生成 |
| 调用位置 | `apps/api/app/services/ai_pipeline.py:1197-1202` — `_build_dynamic_image_prompt_package()` |
| 调用链 | `_normalize_requested_steps()` 返回 `{"image_prompt_package"}`（`title_and_4grid` 模式）→ `_expand_wanted_with_dependencies()` → 强制加入 `product_info` + `title_package` → `_build_dynamic_image_prompt_package()` |
| 触发条件 | `title_and_4grid` 且无已有 `image_prompt_package` 输出 |
| 输出写入 | `product_ai_results.image_prompt_package`（JSONB 字段），snapshot 写入 `prompt="dynamic_image_prompt_context"`, `model="code.dynamic_image_prompt_context"` |
| 后续消费 | `image_generation.py:resolve_image_prompt()`（第 588-616 行）— 读取 `ai.image_prompt_package` 构建模板变量 |
| 是否冲突 | ✅ 代码生成，非 LLM 调用，符合产品口径 |

**重要**：`image_prompt_package` 的内容是 `slot_contexts` + `shared_context` 字典，用于渲染模板变量，不直接生成图片。

---

### 2.6 `image_prompt_carousel_4grid`

| 项目 | 详情 |
|------|------|
| 定义位置 | `apps/api/app/data/default_prompt_templates.json` — prompt_type = `"image_prompt_carousel_4grid"` |
| 调用位置 | `apps/api/app/services/image_generation.py:628` — `auto_generate_and_crop_4grid_for_task()` |
| 调用链 | `auto_generate_and_crop_4grid_for_task()` → `resolve_image_prompt(session, task, prompt_type="image_prompt_carousel_4grid")` → `resolve_prompt()` 查模板 → `render_template_text()` |
| 触发条件 | `task_bootstrap.py:36` — `title_and_4grid` 模式 bootstrap 完成 AI 管道后调用 |
| 输出写入 | `ImageGenerationJob.prompt_snapshot` + `ImageGenerationJob.final_prompt`（第 79 行） |
| 后续消费 | `run_job()` → `provider.generate_image(prompt=job.final_prompt)` |
| 涉及文件 | `apps/api/app/api/routes/image_jobs.py:147` — 手动触发入口 |
| 是否冲突 | ✅ |

---

### 2.7 `image_prompt_carousel_1~4`

| 项目 | 详情 |
|------|------|
| 定义位置 | `apps/api/app/data/default_prompt_templates.json` — prompt_type = `image_prompt_carousel_1/2/3/4` |
| 调用位置 | `image_generation.py:598` — `resolve_image_prompt(effective_prompt_type)` |
| 调用链 | `resolve_image_prompt()` → `resolve_prompt()` → `render_template_text()` |
| 触发条件 | 手动触发生图或从四宫格裁切后手动重生成 |
| 输出写入 | `ImageGenerationJob.final_prompt` |
| 后续消费 | `run_job()` → `provider.generate_image()` |
| 前端入口 | `/product-tasks/page.tsx:2299, 2302, 3660` — 手动出图按钮 |
| 是否冲突 | ✅ |

---

### 2.8 `image_prompt_dimension`

| 项目 | 详情 |
|------|------|
| 定义位置 | `apps/api/app/data/default_prompt_templates.json` — prompt_type = `"image_prompt_dimension"` |
| 调用位置 | `image_generation.py:598` — `resolve_image_prompt()`，别名映射：`PROMPT_TYPE_ALIASES["image_prompt_size_chart"] = "image_prompt_dimension"` |
| 调用链 | `resolve_image_prompt()` → `resolve_prompt()` → `render_template_text()` |
| 触发条件 | 手动触发尺寸图生成 |
| 输出写入 | `ImageGenerationJob.final_prompt` |
| 前端入口 | `/product-tasks/page.tsx:3667` |
| 是否冲突 | ✅ |

---

### 2.9 `dimension_extract_from_image`

| 项目 | 详情 |
|------|------|
| 定义位置 | `apps/api/app/data/default_prompt_templates.json` — prompt_type = `"dimension_extract_from_image"` |
| 调用位置 | `apps/api/app/services/dimension_extract.py:60` — `run_dimension_extract()` |
| 调用链 | `run_dimension_extract()` → `_render_dimension_prompt()` → `resolve_prompt(prompt_type="dimension_extract_from_image")` → `render_template_text()` |
| API 入口 | `apps/api/app/api/routes/image_jobs.py:427-440` — `dimension_extract_endpoint()` |
| 触发条件 | 手动触发 / 尺寸图识别按钮 |
| 输出写入 | 直接返回字典（`dimension_extract.py:50-54`），**不落库** |
| 后续消费 | 写入 `product_ai_results.product_info` 中的 `dimension_basis`？**不确定 — 需要继续查**：第 74 行读取 `product_info`，但没有写入路径 |
| 前端消费 | `/product-tasks/page.tsx:1111, 2108, 2188, 2294, 3667` |
| 是否冲突 | ⚠️ 输出不落库，无法被后续链路复用 |

---

## 二点五、产品口径补充：`title_only` 也允许使用四宫格

当前产品口径需要明确区分两个概念：

| 概念 | 结论 |
|------|------|
| `title_only` 是否允许使用四宫格 | ✅ 允许 |
| `title_only` 是否允许使用 `product_info` 商品理解 | ❌ 暂不允许 |
| 原因 | 商品理解目前没有独立点击入口，因此 `title_only` 下不应为了四宫格自动补跑商品理解 |

因此，`title_only` 下如果触发四宫格或手动出图，图片链路应只能使用：

- raw 原始商品字段
- `title_package_lite` 输出
- 类目召回结果 / 已选类目
- 代码生成的 image prompt context 兜底字段

不得使用：

- `product_info_from_screenshot`
- `product_info.category_basis`
- `product_info.temu_category_search`
- `product_info.image_generation_basis`

这意味着：`product_info` 不是“所有图片链路的必需前置”，而是 `title_and_4grid` 模式下用于增强图片链路的能力。

## 三、`title_and_4grid` 标题链路核实（重点）

### 3.1 当前代码真实执行顺序

```text
raw_products
  → create task (generation_mode = title_and_4grid)
  → run_task_bootstrap_pipeline()
  → run_ai_pipeline_for_task()
  → _normalize_requested_steps() 返回 {"product_info", "title_package", "image_prompt_package"}
  → _expand_wanted_with_dependencies() 强制加入 "product_info"（428-429行）
  → product_info 先行（第971-998行）
  → title_package 随后（第1051-1105行）- 使用 "title_package" 而非 "title_package_lite"
  → category recall（第1117-1137行）
  → image_prompt_package 代码生成（第1178-1212行）
  → auto_generate_and_crop_4grid_for_task()
  → review_ready
```

### 3.2 关键问题：`_expand_wanted_with_dependencies` 强制加入 product_info

**文件**：`apps/api/app/services/ai_pipeline.py:422-434`

```python
def _expand_wanted_with_dependencies(ai_row: ProductAIResult, wanted: set[str], generation_mode: str) -> set[str]:
    expanded = set(wanted)
    if "image_prompt_package" in expanded and not _has_valid_output(ai_row.title_package):
        expanded.add("title_package")
    needs_product_info = "image_prompt_package" in expanded  # 428行
    if normalized_mode != GenerationMode.title_only.value and "title_package" in expanded:  # 429行
        needs_product_info = True  # title_and_4grid 触发这里
    if needs_product_info and not _has_valid_output(ai_row.product_info):
        expanded.add("product_info")  # 431行
    if "title_en_only" in expanded and not _has_valid_output(ai_row.product_info):
        expanded.add("product_info")
    return expanded
```

**触发条件**：`title_and_4grid` + `title_package` in wanted

**效果**：即使产品定义说"标题链路走 lite，商品理解后置只服务图片"，实际代码是"商品理解先跑，为标题提供输入"。

### 3.3 产品期望 vs 代码真实行为

| 环节 | 产品期望 | 代码真实行为 |
|------|---------|------------|
| 标题 prompt 类型 | `title_package_lite` | `title_package`（完整版） |
| 类目召回输入 | raw + `title_package_lite` 输出 | `product_info.temu_category_search` + `title_package` 输出 |
| 商品理解时机 | 后置，只服务图片 | 前置，为标题和类目提供输入 |

---

## 四、product_info 字段结构与消费位置

### 4.1 字段定义

**文件**：`apps/api/app/services/ai_pipeline.py:40-53`

```python
class ProductInfoOutput(BaseModel):
    product_core_v2: dict[str, Any]       # 商品主体/类型/规格/场景/风格
    visual_facts: dict[str, Any]          # 颜色/形状/结构/构图
    category_basis: dict[str, Any]        # 类目检索词
    image_generation_basis: dict[str, Any] # 图片增强字段
    evidence: dict[str, Any]              # 证据链
    source_visible: dict[str, Any]        # 原始可见信息
    product_core: dict[str, Any]          # v1 原始结构（已降级）
    category_search: dict[str, Any]        # 类目检索（已降级）
    temu_category_search: dict[str, Any]   # TEMU 类目检索上下文
    title_basis: dict[str, Any]           # 标题必须包含的卖点
    image_basis: dict[str, Any]           # 图片基础字段
    dimension_basis: dict[str, Any]       # 尺寸测量项候选
    evidence_notes: list[str]             # 不确定点
```

### 4.2 消费位置矩阵

| 字段 | 消费函数/文件 | 用途 | 是否越界 |
|------|-------------|------|---------|
| `product_core_v2` | `ai_pipeline.py:574-585` → `_build_dynamic_image_prompt_package()` | 图片 context | ❌ 正常 |
| `product_core_v2` | `ai_pipeline.py:531-545` → `_build_title_quality_guardrail()` | 标题护栏 | ⚠️ 越界 |
| `visual_facts` | `ai_pipeline.py:576-580` → `_build_dynamic_image_prompt_package()` | 图片 context | ❌ 正常 |
| `category_basis` | `ai_pipeline.py:793-796` → `_build_category_candidates()` | 类目召回 | ⚠️ 越界 |
| `image_generation_basis` | `ai_pipeline.py:581-586` → `_build_dynamic_image_prompt_package()` | 图片 context | ❌ 正常 |
| `title_basis` | `ai_pipeline.py:569` → `_build_dynamic_image_prompt_package()` | 图片 context | ❌ 正常 |
| `dimension_basis` | `ai_pipeline.py:680` → `_build_dynamic_image_prompt_package()` | 尺寸图 | ❌ 正常 |
| `temu_category_search` | `ai_pipeline.py:793-796` → `_build_category_candidates()` | 类目召回 + 图片 context | ⚠️ 越界 |
| `temu_category_search` | `image_generation.py:545-560` → `build_image_prompt_variables()` | 图片 context | ❌ 正常 |
| `dimension_basis` | `dimension_extract.py:76-90` → `_render_dimension_prompt()` | 尺寸提取 | ❌ 正常 |
| `product_core` (v1) | `ai_pipeline.py:464-484` → `_normalize_product_info()` | 生成 v2 | ⚠️ 可废弃 |

### 4.3 结论

- `product_info` 越界用于标题护栏和类目召回，超出产品定义的"只服务图片"职责
- `product_core` v1 结构降级为生成 v2 的原材料，可考虑废弃

---

## 五、图片链路边界核实

### 5.1 四宫格生成链路

**文件**：`apps/api/app/services/image_generation.py:619-648`
**函数**：`auto_generate_and_crop_4grid_for_task()`

```
auto_generate_and_crop_4grid_for_task()
  → resolve_image_prompt(prompt_type="image_prompt_carousel_4grid")
    → _ensure_prompt_upstream_outputs() ← 强制补跑 product_info + title_package
    → resolve_prompt(session, "image_prompt_carousel_4grid")
    → build_image_prompt_variables() ← 读取 product_info_context
    → render_template_text()
  → create_job(job_type="carousel_4grid")
  → run_job()
    → provider.generate_image()
    → _create_asset_for_bytes(slot="carousel_4grid")
    → _crop_4grid_into_assets() → 生成 carousel_1~4
```

**涉及文件**：`image_generation.py`、`ai_pipeline.py:1197-1202`（`_build_dynamic_image_prompt_package`）

### 5.2 `resolve_image_prompt` 中的强制上游补跑

**文件**：`apps/api/app/services/image_generation.py:492-503`

```python
def _ensure_prompt_upstream_outputs(session: Session, *, task_id: int) -> None:
    ai = session.scalar(select(ProductAIResult).where(ProductAIResult.task_id == task_id))
    missing_steps: list[str] = []
    if not _has_ai_output((ai.product_info ...)):
        missing_steps.append("product_info_from_screenshot")  # 强制补跑
    if not _has_ai_output((ai.title_package ...)):
        missing_steps.append("title_package")  # 强制补跑
    if not missing_steps:
        return
    run_ai_pipeline_for_task(session, task_id=task_id, prompt_types=missing_steps)
```

**问题**：手动触发四宫格时，如果 `product_info` 缺失，会自动补跑整个 AI 管道。这与当前产品口径冲突：`title_only` 也允许使用四宫格，但不允许为了出图自动补跑商品理解。

**修正方向**：`_ensure_prompt_upstream_outputs()` 需要按任务模式分支处理：

- `title_only`：只补齐 `title_package_lite` / `title_package` 兼容输出，不补跑 `product_info`
- `title_and_4grid`：允许补跑 `product_info`，作为图片链路增强信息
- `task_only`：默认不自动补跑 AI，除非用户明确手动触发某个 AI 能力

### 5.3 四宫格可读取 product_info 作为增强信息

✅ 符合产品定义：`image_generation_basis` 已提供：
- `main_subject`（商品主体）
- `subject_count`（数量推断）
- `visible_structures`（结构特征）
- `must_keep_elements`（必须保留元素）
- `must_avoid_elements`（不能出现元素）
- `selling_point_candidates`（卖点候选）
- `usage_scenarios`（场景方向）
- `dimension_candidates`（尺寸候选）

---

## 六、历史 enum 映射表

### 6.1 `no_ai`

| 位置 | 处理方式 |
|------|---------|
| 后端枚举定义 | `task_status.py:71` — 保留 |
| 后端归一化 | `ai_pipeline.py:439` → 映射为 `task_only` |
| Bootstrap | `task_bootstrap.py:17` → 跳过 AI，直接 `review_ready` |
| API 校验 | `raw_products.py:149`, `product_tasks.py:116` — 等同于 `task_only` 不要求 AI Key |
| 前端类型 | ❌ `/product-tasks/page.tsx:27` — 暴露 |
| 前端显示 | ⚠️ `/product-tasks/page.tsx:4573` — 硬编码 `no_ai` 判断 |
| 前端归一化 | ❌ 无映射函数 |

### 6.2 `title_and_image_prompts`

| 位置 | 处理方式 |
|------|---------|
| 后端枚举定义 | `task_status.py:72` — 保留 |
| 后端归一化 | `ai_pipeline.py:443` → 映射为 `title_and_4grid` |
| Bootstrap | `task_bootstrap.py:33-34` → 触发四宫格生成 |
| API 校验 | `raw_products.py:155-158` — 要求图片 provider |
| 前端类型 | ❌ `/product-tasks/page.tsx:27` — 暴露 |
| 前端判断 | `/product-tasks/page.tsx:4335, 4356` — 单独分支处理 |

### 6.3 `full_later`

| 位置 | 处理方式 |
|------|---------|
| 后端枚举定义 | `task_status.py:73` — 保留 |
| 后端归一化 | `ai_pipeline.py:443` → 映射为 `title_and_4grid` |
| Bootstrap | `task_bootstrap.py:33-34` → 触发四宫格生成 |
| API 校验 | `raw_products.py:155-158` — 要求图片 provider |
| 前端类型 | ❌ `/product-tasks/page.tsx:27` — 暴露 |
| 前端判断 | `/product-tasks/page.tsx:4335, 4356` — 单独分支处理 |

### 6.4 建议的前端归一化

```typescript
// apps/web/src/lib/generation-mode-utils.ts（新增）
export type NormalizedGenerationMode = "task_only" | "title_only" | "title_and_4grid";

const BACKWARD_COMPAT_MAP: Record<string, NormalizedGenerationMode> = {
  "no_ai": "task_only",
  "title_and_image_prompts": "title_and_4grid",
  "full_later": "title_and_4grid",
};

export function normalizeGenerationMode(raw: string): NormalizedGenerationMode {
  return BACKWARD_COMPAT_MAP[raw] || (raw as NormalizedGenerationMode);
}

export function getGenerationModeLabel(mode: NormalizedGenerationMode): string {
  switch (mode) {
    case "task_only": return "仅创建任务，不使用 AI";
    case "title_only": return "AI 标题 + 类目";
    case "title_and_4grid": return "AI 标题 + 类目 + 商品理解 + 四宫格";
  }
}
```

---

## 七、不确定项（需要继续查）

1. **`dimension_extract_from_image` 输出落库路径**：第 74 行读取 `product_info`，但输出结果未写入任何字段。需要查是否有后续写入逻辑。

2. **前端 `/product-tasks` 中 `no_ai` 的完整影响范围**：需要全文搜索 `no_ai` 在 page.tsx 中的所有引用，核实是否还有其他条件分支。

3. **`title_package` 在 `title_and_4grid` 模式下的实际调用**：第 1055 行写的是 `title_package` 字符串（完整版），但 `title_package_lite` 被映射为 `title_package`（第 392 行），需要确认 `title_and_4grid` 实际调用的是 lite 还是完整版。

4. **`image_prompt_package` 的 `slot_contexts` 具体渲染时机**：需要核实 `resolve_image_prompt` 中如何将 `slot_contexts` 用于模板渲染。

5. **`export_fields.py` 中 `_build_base_fields` 对 `title_only` 模式的影响**：需要核实无 `product_info` 时导出字段是否完整。

---

## 八、title_and_4grid 最终 prompt_type 确认

**结论**：`title_and_4grid` 传入 `_get_prompt()` 的是 **`"title_package"`（完整版）**，不是 `title_package_lite`。

**完整变量赋值路径**：

```
run_ai_pipeline_for_task(...)
  → wanted = _normalize_requested_steps(prompt_types=None, generation_mode="title_and_4grid")
    → _normalize_generation_mode("title_and_4grid") → "title_and_4grid"
    → 第385行返回: {"product_info", "title_package", "image_prompt_package"}
  → "title_package" in wanted → True（第1052行）
  → normalized_mode == GenerationMode.title_only.value → False（第1054行）
  → title_prompt_type = "title_package"（第1055行，取 else 分支）
  → _get_prompt(..., prompt_type="title_package", ...)（第1071行）
```

对比：`title_only` 走第1054行条件（True），title_prompt_type = `"title_package_lite"`。

---

## 九、状态数据模型评估

**用户建议**：`main_status = review_ready`, `image_status = failed`, `failure_reason = image_provider_missing`

**模型能力检查**：

| 字段 | 类型/枚举 | 当前状态 | 是否支持 |
|------|---------|---------|---------|
| `ProductTask.main_status` | `TaskMainStatus` | `review_ready` 有效 | ✅ |
| `ProductTask.image_status` | `ImageStatus` | `failed` 存在 | ✅ |
| `exception_reasons_json` | `list[dict]` | 支持 `code` + `message` + `level` | ✅ |
| `exception_status` | `str` | 字符串字段 | ✅ |

**最小兼容方案**（`task_bootstrap.py:31-37`）：

```python
if task.generation_mode in {title_and_4grid, ...}:
    try:
        auto_generate_and_crop_4grid_for_task(session, task=task)
    except RuntimeError as exc:
        if "not configured" in str(exc) or "not enabled" in str(exc):
            task.image_status = ImageStatus.failed.value
            record_task_exception(
                task,
                code="image_provider_missing",
                level="warning",
                status="needs_config",
                message="图片生成 Provider 未配置，已跳过自动生图，可手动补图。",
            )
            task.main_status = TaskMainStatus.review_ready.value
            clear_task_exception(task, code="image_generation_failed")
            session.add(task)
            session.commit()
            return
    raise  # 其他异常继续冒泡
```

不涉及表结构改动，不影响现有字段语义。

---

## 十、开发任务单

---

### P0 必改

**P0-1：默认自动链路标题统一用 `title_package_lite`**

| 项目 | 内容 |
|------|------|
| 文件 | `apps/api/app/services/ai_pipeline.py` |
| 函数 | `run_ai_pipeline_for_task()` 第 1052-1056 行 |
| 改动点 | `title_prompt_type` 条件判断：移除 `normalized_mode == title_only` 分支，所有自动链路统一传 `"title_package_lite"` |
| 意图 | 标题链路收敛，product_info 不参与标题生成 |
| 风险 | **中** — 需确认 `title_package_lite` 经 `_upgrade_lite_title_package_output()` 补全后字段覆盖度等同完整版。需对比存量 `title_package` 数据格式。 |
| 验证 | 新建 `title_and_4grid` 任务，抓 `ai_pipeline.py:1071` 行确认 `title_prompt_type` 值为 `"title_package_lite"`；确认 AI 结果中 title_package 结构完整 |

---

**P0-2：product_info 后置，仅服务 `title_and_4grid` 的图片增强链路**

| 项目 | 内容 |
|------|------|
| 文件 | `apps/api/app/services/ai_pipeline.py` |
| 函数 | `_expand_wanted_with_dependencies()` 第 422-434 行 |
| 改动点 | 删除第 428-429 行强制依赖逻辑：`if normalized_mode != title_only and "title_package" in expanded: needs_product_info = True` |
| 意图 | product_info 不再是标题和类目前置条件；并且不能作为 `title_only` 四宫格的前置条件。它只作为 `title_and_4grid` 图片 prompt context 的增强层 |
| 配套 | 修改 `_build_category_candidates()`（第 787-878 行）：确保 product_info 为 None 时，`_build_raw_category_context(raw)` + `_build_title_category_context(lite_output)` 备选链路完整 |
| 配套 | 修改 `_build_title_quality_guardrail()`（第 531-545 行）：product_info 为 None 时不拼接护栏提示，直接用 raw_title |
| 风险 | **中** — 类目召回准确率可能下降，需人工抽检对比 |
| 验证 | ①新建 `title_and_4grid` 任务：确认执行顺序为 title_package_lite → 类目召回 → product_info → image_prompt_package → 四宫格；②新建 `title_only` 任务后手动触发四宫格：确认不补跑 product_info，图片 prompt 使用 raw + title_package_lite + 类目结果；③抽检类目准确率无显著下降 |

---

**P0-3：图片 provider 缺失时友好停止，不标记 task failed**

| 项目 | 内容 |
|------|------|
| 文件 | `apps/api/app/services/task_bootstrap.py` |
| 函数 | `run_task_bootstrap_pipeline()` 第 31-37 行 |
| 改动点 | `auto_generate_and_crop_4grid_for_task()` 调用包 try-except：捕获 "not configured"/"not enabled" 异常，写 `image_status = failed` + `code="image_provider_missing"` + `main_status = review_ready`，不向上冒泡 |
| 意图 | 图片 provider 未配置时任务进人工复核，运营可见失败原因 |
| 风险 | **低** — 不改表结构，不改字段语义，只改状态组合 |
| 验证 | 未配置图片 provider 时建 `title_and_4grid` 任务：①main_status=review_ready；②image_status=failed；③前端展示 "图片生成 Provider 未配置" |

---

### P1 建议改

**P1-1：前端归一化历史 enum**

| 项目 | 内容 |
|------|------|
| 文件 | `apps/web/src/app/product-tasks/page.tsx` |
| 改动点 | ①行27：类型改为 `NormalizedGenerationMode = "task_only" \| "title_only" \| "title_and_4grid"`<br>②行4335/4356/4573-4575/5449：改用归一化函数 `normalizeGenerationMode(task.generation_mode)` 后的值做判断<br>③行5449：UI 显示用 `getGenerationModeLabel()` 映射为产品文案 |
| 意图 | 前端不暴露历史 enum 历史值给运营 |
| 风险 | **低** — 纯前端映射，不改后端数据 |
| 验证 | 存量 `no_ai` / `full_later` 任务前端正确显示为 "仅创建任务" / "AI 标题+类目+商品理解+四宫格" |

---

 

### 暂不改

**不删 `title_package` 完整版**：前端手动触发生图（`/product-tasks/page.tsx` 多处）仍传 `title_package`，删除模板会影响手动链路。P0-1 统一自动链路后，若前端也改用 lite，手动链路确认无差异，再删完整版模板。

**不删 `dimension_extract_from_image` 输出逻辑**：当前无产品触发入口且输出不落库，暂不阻塞功能。后续确定触发入口（人工点尺寸识别按钮）后再统一设计落库路径。

**不废弃 `product_core` v1 结构**：`_normalize_product_info()` 仍依赖 v1 生成 v2（P0-2 改完后依赖减少），待 product_info 只服务图片链路确认稳定后再迁移。

---

## 十一、prompt 调用关系图（收口版）

```
                    ┌─────────────────────────────────────────────────────┐
                    │              bootstrap 入口                          │
                    │  task_bootstrap.py:run_task_bootstrap_pipeline()      │
                    └────────────┬─────────────────────────────────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
         task_only          title_only         title_and_4grid
         (直接 review)    run_ai_pipeline()   run_ai_pipeline()
                            │                       │
                            ▼                       ▼
                     title_package_lite      title_package_lite      ← P0-1 统一 lite
                            │                       │
                            ▼                       ▼
                     category recall          category recall
                     (raw + lite输出)         (raw + lite输出)
                            │                       │
                            ▼                       ▼
                      review_ready            product_info             ← 仅模式三后置增强
                            │                       │
                            │                       ▼
                            │              image_prompt_package
                            │                       │
                            │                       ▼
                            │              image_prompt_carousel_4grid
                            │                       │
                            │                       ▼
                            │              auto_generate_and_crop_4grid()
                            │                       │
                            │          ┌────────────┴────────────┐
                            │          ▼                         ▼
                            │     成功→ review_ready       失败→ review_ready
                            │                                     (image_status=failed
                            │                                      image_provider_missing)
                            │                                      ▲
                            │                                      │
                            └──── title_only 手动四宫格允许使用 ───┘
                                  但只能基于 raw + lite + 类目结果，
                                  不得自动补跑 product_info
```

---

## 十二、状态流转与异常（收口版）

| 模式 | 成功流转 | 失败写入 | 前端可见性 |
|------|---------|---------|-----------|
| `task_only` | collected → review_ready | 无 | ✅ |
| `title_only` | collected → ai_running → prompts_ready → review_ready；手动四宫格允许触发，但不得补跑 product_info | `ai_pipeline_failed` / `image_generation_failed` | ⚠️ 可见但需区分标题失败和手动出图失败 |
| `title_and_4grid`（正常） | collected → ai_running → prompts_ready → image_running → review_ready | `image_generation_failed` | ⚠️ 可见但文案不友好 |
| `title_and_4grid`（provider 未配置） | collected → ai_running → prompts_ready → review_ready | `image_provider_missing` (warning) | ✅ 友好提示 |

*P0-1 → P0-2 → P0-3 建议按顺序改。P0-2 的重点不是“弱化 product_info 权重”，而是明确：`title_only` 四宫格不补跑 product_info；`title_and_4grid` 才后置运行 product_info 用于图片增强。P0-3 的异常边界需同时验证自动四宫格和手动四宫格。*