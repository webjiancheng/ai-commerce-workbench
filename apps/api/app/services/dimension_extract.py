from __future__ import annotations

import base64
import json
import re
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.models.product_asset import ProductAsset
from app.models.product_ai_result import ProductAIResult
from app.models.product_task import ProductTask
from app.models.raw_product import RawProduct
from app.services.openai_client import get_openai_client, get_vision_model
from app.services.prompt_templates import render_template_text, resolve_prompt


_JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)


def run_dimension_extract(
    session: Session,
    *,
    task: ProductTask,
    asset_id: int | None,
    image_data_url: str | None,
) -> dict[str, Any]:
    model = get_vision_model(session)

    image_url = _resolve_image_data_url(session, task=task, asset_id=asset_id, image_data_url=image_data_url)
    prompt_text = _render_dimension_prompt(session, task=task)

    client = get_openai_client(session)
    response = client.responses.create(
        model=model,
        input=[
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt_text},
                    {"type": "input_image", "image_url": image_url},
                ],
            }
        ],
    )

    output_text = getattr(response, "output_text", None) or ""
    result = _parse_json_strict(output_text)
    return {
        "model": model,
        "raw_output_text": output_text,
        "result": result,
    }


def _render_dimension_prompt(session: Session, *, task: ProductTask) -> str:
    template = resolve_prompt(
        session,
        prompt_type="dimension_extract_from_image",
        task_id=task.id,
        category_id=task.selected_category_id,
    )
    if template is None:
        raise RuntimeError("No enabled prompt template found for prompt_type=dimension_extract_from_image")

    raw = session.get(RawProduct, task.raw_product_id)
    ai = session.query(ProductAIResult).filter(ProductAIResult.task_id == task.id).one_or_none()
    category_path = ""
    product_info = {}
    if isinstance(ai, ProductAIResult):
        category_out = ((ai.category_match or {}).get("output") or {})
        category_path = str(category_out.get("best_path") or category_out.get("selected_category") or "")
        product_info = ((ai.product_info or {}).get("output") or {})
    product_info_obj = product_info if isinstance(product_info, dict) else {}
    product_core_v2 = product_info_obj.get("product_core_v2") if isinstance(product_info_obj.get("product_core_v2"), dict) else {}
    visual_facts = product_info_obj.get("visual_facts") if isinstance(product_info_obj.get("visual_facts"), dict) else {}
    image_generation_basis = (
        product_info_obj.get("image_generation_basis")
        if isinstance(product_info_obj.get("image_generation_basis"), dict)
        else {}
    )
    product_info_context = {
        "product_subject": str(product_core_v2.get("product_subject") or image_generation_basis.get("main_subject") or ""),
        "product_type": str(product_core_v2.get("product_type") or ""),
        "visible_colors": [str(x).strip() for x in (visual_facts.get("visible_colors") or []) if str(x).strip()],
        "visible_shapes": [str(x).strip() for x in (visual_facts.get("visible_shapes") or []) if str(x).strip()],
        "must_keep_elements": [str(x).strip() for x in (image_generation_basis.get("must_keep_elements") or []) if str(x).strip()],
        "dimension_candidates": [str(x).strip() for x in (image_generation_basis.get("dimension_candidates") or []) if str(x).strip()],
    }

    variables = {
        "raw_title": (raw.title if raw else task.title),
        "title": (raw.title if raw else task.title),
        "selected_category_path": category_path,
        "category_path": category_path,
        "product_info": product_info_obj,
        "product_info_context": product_info_context,
        "attributes_text": (raw.attributes_text if raw else None),
        "sku_text": (raw.sku_text if raw else None),
    }
    return render_template_text(template_text=template.template_text, variables=variables)


def _resolve_image_data_url(
    session: Session,
    *,
    task: ProductTask,
    asset_id: int | None,
    image_data_url: str | None,
) -> str:
    if image_data_url:
        if not image_data_url.startswith("data:image/") or ";base64," not in image_data_url:
            raise ValueError("image_data_url must be a base64 data URL: data:image/...;base64,...")
        return image_data_url

    if asset_id is None:
        raise ValueError("asset_id or image_data_url required")

    asset = session.get(ProductAsset, asset_id)
    if asset is None:
        raise ValueError("Asset not found")
    if asset.product_task_id != task.id:
        raise ValueError("Asset does not belong to the task")
    if not asset.storage_key:
        raise ValueError("Asset has no storage_key")

    settings = get_settings()
    abs_path = Path(settings.storage_root) / asset.storage_key
    if not abs_path.exists():
        raise ValueError("Asset file missing on disk")

    mime = asset.mime_type or _guess_mime(abs_path)
    data = abs_path.read_bytes()
    b64 = base64.b64encode(data).decode("ascii")
    return f"data:{mime};base64,{b64}"


def _guess_mime(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in (".jpg", ".jpeg"):
        return "image/jpeg"
    if suffix == ".webp":
        return "image/webp"
    return "image/png"


def _parse_json_strict(text: str) -> dict[str, Any]:
    text = (text or "").strip()
    if not text:
        raise ValueError("Empty model output")

    # Happy path: exact JSON
    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            return obj
    except Exception:
        pass

    # Fallback: extract first {...} block
    m = _JSON_BLOCK_RE.search(text)
    if not m:
        raise ValueError("Model output is not valid JSON")
    obj = json.loads(m.group(0))
    if not isinstance(obj, dict):
        raise ValueError("Model output JSON is not an object")
    return obj
