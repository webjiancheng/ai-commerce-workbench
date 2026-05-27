"use client";

import { useEffect, useMemo, useState } from "react";

import { apiBaseUrl } from "@/lib/api";
import type {
  CategoryStatus,
  ExportStatus,
  ProductTaskListItem,
  ProductTaskListResponse,
  ProductTaskTimelineResponse,
  TaskMainStatus,
} from "@/features/product-tasks/types";

function buildQuery(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== "") query.set(key, value);
  });
  return query.toString() ? `?${query.toString()}` : "";
}

type UseProductTaskListOptions = {
  initialExceptionOnly: boolean;
  initialLowConfidenceOnly: boolean;
  onItemsLoaded?: (items: ProductTaskListItem[]) => void;
};

export function useProductTaskList(options: UseProductTaskListOptions) {
  const { initialExceptionOnly, initialLowConfidenceOnly, onItemsLoaded } = options;
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<TaskMainStatus | "">("");
  const [categoryStatus, setCategoryStatus] = useState<CategoryStatus | "">("");
  const [exportStatus, setExportStatus] = useState<ExportStatus | "">("");
  const [exceptionOnly, setExceptionOnly] = useState<boolean>(initialExceptionOnly);
  const [lowConfidenceOnly, setLowConfidenceOnly] = useState<boolean>(initialLowConfidenceOnly);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ProductTaskListResponse>({
    items: [],
    total: 0,
    limit: 20,
    offset: 0,
  });
  const [timelineMap, setTimelineMap] = useState<Record<number, ProductTaskTimelineResponse>>({});
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const queryString = useMemo(() => {
    return buildQuery({
      limit: String(data.limit),
      offset: String(data.offset),
      keyword: keyword.trim() ? keyword.trim() : undefined,
      status: status || undefined,
      category_status: categoryStatus || undefined,
      export_status: exportStatus || undefined,
      exception: exceptionOnly ? "true" : undefined,
      low_confidence: lowConfidenceOnly ? "true" : undefined,
    });
  }, [keyword, status, categoryStatus, exportStatus, exceptionOnly, lowConfidenceOnly, data.limit, data.offset]);

  async function loadTaskTimeline(taskId: number): Promise<ProductTaskTimelineResponse> {
    const response = await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}/timeline`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as ProductTaskTimelineResponse;
  }

  async function loadTimelines(items: ProductTaskListItem[]): Promise<void> {
    if (!items.length) {
      setTimelineMap({});
      return;
    }
    try {
      const results = await Promise.all(items.map((item) => loadTaskTimeline(item.id)));
      setTimelineMap(
        results.reduce<Record<number, ProductTaskTimelineResponse>>((acc, timeline) => {
          acc[timeline.task_id] = timeline;
          return acc;
        }, {}),
      );
    } catch (err) {
      console.error("Failed to load task timelines", err);
    }
  }

  async function loadList(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${apiBaseUrl}/api/product-tasks${queryString}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = (await response.json()) as ProductTaskListResponse;
      setData((prev) => ({ ...prev, ...result }));
      setSelectedIds((prev) => prev.filter((id) => result.items.some((item) => item.id === id)));
      onItemsLoaded?.(result.items);
      void loadTimelines(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load product tasks");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryString]);

  const currentPage = Math.floor(data.offset / data.limit) + 1;
  const totalPages = Math.max(1, Math.ceil((data.total || 0) / data.limit));
  const allSelected = data.items.length > 0 && selectedIds.length === data.items.length;

  function changePage(nextPage: number): void {
    const safePage = Math.min(Math.max(1, nextPage), totalPages);
    setData((prev) => ({ ...prev, offset: (safePage - 1) * prev.limit }));
  }

  function changePageSize(nextLimit: number): void {
    setData((prev) => ({ ...prev, limit: nextLimit, offset: 0 }));
  }

  function toggleSelectAll(): void {
    if (allSelected) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds(data.items.map((item) => item.id));
  }

  function toggleSelect(id: number): void {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }

  function upsertTimeline(taskId: number, timeline: ProductTaskTimelineResponse): void {
    setTimelineMap((prev) => ({ ...prev, [taskId]: timeline }));
  }

  return {
    keyword,
    setKeyword,
    status,
    setStatus,
    categoryStatus,
    setCategoryStatus,
    exportStatus,
    setExportStatus,
    exceptionOnly,
    setExceptionOnly,
    lowConfidenceOnly,
    setLowConfidenceOnly,
    loading,
    error,
    setError,
    data,
    timelineMap,
    selectedIds,
    setSelectedIds,
    queryString,
    loadList,
    loadTaskTimeline,
    currentPage,
    totalPages,
    allSelected,
    changePage,
    changePageSize,
    toggleSelectAll,
    toggleSelect,
    upsertTimeline,
  };
}

