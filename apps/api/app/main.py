from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes import (
    default_rules,
    export_mappings,
    export_templates,
    exports,
    export_fields,
    exceptions,
    dashboard,
    batch_ops,
    batch_edit,
    cost_configs,
    settings as settings_routes,
    system_health,
    health,
    image_jobs,
    product_tasks,
    prompt_templates,
    provider_configs,
    raw_products,
)
from app.core.config import get_settings
from app.db.init_db import init_db


settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    init_db()


app.include_router(health.router)
app.include_router(raw_products.router)
app.include_router(product_tasks.router)
app.include_router(prompt_templates.router)
app.include_router(provider_configs.router)
app.include_router(image_jobs.router)
app.include_router(default_rules.router)
app.include_router(export_fields.router)
app.include_router(export_templates.router)
app.include_router(export_mappings.router)
app.include_router(exports.router)
app.include_router(exceptions.router)
app.include_router(dashboard.router)
app.include_router(batch_ops.router)
app.include_router(batch_edit.router)
app.include_router(cost_configs.router)
app.include_router(settings_routes.router)
app.include_router(system_health.router)
app.mount("/storage", StaticFiles(directory=settings.storage_root), name="storage")
