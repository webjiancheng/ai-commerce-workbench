"use client";

import { useState } from "react";

import { apiBaseUrl } from "@/lib/api";
import type { ProductTaskListItem, RowMeta } from "@/features/product-tasks/types";

type WorkbenchDetailResponse = {
  task: RowMeta["detail"];
  raw: RowMeta["raw"];
  assets: RowMeta["assets"];
  export_draft: RowMeta["exportDraft"];
};

function rowMetaFromWorkbenchDetail(payload: WorkbenchDetailResponse): RowMeta {
  return {
    raw: payload.raw || null,
    assets: payload.assets || {},
    detail: payload.task || null,
    exportDraft: payload.export_draft || null,
  };
}

export function useTaskRowMeta() {
  const [rowMeta, setRowMeta] = useState<Record<number, RowMeta>>({});
  const [quickTitleDrafts, setQuickTitleDrafts] = useState<Record<number, string>>({});
  const [quickCategoryDrafts, setQuickCategoryDrafts] = useState<Record<number, string>>({});

  async function loadRowMeta(items: ProductTaskListItem[]): Promise<void> {
    const pairs = await Promise.all(
      items.map(async (item) => {
        try {
          const response = await fetch(`${apiBaseUrl}/api/product-tasks/${item.id}/workbench-detail`, {
            cache: "no-store",
          });
          if (!response.ok) {
            return [item.id, { raw: null, assets: {}, detail: null, exportDraft: null }] as const;
          }
          const payload = (await response.json()) as WorkbenchDetailResponse;
          return [item.id, rowMetaFromWorkbenchDetail(payload)] as const;
        } catch {
          return [item.id, { raw: null, assets: {}, detail: null, exportDraft: null }] as const;
        }
      }),
    );

    const nextMeta = Object.fromEntries(pairs) as Record<number, RowMeta>;
    setRowMeta(nextMeta);
    setQuickTitleDrafts((prev) => {
      const next = { ...prev };
      for (const item of items) {
        const meta = nextMeta[item.id];
        if (!next[item.id]) {
          next[item.id] = String(
            meta?.exportDraft?.fields_json?.["英文名称"] ||
              meta?.exportDraft?.fields_json?.product_title_en ||
              meta?.detail?.ai?.title_en ||
              "",
          ).trim();
        }
      }
      return next;
    });
    setQuickCategoryDrafts((prev) => {
      const next = { ...prev };
      for (const item of items) {
        const meta = nextMeta[item.id];
        if (!next[item.id]) {
          next[item.id] =
            meta?.detail?.selected_category_id || meta?.detail?.ai?.category_best_path || item.selected_category_id || "";
        }
      }
      return next;
    });
  }

  return {
    rowMeta,
    setRowMeta,
    quickTitleDrafts,
    setQuickTitleDrafts,
    quickCategoryDrafts,
    setQuickCategoryDrafts,
    loadRowMeta,
  };
}

