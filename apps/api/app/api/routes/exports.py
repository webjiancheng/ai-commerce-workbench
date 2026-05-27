from __future__ import annotations

from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.models.export_batch import ExportBatch
from app.schemas.ai_import import AiImportBatchOut, AiImportDraftOut
from app.schemas.export_batch import ExportBatchOut
from app.services.export_adapters.registry import list_export_adapters
from app.services.ai_imports import (
    create_ai_import_batch,
    ensure_ai_import_draft,
    export_ai_import_batch,
    get_ai_import_batch,
    get_ai_import_draft,
    list_ai_import_batches,
    parse_template_meta,
    save_uploaded_template,
    supplement_draft_with_defaults,
    update_ai_import_draft,
)
from app.services.export_runner import preview_exports, run_exports_with_options


router = APIRouter(tags=["exports"])


class ExportRunRequest(BaseModel):
    product_task_ids: list[int] = Field(default_factory=list)
    template_id: int | None = None
    default_rule_id: int | None = None
    adapter_key: str | None = None
    export_only_valid: bool = True


class AiImportParseRequest(BaseModel):
    name: str = "AI导入批次"
    raw_json_text: str = Field(min_length=1)
    template_file_path: str | None = None
    original_filename: str | None = None


class AiImportDraftPatchRequest(BaseModel):
    common_fields_json: dict[str, object] | None = None
    headers_json: list[str] | None = None
    rows_json: list[dict[str, object]] | None = None
    field_settings_json: dict[str, object] | None = None


class AiImportSupplementRequest(BaseModel):
    default_rule_id: int | None = None
    product_task_ids: list[int] = Field(default_factory=list)
    selected_template_id: int | None = None


class TemplateMetaRequest(BaseModel):
    template_file_path: str | None = None


@router.post("/api/exports/preview")
def preview_exports_endpoint(
    payload: ExportRunRequest = Body(...),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    if not payload.product_task_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="product_task_ids required")
    try:
        out = preview_exports(
            session,
            product_task_ids=payload.product_task_ids,
            template_id=payload.template_id,
            default_rule_id=payload.default_rule_id,
            adapter_key=payload.adapter_key,
        )
        return {"ok": True, **out}
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/api/exports/run")
def run_exports_endpoint(
    payload: ExportRunRequest = Body(...),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    if not payload.product_task_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="product_task_ids required")
    try:
        out = run_exports_with_options(
            session,
            product_task_ids=payload.product_task_ids,
            template_id=payload.template_id,
            default_rule_id=payload.default_rule_id,
            adapter_key=payload.adapter_key,
            export_only_valid=payload.export_only_valid,
        )
        batch = out["batch"]
        return {
            "ok": True,
            "batch_no": out["batch_no"],
            "batch": ExportBatchOut.model_validate(batch),
            "download_url": out["download_url"],
        }
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/api/exports/history", response_model=list[ExportBatchOut])
def list_export_history_endpoint(
    limit: int = Query(default=20, ge=1, le=200),
    session: Session = Depends(get_db_session),
) -> list[ExportBatchOut]:
    batches = session.scalars(select(ExportBatch).order_by(ExportBatch.created_at.desc()).limit(limit)).all()
    return [ExportBatchOut.model_validate(b) for b in batches]


@router.get("/api/exports/adapters")
def list_export_adapters_endpoint() -> dict[str, object]:
    return {"ok": True, "items": list_export_adapters()}


@router.get("/api/exports/{batch_id}/download")
def download_export_batch_endpoint(batch_id: int, session: Session = Depends(get_db_session)) -> dict[str, object]:
    batch = session.get(ExportBatch, batch_id)
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Export batch not found")
    if not batch.exported_file_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Export file not ready")
    from app.core.config import get_settings

    settings = get_settings()
    return {"ok": True, "download_url": f"{settings.public_base_url}/storage/{batch.exported_file_path}"}


@router.post("/api/exports/ai-imports/upload-template")
async def upload_ai_import_template_endpoint(file: UploadFile = File(...)) -> dict[str, object]:
    try:
        content = await file.read()
        template_file_path, original_filename = save_uploaded_template(filename=file.filename or "template.xlsx", content=content)
        return {
            "ok": True,
            "template_file_path": template_file_path,
            "original_filename": original_filename,
        }
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/api/exports/ai-imports/template-meta")
def parse_ai_import_template_meta_endpoint(payload: TemplateMetaRequest = Body(...)) -> dict[str, object]:
    try:
        from app.services.temu_upload_template import get_builtin_temu_upload_template_path

        template_path = payload.template_file_path or get_builtin_temu_upload_template_path()
        meta = parse_template_meta(template_file_path=template_path)
        return {"ok": True, "meta": meta}
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/api/exports/ai-imports/parse")
def parse_ai_import_endpoint(
    payload: AiImportParseRequest = Body(...),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    try:
        batch, draft = create_ai_import_batch(
            session,
            name=payload.name,
            raw_json_text=payload.raw_json_text,
            template_file_path=payload.template_file_path,
            original_filename=payload.original_filename,
        )
        return {
            "ok": True,
            "batch": AiImportBatchOut.model_validate(batch),
            "draft": AiImportDraftOut.model_validate(draft),
        }
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/api/exports/ai-imports", response_model=list[AiImportBatchOut])
def list_ai_imports_endpoint(
    limit: int = Query(default=20, ge=1, le=100),
    session: Session = Depends(get_db_session),
) -> list[AiImportBatchOut]:
    return [AiImportBatchOut.model_validate(item) for item in list_ai_import_batches(session, limit=limit)]


@router.get("/api/exports/ai-imports/{batch_id}")
def get_ai_import_endpoint(batch_id: int, session: Session = Depends(get_db_session)) -> dict[str, object]:
    batch = get_ai_import_batch(session, batch_id=batch_id)
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="AI import batch not found")
    draft = ensure_ai_import_draft(session, batch=batch)
    return {
        "ok": True,
        "batch": AiImportBatchOut.model_validate(batch),
        "draft": AiImportDraftOut.model_validate(draft) if draft else None,
    }


@router.patch("/api/exports/ai-imports/{batch_id}/draft")
def patch_ai_import_draft_endpoint(
    batch_id: int,
    payload: AiImportDraftPatchRequest = Body(...),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    batch = get_ai_import_batch(session, batch_id=batch_id)
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="AI import batch not found")
    try:
        draft = update_ai_import_draft(
            session,
            batch=batch,
            common_fields=payload.common_fields_json,
            headers=payload.headers_json,
            rows=payload.rows_json,
            field_settings=payload.field_settings_json,
        )
        refreshed_batch = get_ai_import_batch(session, batch_id=batch_id)
        return {
            "ok": True,
            "batch": AiImportBatchOut.model_validate(refreshed_batch),
            "draft": AiImportDraftOut.model_validate(draft),
        }
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/api/exports/ai-imports/{batch_id}/export")
def export_ai_import_endpoint(batch_id: int, session: Session = Depends(get_db_session)) -> dict[str, object]:
    batch = get_ai_import_batch(session, batch_id=batch_id)
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="AI import batch not found")
    try:
        exported_batch, rel_path = export_ai_import_batch(session, batch=batch)
        from app.core.config import get_settings

        settings = get_settings()
        return {
            "ok": True,
            "batch": AiImportBatchOut.model_validate(exported_batch),
            "download_url": f"{settings.public_base_url}/storage/{rel_path}",
        }
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


# ─────────── 步骤4：补齐草稿 ───────────
@router.post("/api/exports/ai-imports/{batch_id}/supplement")
def supplement_ai_import_draft_endpoint(
    batch_id: int,
    payload: AiImportSupplementRequest = Body(...),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    batch = get_ai_import_batch(session, batch_id=batch_id)
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="AI import batch not found")
    draft = ensure_ai_import_draft(session, batch=batch)
    try:
        supplemented = supplement_draft_with_defaults(
            session,
            draft=draft,
            default_rule_id=payload.default_rule_id,
            product_task_ids=payload.product_task_ids,
            selected_template_id=payload.selected_template_id,
        )
        refreshed_batch = get_ai_import_batch(session, batch_id=batch_id)
        return {
            "ok": True,
            "batch": AiImportBatchOut.model_validate(refreshed_batch),
            "draft": AiImportDraftOut.model_validate(supplemented),
        }
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
