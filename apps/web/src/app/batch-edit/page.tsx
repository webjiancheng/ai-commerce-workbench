"use client";

import { apiBaseUrl } from "@/lib/api";
import { useEffect, useState } from "react";

type QueueItem = {
  id: number;
  product_task_id: number;
  asset_id: number;
  slot: string;
  operation_type: string;
  status: string;
  created_at: string;
};

export default function BatchEditPage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    setError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/batch-edit-queue?limit=100`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { items: QueueItem[] };
      setItems(data.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="min-h-screen px-4 py-6 md:px-6">
      <section className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-[28px] border border-[var(--card-border)] bg-[var(--card)] p-6 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="text-sm text-slate-500">阶段 9 / 批图工具预留</div>
          <h1 className="mt-1 text-3xl font-semibold">批图队列（占位）</h1>
          <div className="mt-2 text-sm text-slate-600">仅展示队列结构，不实现实际图片编辑</div>
        </header>

        {error ? (
          <div className="rounded-[18px] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="rounded-[24px] border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-900">队列列表</div>
            <button
              type="button"
              onClick={() => void load()}
              className="h-10 rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50"
            >
              刷新
            </button>
          </div>

          <div className="mt-4 overflow-hidden rounded-[18px] border border-slate-200">
            <div className="grid grid-cols-[90px_120px_120px_1fr_140px_160px] border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-700">
              <div>ID</div>
              <div>task_id</div>
              <div>asset_id</div>
              <div>slot</div>
              <div>operation</div>
              <div>status</div>
            </div>
            <div className="divide-y divide-slate-100 bg-white">
              {items.map((i) => (
                <div
                  key={i.id}
                  className="grid grid-cols-[90px_120px_120px_1fr_140px_160px] px-4 py-2 text-xs text-slate-700"
                >
                  <div className="font-mono">{i.id}</div>
                  <div className="font-mono">{i.product_task_id}</div>
                  <div className="font-mono">{i.asset_id}</div>
                  <div className="font-mono">{i.slot}</div>
                  <div>{i.operation_type}</div>
                  <div>{i.status}</div>
                </div>
              ))}
              {items.length ? null : (
                <div className="px-4 py-4 text-sm text-slate-600">暂无队列</div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
