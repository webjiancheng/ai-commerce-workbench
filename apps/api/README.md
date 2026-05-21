# apps/api

阶段 2 在原始商品入库基础上增加商品任务表和状态机，可从原始商品创建任务并查询任务状态。

## 启动

```bash
createdb ai_caiji
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
uvicorn app.main:app --reload
```

## 当前接口

- `GET /health`
- `POST /sync/screenshot`
- `POST /api/raw-products`
- `GET /api/raw-products`
- `GET /api/raw-products/{id}`
- `POST /api/raw-products/{id}/create-task`
- `GET /api/product-tasks`
- `GET /api/product-tasks/{id}`
- `PATCH /api/product-tasks/{id}`
- `POST /api/product-tasks/{id}/run-ai`
- `GET /api/provider-configs`
- `POST /api/provider-configs`
- `PATCH /api/provider-configs/{id}`
- `POST /api/provider-configs/{id}/set-default`
- `GET /api/image-providers`
- `GET /api/image-providers/default`
- `POST /api/product-tasks/{id}/generate-images`
- `POST /api/product-tasks/{id}/generate-image`
- `GET /api/jobs/{job_id}`
- `GET /api/product-tasks/{id}/assets`
- `POST /api/assets/{id}/set-final`
- `POST /api/assets/{id}/regenerate`
- `POST /api/product-tasks/{id}/dimension-extract`
- `GET /api/default-rules`
- `POST /api/default-rules`
- `GET /api/default-rules/{id}`
- `PATCH /api/default-rules/{id}`
- `DELETE /api/default-rules/{id}`
- `GET /api/product-tasks/{id}/export-fields/preview`
- `POST /api/product-tasks/{id}/apply-default-rules`
- `PATCH /api/product-tasks/{id}/export-fields`
- `GET /api/export-templates`
- `POST /api/export-templates`
- `GET /api/export-templates/{id}`
- `PATCH /api/export-templates/{id}`
- `POST /api/export-templates/{id}/set-default`
- `GET /api/export-templates/{id}/fields`
- `GET /api/export-template/fields`
- `GET /api/export-field-mappings?template_id=xxx`
- `PATCH /api/export-field-mappings/{id}`
- `POST /api/export-field-mappings/batch-update`
- `POST /api/exports/preview`
- `POST /api/exports/run`
- `GET /api/exports/history`
- `GET /api/exports/{id}/download`
- `GET /api/system/prompt-types`
- `GET /api/system/prompt-variables`
- `GET /api/prompt-templates`
- `POST /api/prompt-templates`
- `PATCH /api/prompt-templates/{id}`
- `POST /api/prompt-templates/render`
- `GET /api/prompt-templates/resolve`
