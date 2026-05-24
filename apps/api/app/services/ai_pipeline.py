from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.task_status import (
    CategoryStatus,
    GenerationMode,
    ImagePromptStatus,
    TaskMainStatus,
    TitleStatus,
)
from app.models.product_ai_result import ProductAIResult
from app.models.product_task import ProductTask
from app.models.raw_product import RawProduct
from app.services.category_dictionary import recall_category_candidates_multi
from app.services.openai_client import (
    get_openai_client,
    get_text_model,
    is_openai_configured,
    resolve_text_runtime,
)
from app.services.image_context import (
    build_compact_four_grid_context,
    build_four_grid_context,
    build_product_info_context,
)
from app.services.provider_configs import get_provider_config
from app.services.prompt_templates import render_template_text, resolve_prompt
from app.services.task_exceptions import clear_task_exception, record_task_exception

AI_REQUEST_TIMEOUT_SECONDS = 120


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ProductInfoOutput(BaseModel):
    source_visible: dict[str, Any] = Field(default_factory=dict)
    product_core_v2: dict[str, Any] = Field(default_factory=dict)
    visual_facts: dict[str, Any] = Field(default_factory=dict)
    image_generation_basis: dict[str, Any] = Field(default_factory=dict)
    dimension_basis: dict[str, Any] = Field(default_factory=dict)
    evidence: dict[str, Any] = Field(default_factory=dict)
    evidence_notes: list[str] = Field(default_factory=list)


class TitlePackageOutput(BaseModel):
    title_cn: str
    title_en: str
    title_candidates_cn: list[str] = Field(default_factory=list)
    title_candidates_en: list[str] = Field(default_factory=list)
    core_product_words: list[str] = Field(default_factory=list)
    selling_points: list[str] = Field(default_factory=list)
    category_search_keywords: list[str] = Field(default_factory=list)


class TitlePackageLiteOutput(BaseModel):
    title_cn: str
    title_en: str
    core_product_words: list[str] = Field(default_factory=list)
    category_search_keywords: list[str] = Field(default_factory=list)


class TitleEnOnlyOutput(BaseModel):
    title_en: str
    core_product_words: list[str] = Field(default_factory=list)


class PromptBundleItem(BaseModel):
    prompt: str
    negative_prompt: str = ""
    basis_fields: list[str] = Field(default_factory=list)
    role: str | None = None
    panel_plan: dict[str, str] = Field(default_factory=dict)
    dimension_labels: list[str] = Field(default_factory=list)
    requires_manual_dimension: bool | None = None


class ImagePromptPackageOutput(BaseModel):
    carousel_4grid: PromptBundleItem
    carousel_1: PromptBundleItem
    carousel_2: PromptBundleItem
    carousel_3: PromptBundleItem
    carousel_4: PromptBundleItem
    size_chart: PromptBundleItem


def _snapshot(
    *,
    prompt: str,
    model: str,
    input_obj: Any,
    output_obj: Any,
    started_at: float,
    usage: dict[str, Any] | None = None,
    cost: dict[str, Any] | None = None,
    provider: dict[str, Any] | None = None,
) -> dict:
    duration_ms = int((time.time() - started_at) * 1000)
    return {
        "created_at": _now_iso(),
        "model": model,
        "duration_ms": duration_ms,
        "prompt": prompt,
        "input": input_obj,
        "output": output_obj,
        "usage": usage or {},
        "cost": cost or {},
        "provider": provider or {},
    }


def _extract_text_content(message_content: Any) -> str:
    if isinstance(message_content, str):
        return message_content
    if isinstance(message_content, list):
        parts: list[str] = []
        for item in message_content:
            if isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "\n".join(parts).strip()
    return ""


def _safe_json_slice(text: str) -> str:
    if not text:
        return text
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        return text[start : end + 1]
    return text


def _repair_json_payload(*, client: Any, model_name: str, raw_text: str, schema: type[BaseModel]) -> dict[str, Any]:
    repair_prompt = (
        "Convert the following content into one valid JSON object only. "
        "Do not add markdown or explanations. "
        "Preserve the original meaning and fix only JSON syntax/escaping issues. "
        f"The JSON must match this schema: {schema.model_json_schema()}"
    )
    completion = client.chat.completions.create(
        model=model_name,
        messages=[
            {"role": "system", "content": repair_prompt},
            {"role": "user", "content": raw_text},
        ],
        timeout=AI_REQUEST_TIMEOUT_SECONDS,
    )
    content = _extract_text_content(completion.choices[0].message.content)
    return json.loads(_safe_json_slice(content))


def _extract_usage_metrics(response: Any) -> dict[str, Any]:
    usage = getattr(response, "usage", None)
    if usage is None:
        return {}
    prompt_tokens = getattr(usage, "prompt_tokens", None)
    completion_tokens = getattr(usage, "completion_tokens", None)
    total_tokens = getattr(usage, "total_tokens", None)
    prompt_details = getattr(usage, "prompt_tokens_details", None)
    completion_details = getattr(usage, "completion_tokens_details", None)
    payload: dict[str, Any] = {}
    if prompt_tokens is not None:
        payload["prompt_tokens"] = int(prompt_tokens)
    if completion_tokens is not None:
        payload["completion_tokens"] = int(completion_tokens)
    if total_tokens is not None:
        payload["total_tokens"] = int(total_tokens)
    if prompt_details is not None:
        payload["prompt_tokens_details"] = {
            key: value
            for key, value in vars(prompt_details).items()
            if not key.startswith("_") and value is not None
        }
    if completion_details is not None:
        payload["completion_tokens_details"] = {
            key: value
            for key, value in vars(completion_details).items()
            if not key.startswith("_") and value is not None
        }
    return payload


def _read_token_rate(pricing: dict[str, Any], candidates: list[tuple[str, int]]) -> float | None:
    for key, base in candidates:
        value = pricing.get(key)
        if value in {None, ""}:
            continue
        try:
            return float(value) / float(base)
        except Exception:
            continue
    return None


def _estimate_text_cost(pricing: dict[str, Any], usage: dict[str, Any] | None) -> dict[str, Any]:
    if not pricing or not usage:
        return {}
    prompt_tokens = int(usage.get("prompt_tokens") or 0)
    completion_tokens = int(usage.get("completion_tokens") or 0)
    total_tokens = int(usage.get("total_tokens") or (prompt_tokens + completion_tokens))
    input_rate = _read_token_rate(
        pricing,
        [
            ("input_cost_per_token", 1),
            ("prompt_cost_per_token", 1),
            ("input_cost_per_1k_tokens", 1_000),
            ("prompt_cost_per_1k_tokens", 1_000),
            ("input_cost_per_1m_tokens", 1_000_000),
            ("prompt_cost_per_1m_tokens", 1_000_000),
        ],
    )
    output_rate = _read_token_rate(
        pricing,
        [
            ("output_cost_per_token", 1),
            ("completion_cost_per_token", 1),
            ("output_cost_per_1k_tokens", 1_000),
            ("completion_cost_per_1k_tokens", 1_000),
            ("output_cost_per_1m_tokens", 1_000_000),
            ("completion_cost_per_1m_tokens", 1_000_000),
        ],
    )
    estimated_cost = None
    if input_rate is not None or output_rate is not None:
        estimated_cost = round((prompt_tokens * float(input_rate or 0.0)) + (completion_tokens * float(output_rate or 0.0)), 6)
    elif pricing.get("estimated_cost_per_request") is not None:
        try:
            estimated_cost = round(float(pricing.get("estimated_cost_per_request") or 0.0), 6)
        except Exception:
            estimated_cost = None
    return {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": total_tokens,
        "estimated_cost": estimated_cost,
        "currency": str(pricing.get("currency") or "USD"),
        "input_rate_per_token": input_rate,
        "output_rate_per_token": output_rate,
    }


def _resolve_text_pricing(session: Session, runtime: dict[str, Any]) -> dict[str, Any]:
    provider_id = runtime.get("provider_id")
    if not provider_id:
        return {}
    provider = get_provider_config(session, int(provider_id))
    if provider is None:
        return {}
    return provider.pricing_json or {}


def _parse_with_fallback(
    *,
    client: Any,
    model_name: str,
    system_prompt: str,
    user_input: Any,
    schema: type[BaseModel],
) -> tuple[BaseModel, dict[str, Any]]:
    try:
        completion = client.chat.completions.parse(
            model=model_name,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": str(user_input)},
            ],
            response_format=schema,
            timeout=AI_REQUEST_TIMEOUT_SECONDS,
        )
        return completion.choices[0].message.parsed, _extract_usage_metrics(completion)
    except Exception as exc:
        message = str(exc).lower()
        if "response_format" not in message and "json_schema" not in message:
            raise
        fallback_system_prompt = (
            f"{system_prompt}\n\n"
            "Return only valid JSON object. Do not include markdown/code fences. "
            "Keys must strictly follow the required output schema."
        )
        completion = client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": fallback_system_prompt},
                {"role": "user", "content": str(user_input)},
            ],
            timeout=AI_REQUEST_TIMEOUT_SECONDS,
        )
        content = _extract_text_content(completion.choices[0].message.content)
        try:
            payload = json.loads(_safe_json_slice(content))
        except json.JSONDecodeError:
            payload = _repair_json_payload(
                client=client,
                model_name=model_name,
                raw_text=content,
                schema=schema,
            )
        return schema.model_validate(payload), _extract_usage_metrics(completion)


def _ensure_ai_row(session: Session, *, task_id: int) -> ProductAIResult:
    row = session.scalar(select(ProductAIResult).where(ProductAIResult.task_id == task_id))
    if row is not None:
        return row
    row = ProductAIResult(task_id=task_id)
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def _get_prompt(
    session: Session,
    *,
    prompt_type: str,
    task: ProductTask,
    category_id: str | None,
    variables: dict[str, Any],
) -> tuple[str, dict[str, Any]]:
    template = resolve_prompt(
        session,
        prompt_type=prompt_type,
        task_id=task.id,
        category_id=category_id,
    )
    if template is None:
        raise RuntimeError(f"No enabled prompt template found for prompt_type={prompt_type}")

    rendered = render_template_text(template_text=template.template_text, variables=variables)
    snapshot = {
        "prompt_type": prompt_type,
        "template_id": template.id,
        "scope": template.scope,
        "category_id": template.category_id,
        "task_id": template.task_id,
        "version": template.version,
        "rendered_text": rendered,
        "resolved_at": _now_iso(),
    }
    return rendered, snapshot


def _normalize_requested_steps(
    prompt_types: list[str] | None,
    generation_mode: str,
    *,
    include_product_info: bool,
) -> set[str]:
    normalized_mode = _normalize_generation_mode(generation_mode)
    if not prompt_types:
        if normalized_mode == GenerationMode.task_only.value:
            return set()
        if normalized_mode == GenerationMode.title_only.value:
            return {"product_info", "title_package"} if include_product_info else {"title_package"}
        # title_and_4grid mode: prompt package should also be prepared from the
        # same product understanding + title/category context before 4-grid runs.
        wanted = {"title_package", "image_prompt_package"}
        if include_product_info:
            wanted.add("product_info")
        return wanted

    wanted: set[str] = set()
    for item in prompt_types:
        token = (item or "").strip()
        if token in {"product_info_from_screenshot", "product_info"}:
            wanted.add("product_info")
        elif token in {"title_package_lite"}:
            wanted.add("title_package_lite")
        elif token in {"title_en", "title_en_with_cn_translation", "title_package"}:
            wanted.add("title_package")
        elif token in {"title_en_only"}:
            wanted.add("title_en_only")
        elif token in {
            "image_prompt_package",
            "image_prompt_main",
            "image_prompt_carousel_4grid",
            "image_prompt_carousel_1",
            "image_prompt_carousel_2",
            "image_prompt_carousel_3",
            "image_prompt_carousel_4",
            "image_prompt_dimension",
        }:
            wanted.add("image_prompt_package")
        elif token == "category_match":
            wanted.add("product_info")
    if "title_en_only" in wanted:
        wanted.discard("title_package")
        wanted.discard("title_package_lite")
        wanted.discard("image_prompt_package")
    return wanted


def _has_valid_output(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False
    output = payload.get("output")
    return isinstance(output, dict) and bool(output)


def _expand_wanted_with_dependencies(
    ai_row: ProductAIResult,
    wanted: set[str],
    generation_mode: str,
    *,
    include_product_info: bool,
) -> set[str]:
    normalized_mode = _normalize_generation_mode(generation_mode)
    expanded = set(wanted)
    if "image_prompt_package" in expanded and not _has_valid_output(ai_row.title_package):
        expanded.add("title_package")
    # product_info only for title_and_4grid image enhancement, not for title_only manual 4grid
    needs_product_info = (
        include_product_info
        and normalized_mode == GenerationMode.title_and_4grid.value
        and "image_prompt_package" in expanded
    )
    if needs_product_info and not _has_valid_output(ai_row.product_info):
        expanded.add("product_info")
    if (
        include_product_info
        and ({"title_package", "title_package_lite", "title_en_only"} & expanded)
        and not _has_valid_output(ai_row.product_info)
    ):
        expanded.add("product_info")
    return expanded


def _normalize_generation_mode(mode: str | None) -> str:
    token = str(mode or "").strip()
    if token in {GenerationMode.task_only.value, GenerationMode.no_ai.value}:
        return GenerationMode.task_only.value
    if token == GenerationMode.title_only.value:
        return GenerationMode.title_only.value
    return GenerationMode.title_and_4grid.value


def _normalize_product_info(output: ProductInfoOutput) -> ProductInfoOutput:
    # 商品理解只服务标题摘要和四宫格要素，不再产出类目检索或标题字段。
    ev_notes = output.evidence_notes if isinstance(output.evidence_notes, list) else []
    visible_opts = output.source_visible.get("visible_options") if isinstance(output.source_visible, dict) else []
    if not isinstance(visible_opts, list):
        visible_opts = []

    if not output.product_core_v2:
        output.product_core_v2 = {
            "product_subject": "",
            "product_type": "",
            "product_form": "",
            "is_set_or_pack": False,
            "pack_count": str(output.source_visible.get("quantity_hint") or "").strip() if isinstance(output.source_visible, dict) else "",
            "target_gender": [],
            "target_age_group": [],
            "usage_scenarios": [],
            "style_tags": [],
        }

    if not output.visual_facts:
        output.visual_facts = {
            "visible_colors": [],
            "visible_shapes": [],
            "visible_structures": [],
            "visible_patterns": [],
            "visible_accessories": [],
            "dominant_view_type": "",
            "composition_notes": [str(x).strip() for x in visible_opts if str(x).strip()],
        }

    if not output.image_generation_basis:
        output.image_generation_basis = {
            "main_subject": str(output.product_core_v2.get("product_subject") or "").strip(),
            "must_keep_elements": [],
            "must_avoid_elements": [],
            "consistent_variant_rules": [],
            "selling_point_candidates": [],
            "sku_axes": [],
            "dimension_candidates": [str(x).strip() for x in (output.dimension_basis.get("suggested_measurement_items") or []) if str(x).strip()] if isinstance(output.dimension_basis, dict) else [],
            "four_grid_plan": {},
        }

    if not output.evidence:
        output.evidence = {
            "from_title": [],
            "from_attributes": [],
            "from_sku_text": [],
            "from_screenshot": [],
            "from_images": [],
            "uncertain_points": [str(x).strip() for x in ev_notes if str(x).strip()],
        }
    return output


def _build_title_quality_guardrail(*, raw_title: str, product_info: ProductInfoOutput) -> str:
    product_core = product_info.product_core_v2 if isinstance(product_info.product_core_v2, dict) else {}
    visual_facts = product_info.visual_facts if isinstance(product_info.visual_facts, dict) else {}
    return (
        "Title quality guardrails (must follow):\n"
        "1) Keep category noun unchanged or stricter than source title; do not over-generalize.\n"
        "2) Keep concrete attributes from source/product_info: quantity, shape, color, style, target scene.\n"
        "3) Do not drop key modifiers that distinguish SKU meaning.\n"
        "4) Chinese title should be natural and compact; English title should be search-friendly and factual.\n"
        "5) Keep CN and EN semantically aligned; no fabricated material/claims.\n"
        "6) Forbidden: promo words, ranking claims, fake certifications, exaggerated benefits.\n"
        f"7) Source title to preserve key meaning: {raw_title}\n"
        f"8) Product core hints: {json.dumps(product_core, ensure_ascii=False)}\n"
        f"9) Visual hints: {json.dumps(visual_facts, ensure_ascii=False)}\n"
    )


def _list_texts(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _build_dynamic_image_prompt_package(
    *,
    raw: RawProduct,
    task: ProductTask,
    product_info: ProductInfoOutput | None,
    title_package: TitlePackageOutput,
) -> dict[str, Any]:
    category_path = str(task.selected_category_id or "").strip()
    four_grid_context = build_four_grid_context(
        raw=raw,
        task=task,
        title_package=title_package,
        product_info=product_info,
    )
    product_info_context = build_product_info_context(four_grid_context)
    four_grid_prompt_context = build_compact_four_grid_context(four_grid_context)
    title_en_package = {
        "title_en": title_package.title_en,
    }
    shared_context = {
        "selected_category_path": category_path,
        "title_en_with_cn_translation": title_en_package,
        "selling_points": _list_texts(title_package.selling_points),
        "product_info_context": product_info_context,
        "four_grid_prompt_context": four_grid_prompt_context,
        "reference_images": four_grid_context.get("reference_images") or {},
    }
    slot_contexts = {
        "carousel_4grid": {
            "prompt_type": "image_prompt_carousel_4grid",
            "mode": "render_template_only",
            "basis_fields": [
                "selected_category_path",
                "title_en_with_cn_translation",
                "selling_points",
                "product_info_context.product_subject",
                "product_info_context.structure_words",
                "product_info_context.scene_words",
                "product_info_context.must_keep_elements",
                "product_info_context.must_avoid_elements",
            ],
        },
        "carousel_1": {
            "prompt_type": "image_prompt_carousel_1",
            "mode": "render_template_only",
            "basis_fields": [
                "selected_category_path",
                "title_en_with_cn_translation",
                "product_info_context.product_subject",
                "product_info_context.structure_words",
                "product_info_context.visible_colors",
            ],
        },
        "carousel_2": {
            "prompt_type": "image_prompt_carousel_2",
            "mode": "render_template_only",
            "basis_fields": [
                "selected_category_path",
                "title_en_with_cn_translation",
                "product_info_context.must_keep_elements",
                "product_info_context.structure_words",
            ],
        },
        "carousel_3": {
            "prompt_type": "image_prompt_carousel_3",
            "mode": "render_template_only",
            "basis_fields": [
                "selected_category_path",
                "title_en_with_cn_translation",
                "product_info_context.scene_words",
                "product_info_context.must_avoid_elements",
            ],
        },
        "carousel_4": {
            "prompt_type": "image_prompt_carousel_4",
            "mode": "render_template_only",
            "basis_fields": [
                "selected_category_path",
                "title_en_with_cn_translation",
                "selling_points",
                "product_info_context.selling_point_candidates",
            ],
        },
        "sku_image": {
            "prompt_type": "image_prompt_main",
            "mode": "render_template_only",
            "basis_fields": [
                "selected_category_path",
                "title_en_with_cn_translation",
                "product_info_context.product_subject",
                "product_info_context.visible_colors",
                "product_info_context.sku_axes",
            ],
        },
        "size_chart": {
            "prompt_type": "image_prompt_dimension",
            "mode": "render_template_only",
            "basis_fields": [
                "selected_category_path",
                "title_en_with_cn_translation",
                "product_info_context.dimension_candidates",
            ],
        },
    }
    return {
        "mode": "dynamic_context_only",
        "generator": "code.dynamic_image_prompt_context",
        "note": "此步骤只生成图片提示词动态上下文与模板变量，不调用图片提示词 AI。",
        "shared_context": shared_context,
        "slot_contexts": slot_contexts,
    }


def _split_category_seed_text(text: str | None) -> list[str]:
    if not text:
        return []
    parts = [segment.strip() for segment in text.replace("；", "\n").replace(";", "\n").splitlines()]
    return [segment for segment in parts if segment][:5]


def _contains_chinese(text: str | None) -> bool:
    if not text:
        return False
    return any("\u4e00" <= ch <= "\u9fff" for ch in text)


def _build_raw_category_context(raw: RawProduct) -> dict[str, Any]:
    queries: list[str] = []
    raw_path = str(raw.category_path or "").strip()
    if raw_path:
        queries.append(raw_path)
    if raw.title and raw.title.strip():
        queries.append(raw.title.strip())
    queries.extend(_split_category_seed_text(raw.attributes_text))
    queries.extend(_split_category_seed_text(raw.sku_text))
    unique_queries: list[str] = []
    seen: set[str] = set()
    for query in queries:
        normalized = query.lower()
        if normalized in seen:
            continue
        seen.add(normalized)
        unique_queries.append(query)
    return {
        "raw_category_path_cn": raw_path,
        "category_terms_cn": unique_queries,
        "category_terms_en": [],
        "core_leaf_terms_cn": [],
        "core_leaf_terms_en": [],
        "parent_terms_cn": [],
        "exclude_terms_cn": [],
        "search_priority": ["raw_category_path_cn", "category_terms_cn"],
    }


def _build_title_category_context(title_package: TitlePackageOutput | None, *, prefer_cn: bool = False) -> dict[str, Any]:
    if not isinstance(title_package, TitlePackageOutput):
        return {}
    keywords = [str(item).strip() for item in (title_package.category_search_keywords or []) if str(item).strip()]
    if prefer_cn:
        # title_only mode: force title-derived recall fields to Chinese only.
        keywords = [item for item in keywords if _contains_chinese(item)]
    return {
        "category_search_keywords": keywords,
        "search_priority": ["category_search_keywords"] if keywords else [],
    }


def _upgrade_lite_title_package_output(output: TitlePackageLiteOutput) -> TitlePackageOutput:
    return TitlePackageOutput(
        title_cn=output.title_cn,
        title_en=output.title_en,
        title_candidates_cn=[],
        title_candidates_en=[],
        core_product_words=list(output.core_product_words or []),
        category_search_keywords=list(output.category_search_keywords or []),
    )


def _build_category_candidates(
    *,
    raw: RawProduct,
    product_info: ProductInfoOutput | None,
    title_package: TitlePackageOutput | None,
    prefer_cn_keywords: bool = False,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    category_data = _build_raw_category_context(raw)
    title_category_data = _build_title_category_context(
        title_package,
        prefer_cn=prefer_cn_keywords,
    )
    queries: list[str] = []
    exclude_terms: list[str] = []
    query_sources: list[dict[str, str]] = []

    def append_from(source_name: str, payload: dict[str, Any]) -> None:
        priority_keys = payload.get("search_priority")
        if isinstance(priority_keys, list):
            for key in priority_keys:
                if not isinstance(key, str):
                    continue
                value = payload.get(key)
                if isinstance(value, str) and value.strip():
                    queries.append(value.strip())
                    query_sources.append({"source": source_name, "field": key, "value": value.strip()})
                elif isinstance(value, list):
                    for item in value:
                        item_text = str(item).strip()
                        if item_text:
                            queries.append(item_text)
                            query_sources.append({"source": source_name, "field": key, "value": item_text})

    append_from("title_package", title_category_data)
    append_from("product_info", category_data)

    for key in ("core_leaf_terms_cn", "core_leaf_terms_en", "category_terms_cn", "category_terms_en", "parent_terms_cn"):
        value = category_data.get(key)
        if isinstance(value, list):
            for item in value:
                item_text = str(item).strip()
                if item_text:
                    queries.append(item_text)
                    query_sources.append({"source": "product_info", "field": key, "value": item_text})
    for key in ("category_search_keywords",):
        value = title_category_data.get(key)
        if isinstance(value, list):
            for item in value:
                item_text = str(item).strip()
                if item_text:
                    queries.append(item_text)
                    query_sources.append({"source": "title_package", "field": key, "value": item_text})
    for key in ("exclude_terms_cn", "exclude_terms"):
        value = category_data.get(key)
        if isinstance(value, list):
            exclude_terms.extend([str(item).strip() for item in value if str(item).strip()])

    raw_path = str(category_data.get("raw_category_path_cn") or raw.category_path or "").strip()
    if raw_path:
        queries.append(raw_path)
        query_sources.append({"source": "raw", "field": "raw_category_path_cn", "value": raw_path})

    unique_queries: list[str] = []
    seen: set[str] = set()
    for query in queries:
        normalized_query = query.lower()
        if normalized_query in seen:
            continue
        seen.add(normalized_query)
        unique_queries.append(query)
    ranked = recall_category_candidates_multi(queries=unique_queries, exclude_terms=exclude_terms, limit=10)
    candidates = [
        {
            "path": item.path,
            "leaf": item.leaf,
            "score": round(float(item.score), 4),
            "matched_terms": item.matched_terms or [],
        }
        for item in ranked
    ]
    recall_debug = {
        "queries": unique_queries,
        "exclude_terms": exclude_terms,
        "query_sources": query_sources,
        "title_category_context": title_category_data,
        "product_info_category_context": category_data,
    }
    return candidates, recall_debug


def _category_status_for_candidates(candidates: list[dict[str, Any]]) -> str:
    if not candidates:
        return CategoryStatus.low_confidence.value
    top_score = float(candidates[0].get("score") or 0.0)
    if top_score < 1.6 or len(candidates) < 3:
        return CategoryStatus.low_confidence.value
    return CategoryStatus.success.value


def run_ai_pipeline_for_task(
    session: Session, *, task_id: int, prompt_types: list[str] | None = None
) -> None:
    task = session.get(ProductTask, task_id)
    if task is None:
        return
    raw = session.get(RawProduct, task.raw_product_id)
    if raw is None:
        task.main_status = TaskMainStatus.failed.value
        session.add(task)
        session.commit()
        return

    if not is_openai_configured(session):
        raise RuntimeError("AI 文本模型未配置可用 API Key，AI 任务已阻止执行。")

    model = get_text_model(session)
    client = get_openai_client(session)
    runtime = resolve_text_runtime(session)
    ai_row = _ensure_ai_row(session, task_id=task_id)
    normalized_mode = _normalize_generation_mode(task.generation_mode)
    wanted = _expand_wanted_with_dependencies(
        ai_row,
        _normalize_requested_steps(
            prompt_types,
            normalized_mode,
            include_product_info=bool(task.include_product_info),
        ),
        normalized_mode,
        include_product_info=bool(task.include_product_info),
    )
    text_pricing = _resolve_text_pricing(session, runtime)
    provider_meta = {
        "provider_source": runtime.get("provider_source"),
        "provider_id": runtime.get("provider_id"),
        "provider_name": runtime.get("provider_name"),
        "provider_display_name": runtime.get("provider_display_name"),
    }
    ai_row.prompt_snapshot = {
        **(ai_row.prompt_snapshot or {}),
        "_runtime": {
            **provider_meta,
            "model": model,
            "pricing": text_pricing,
            "resolved_at": _now_iso(),
        },
    }

    task.main_status = TaskMainStatus.ai_running.value
    task.category_status = CategoryStatus.running.value
    task.title_status = (
        TitleStatus.running.value
        if ({"title_package", "title_package_lite", "title_en_only"} & wanted)
        else TitleStatus.pending.value
    )
    task.image_prompt_status = (
        ImagePromptStatus.running.value if "image_prompt_package" in wanted else ImagePromptStatus.pending.value
    )
    session.add(task)
    session.commit()

    try:
        clear_task_exception(task, code="openai_api_key_missing")

        first_main_image = raw.main_image or (raw.main_images or raw.carousel_images or [""])[0]
        screenshot_notes_parts = [
            f"page_screenshot={raw.screenshot_url or ''}",
            f"first_main_image={first_main_image or ''}",
        ]

        product_info_input = {
            "title": raw.title,
            "category_path": raw.category_path or task.selected_category_id or "",
            "attributes_text": raw.attributes_text or "",
            "sku_text": raw.sku_text or "",
            "platform": raw.platform or task.product_platform or "",
            "screenshot_notes": " | ".join([part for part in screenshot_notes_parts if part.strip()]),
            # Keep compatibility aliases for older templates.
            "raw_title": raw.title,
            "raw_category_path": raw.category_path or "",
            "main_image": first_main_image or "",
            "first_main_image": first_main_image or "",
            "page_screenshot": raw.screenshot_url or "",
        }
        product_info_out: ProductInfoOutput | None = None
        if "product_info" in wanted:
            rendered_prompt, prompt_meta = _get_prompt(
                session,
                prompt_type="product_info_from_screenshot",
                task=task,
                category_id=task.selected_category_id,
                variables=product_info_input,
            )
            ai_row.prompt_snapshot = {**(ai_row.prompt_snapshot or {}), "product_info_from_screenshot": prompt_meta}
            started = time.time()
            parsed, usage = _parse_with_fallback(
                client=client,
                model_name=model,
                system_prompt=rendered_prompt,
                user_input=product_info_input,
                schema=ProductInfoOutput,
            )
            product_info_out = _normalize_product_info(parsed)
            ai_row.product_info = _snapshot(
                prompt=rendered_prompt,
                model=model,
                input_obj=product_info_input,
                output_obj=product_info_out.model_dump(),
                started_at=started,
                usage=usage,
                cost=_estimate_text_cost(text_pricing, usage),
                provider=provider_meta,
            )
        else:
            existing_out = (ai_row.product_info or {}).get("output") if isinstance(ai_row.product_info, dict) else None
            if isinstance(existing_out, dict):
                product_info_out = _normalize_product_info(ProductInfoOutput.model_validate(existing_out))

        title_package_out: TitlePackageOutput | None = None
        if "title_en_only" in wanted:
            title_en_only_input = {
                "raw_title": raw.title,
                "title": raw.title,
                "product_info": product_info_out.model_dump() if isinstance(product_info_out, ProductInfoOutput) else {},
                "attributes_text": raw.attributes_text or "",
                "sku_text": raw.sku_text or "",
                "platform": raw.platform or task.product_platform or "general",
                "target_language": "en",
            }
            rendered_prompt, prompt_meta = _get_prompt(
                session,
                prompt_type="title_en_only",
                task=task,
                category_id=task.selected_category_id,
                variables=title_en_only_input,
            )
            ai_row.prompt_snapshot = {**(ai_row.prompt_snapshot or {}), "title_en_only": prompt_meta}
            if isinstance(product_info_out, ProductInfoOutput):
                rendered_prompt = f"{rendered_prompt}\n\n{_build_title_quality_guardrail(raw_title=raw.title, product_info=product_info_out)}"
            started = time.time()
            parsed, usage = _parse_with_fallback(
                client=client,
                model_name=model,
                system_prompt=rendered_prompt,
                user_input=title_en_only_input,
                schema=TitleEnOnlyOutput,
            )
            ai_row.title_en = _snapshot(
                prompt=rendered_prompt,
                model=model,
                input_obj=title_en_only_input,
                output_obj=parsed.model_dump(),
                started_at=started,
                usage=usage,
                cost=_estimate_text_cost(text_pricing, usage),
                provider=provider_meta,
            )
            task.title_status = TitleStatus.success.value
            task.main_status = TaskMainStatus.prompts_ready.value
            clear_task_exception(task, code="ai_pipeline_failed")
            session.add(ai_row)
            session.add(task)
            session.commit()
            return

        if "title_package" in wanted or "title_package_lite" in wanted:
            title_prompt_type = (
                "title_package_lite"
                if "title_package_lite" in wanted and "title_package" not in wanted
                else "title_package"
            )
            title_input = {
                "raw_title": raw.title,
                "title": raw.title,
                "original_category_path": raw.category_path or "",
                "selected_category_path": task.selected_category_id or "",
                "category_path": task.selected_category_id or "",
                "product_info": product_info_out.model_dump() if isinstance(product_info_out, ProductInfoOutput) else {},
                "attributes_text": raw.attributes_text or "",
                "sku_text": raw.sku_text or "",
                "platform": raw.platform or task.product_platform or "general",
                "target_language": "both",
            }
            rendered_prompt, prompt_meta = _get_prompt(
                session,
                prompt_type=title_prompt_type,
                task=task,
                category_id=task.selected_category_id,
                variables=title_input,
            )
            ai_row.prompt_snapshot = {**(ai_row.prompt_snapshot or {}), "title_package": prompt_meta}
            # product_info 不参与标题质量护栏（产品口径）
            started = time.time()
            title_schema: type[BaseModel] = (
                TitlePackageLiteOutput
                if title_prompt_type == "title_package_lite"
                else TitlePackageOutput
            )
            parsed, usage = _parse_with_fallback(
                client=client,
                model_name=model,
                system_prompt=rendered_prompt,
                user_input=title_input,
                schema=title_schema,
            )
            if isinstance(parsed, TitlePackageLiteOutput):
                title_package_out = _upgrade_lite_title_package_output(parsed)
            else:
                title_package_out = parsed
            ai_row.title_package = _snapshot(
                prompt=rendered_prompt,
                model=model,
                input_obj=title_input,
                output_obj=title_package_out.model_dump(),
                started_at=started,
                usage=usage,
                cost=_estimate_text_cost(text_pricing, usage),
                provider=provider_meta,
            )
            task.title_status = TitleStatus.success.value
            if title_package_out.title_cn:
                task.title = title_package_out.title_cn
        else:
            existing_out = (ai_row.title_package or {}).get("output") if isinstance(ai_row.title_package, dict) else None
            if isinstance(existing_out, dict):
                title_package_out = TitlePackageOutput.model_validate(existing_out)

        category_candidates: list[dict[str, Any]] = []
        category_debug: dict[str, Any] = {}
        if isinstance(title_package_out, TitlePackageOutput):
            category_candidates, category_debug = _build_category_candidates(
                raw=raw,
                product_info=product_info_out,
                title_package=title_package_out,
                prefer_cn_keywords=True,
            )
        selected_candidate = category_candidates[0]["path"] if category_candidates else ""
        top_score = float(category_candidates[0].get("score") or 0.0) if category_candidates else 0.0
        confidence = round(min(0.99, max(0.0, top_score / 3.0)), 3) if category_candidates else 0.0
        top3 = [
            {
                "path": str(item.get("path") or ""),
                "confidence": round(min(0.99, max(0.0, float(item.get("score") or 0.0) / 3.0)), 3),
            }
            for item in category_candidates[:3]
        ]
        if not task.selected_category_id and selected_candidate:
            task.selected_category_id = selected_candidate
        task.category_candidates_json = category_candidates
        task.category_status = _category_status_for_candidates(category_candidates)
        category_input = {
            "raw_category_path": raw.category_path or "",
            "queries": category_debug,
        }
        category_output: dict[str, Any] = {
            "best_path": task.selected_category_id or "",
            "selected_category": task.selected_category_id or "",
            "confidence": confidence,
            "top3": top3,
            "candidates": category_candidates,
        }
        if isinstance(title_package_out, TitlePackageOutput):
            category_output.update(
                {
                    "category_search_keywords": title_package_out.category_search_keywords,
                }
            )
        ai_row.category_match = {
            "created_at": _now_iso(),
            "model": "code.category_dictionary",
            "duration_ms": 0,
            "prompt": "",
            "input": category_input,
            "output": category_output,
        }

        if normalized_mode == GenerationMode.title_only.value:
            task.image_prompt_status = ImagePromptStatus.pending.value
            task.main_status = TaskMainStatus.prompts_ready.value
            session.add(ai_row)
            session.add(task)
            session.commit()
            return

        if "image_prompt_package" in wanted:
            if title_package_out is None:
                raise RuntimeError("Missing title_package output (cannot continue)")
            started = time.time()
            image_prompt_out = _build_dynamic_image_prompt_package(
                raw=raw,
                task=task,
                product_info=product_info_out,
                title_package=title_package_out,
            )
            shared_context = image_prompt_out.get("shared_context") if isinstance(image_prompt_out, dict) else {}
            image_prompt_input = {
                "selected_category_path": task.selected_category_id or "",
                "title_en_with_cn_translation": {"title_en": title_package_out.title_en},
                "four_grid_prompt_context": (shared_context or {}).get("four_grid_prompt_context") if isinstance(shared_context, dict) else {},
                "reference_images": (shared_context or {}).get("reference_images") if isinstance(shared_context, dict) else {},
            }
            ai_row.image_prompt_package = _snapshot(
                prompt="dynamic_image_prompt_context",
                model="code.dynamic_image_prompt_context",
                input_obj=image_prompt_input,
                output_obj=image_prompt_out,
                started_at=started,
                usage={},
                cost={},
                provider={"provider_source": "code", "provider_name": "dynamic_image_prompt_context"},
            )
            task.image_prompt_status = ImagePromptStatus.ready.value
        else:
            task.image_prompt_status = ImagePromptStatus.pending.value

        if "title_package" not in wanted and "title_package_lite" not in wanted:
            task.title_status = TitleStatus.pending.value

        task.main_status = TaskMainStatus.prompts_ready.value
        clear_task_exception(task, code="ai_pipeline_failed")
        session.add(ai_row)
        session.add(task)
        session.commit()
    except Exception as exc:  # noqa: BLE001
        task.main_status = TaskMainStatus.failed.value
        task.category_status = CategoryStatus.failed.value
        task.title_status = (
            TitleStatus.failed.value
            if ({"title_package", "title_package_lite"} & wanted)
            else TitleStatus.pending.value
        )
        task.image_prompt_status = (
            ImagePromptStatus.failed.value if "image_prompt_package" in wanted else ImagePromptStatus.pending.value
        )
        record_task_exception(
            task,
            code="ai_pipeline_failed",
            level="failed",
            status="ai_failed",
            message=f"AI pipeline failed: {exc}",
        )
        session.add(task)
        session.add(ai_row)
        session.commit()
