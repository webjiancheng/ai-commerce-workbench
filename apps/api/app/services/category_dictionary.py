from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


@dataclass(frozen=True)
class CategoryCandidate:
    path: str
    leaf: str
    score: float
    matched_terms: list[str] | None = None


TOKEN_RE = re.compile(r"[A-Za-z0-9]+|[\u4e00-\u9fff]+")


def _tokenize(text: str) -> list[str]:
    tokens: list[str] = []
    for part in TOKEN_RE.findall(text.lower()):
        if len(part) <= 1:
            continue
        tokens.append(part)
    return tokens


def _leaf_from_path(path: str) -> str:
    parts = [p.strip() for p in path.split(">") if p.strip()]
    return parts[-1] if parts else path


def _unique_category_paths() -> list[str]:
    dictionary = load_temu_category_dictionary()
    seen: set[str] = set()
    paths: list[str] = []
    for candidates in dictionary.values():
        if not isinstance(candidates, list):
            continue
        for path in candidates:
            path_text = str(path or "").strip()
            if not path_text or path_text in seen:
                continue
            seen.add(path_text)
            paths.append(path_text)
    return sorted(paths, key=lambda item: (len(item), item))


@lru_cache(maxsize=1)
def load_temu_category_dictionary() -> dict[str, list[str]]:
    repo_root = Path(__file__).resolve().parents[4]
    dictionary_path = repo_root / "temu_category_review_dict.json"
    with dictionary_path.open("r", encoding="utf-8") as file:
        payload = json.load(file)
    dictionary = payload.get("dictionary")
    if not isinstance(dictionary, dict):
        raise ValueError("Invalid temu_category_review_dict.json: missing 'dictionary'")
    return dictionary


def recall_category_candidates(
    *,
    query: str,
    exclude_terms: list[str] | None = None,
    limit: int = 50,
) -> list[CategoryCandidate]:
    """
    Recall candidates from the category dictionary (non-AI) based on a lightweight match score.

    Dictionary format (current repo): { leaf_or_alias: [full_path, ...] }
    """
    query = (query or "").strip()
    if not query:
        return []

    dictionary = load_temu_category_dictionary()
    query_tokens = _tokenize(query)
    if not query_tokens:
        return []
    exclude_tokens = _tokenize(" ".join(exclude_terms or []))

    candidates: list[CategoryCandidate] = []
    query_lc = query.lower()

    for key, paths in dictionary.items():
        if not paths:
            continue
        key_lc = key.lower()

        for path in paths[:5]:
            path_lc = path.lower()
            leaf_lc = _leaf_from_path(path).lower()
            score = 0.0

            if query_lc and query_lc in path_lc:
                score += 2.6
            if query_lc and query_lc in key_lc:
                score += 1.6

            for token in query_tokens:
                if token in leaf_lc:
                    score += 1.45
                elif token in path_lc:
                    score += 0.95
                if token in key_lc:
                    score += 0.7

            for token in exclude_tokens:
                if token in leaf_lc:
                    score -= 1.4
                elif token in path_lc:
                    score -= 1.0
                if token in key_lc:
                    score -= 0.8

            if score <= 0:
                continue
            candidates.append(
                CategoryCandidate(
                    path=path,
                    leaf=_leaf_from_path(path),
                    score=score,
                    matched_terms=[token for token in query_tokens if token in path_lc or token in key_lc],
                )
            )

    candidates.sort(key=lambda item: (item.score, len(item.path)), reverse=True)

    # de-dup by path
    seen: set[str] = set()
    unique: list[CategoryCandidate] = []
    for item in candidates:
        if item.path in seen:
            continue
        seen.add(item.path)
        unique.append(item)
        if len(unique) >= limit:
            break
    return unique


def recall_category_candidates_multi(
    *,
    queries: list[str],
    exclude_terms: list[str] | None = None,
    limit: int = 10,
) -> list[CategoryCandidate]:
    merged: dict[str, CategoryCandidate] = {}
    for idx, query in enumerate(queries):
        q = (query or "").strip()
        if not q:
            continue
        weight = max(0.35, 1.0 - (idx * 0.12))
        for item in recall_category_candidates(query=q, exclude_terms=exclude_terms, limit=max(limit * 3, 30)):
            existing = merged.get(item.path)
            weighted_score = item.score * weight
            matched_terms = list(item.matched_terms or [])
            if existing is None or weighted_score > existing.score:
                merged[item.path] = CategoryCandidate(
                    path=item.path,
                    leaf=item.leaf,
                    score=weighted_score,
                    matched_terms=matched_terms,
                )
                continue
            existing_terms = set(existing.matched_terms or [])
            merged[item.path] = CategoryCandidate(
                path=existing.path,
                leaf=existing.leaf,
                score=max(existing.score, weighted_score),
                matched_terms=sorted(existing_terms | set(matched_terms)),
            )

    ranked = sorted(merged.values(), key=lambda item: (item.score, len(item.path)), reverse=True)
    return ranked[:limit]


def search_category_paths(*, query: str = "", limit: int = 200) -> list[str]:
    all_paths = _unique_category_paths()
    q = (query or "").strip()
    if not q:
        return all_paths[:limit]

    q_lc = q.lower()
    query_tokens = _tokenize(q)
    ranked: list[tuple[float, str]] = []
    for path in all_paths:
        path_lc = path.lower()
        leaf_lc = _leaf_from_path(path).lower()
        score = 0.0
        if q_lc in leaf_lc:
            score += 3.0
        if q_lc in path_lc:
            score += 2.0
        for token in query_tokens:
            if token in leaf_lc:
                score += 1.4
            elif token in path_lc:
                score += 0.8
        if score <= 0:
            continue
        ranked.append((score, path))

    ranked.sort(key=lambda item: (item[0], -len(item[1])), reverse=True)
    return [path for _, path in ranked[:limit]]
