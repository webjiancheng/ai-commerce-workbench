from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.prompt_types import PROMPT_SCOPES, PROMPT_TYPES, PROMPT_VARIABLES
from app.db.session import get_db_session
from app.schemas.prompt_template import (
    PromptRenderRequest,
    PromptRenderResponse,
    PromptTemplateCreate,
    PromptTemplateItem,
    PromptTemplateListResponse,
    PromptTemplateUpdate,
)
from app.services.prompt_templates import (
    create_prompt_template,
    get_prompt_template,
    list_prompt_templates,
    render_template_text,
    resolve_prompt,
    update_prompt_template,
    validate_prompt_type,
    validate_scope,
)


router = APIRouter(tags=["prompt-templates"])


@router.get("/api/system/prompt-types")
def get_prompt_types() -> dict[str, object]:
    return {"items": list(PROMPT_TYPES)}


@router.get("/api/system/prompt-variables")
def get_prompt_variables() -> dict[str, object]:
    return {"items": PROMPT_VARIABLES}


@router.post("/api/prompt-templates/render", response_model=PromptRenderResponse)
def render_prompt_template(payload: PromptRenderRequest) -> PromptRenderResponse:
    rendered = render_template_text(template_text=payload.template_text, variables=payload.variables)
    return PromptRenderResponse(rendered_text=rendered)


@router.get("/api/prompt-templates", response_model=PromptTemplateListResponse)
def list_prompt_templates_endpoint(
    prompt_type: str | None = Query(default=None),
    scope: str | None = Query(default=None),
    category_id: str | None = Query(default=None),
    task_id: int | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_db_session),
) -> PromptTemplateListResponse:
    if prompt_type is not None:
        try:
            validate_prompt_type(prompt_type)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if scope is not None:
        try:
            validate_scope(scope)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    items, total = list_prompt_templates(
        session,
        limit=limit,
        offset=offset,
        prompt_type=prompt_type,
        scope=scope,
        category_id=category_id,
        task_id=task_id,
    )
    return PromptTemplateListResponse(
        items=[PromptTemplateItem.model_validate(item) for item in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("/api/prompt-templates", response_model=PromptTemplateItem)
def create_prompt_template_endpoint(
    payload: PromptTemplateCreate, session: Session = Depends(get_db_session)
) -> PromptTemplateItem:
    try:
        item = create_prompt_template(session, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return PromptTemplateItem.model_validate(item)


@router.patch("/api/prompt-templates/{template_id}", response_model=PromptTemplateItem)
def patch_prompt_template_endpoint(
    template_id: int,
    payload: PromptTemplateUpdate,
    session: Session = Depends(get_db_session),
) -> PromptTemplateItem:
    item = get_prompt_template(session, template_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Prompt template not found")

    updated = update_prompt_template(session, item, payload)
    return PromptTemplateItem.model_validate(updated)


@router.get("/api/prompt-templates/resolve", response_model=PromptTemplateItem)
def resolve_prompt_template_endpoint(
    prompt_type: str = Query(min_length=1, max_length=64),
    task_id: int = Query(ge=1),
    category_id: str | None = Query(default=None, max_length=64),
    session: Session = Depends(get_db_session),
) -> PromptTemplateItem:
    try:
        validate_prompt_type(prompt_type)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    resolved = resolve_prompt(session, prompt_type=prompt_type, task_id=task_id, category_id=category_id)
    if resolved is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No enabled prompt template found")
    return PromptTemplateItem.model_validate(resolved)
