"use client";

import type { ReactNode } from "react";

export type TaskDrawerSize = "50" | "70" | "100";
export type TaskDrawerTab = "trace" | "images" | "info" | "defaults" | "raw";

type TaskDrawerProps = {
  open: boolean;
  isLogsRoute: boolean;
  activeTaskId: number | null;
  taskTitle: string;
  loading: boolean;
  syncing: boolean;
  error: string | null;
  size: TaskDrawerSize;
  tab: TaskDrawerTab;
  onClose: () => void;
  onSync: () => Promise<void>;
  onSizeChange: (size: TaskDrawerSize) => void;
  onTabChange: (tab: TaskDrawerTab) => void;
  content: ReactNode;
};

export function TaskDrawer({
  open,
  isLogsRoute,
  activeTaskId,
  taskTitle,
  loading,
  syncing,
  error,
  size,
  tab,
  onClose,
  onSync,
  onSizeChange,
  onTabChange,
  content,
}: TaskDrawerProps) {
  if (!open) return null;

  const drawerWidthClass = size === "50" ? "w-1/2" : size === "70" ? "w-[70%]" : "w-full";
  const tabs = isLogsRoute
    ? ([
        { key: "trace", label: "流程排查" },
        { key: "info", label: "商品信息" },
      ] as const)
    : ([
        { key: "images", label: "图片处理" },
        { key: "info", label: "商品信息" },
        { key: "defaults", label: "上架补充" },
        { key: "raw", label: "原始采集" },
      ] as const);

  return (
    <div className="fixed inset-0 z-50">
      <button type="button" className="absolute inset-0 bg-black/30" aria-label="关闭详情抽屉" onClick={onClose} />
      <aside
        className={[
          "absolute right-0 top-0 h-full border-l border-slate-200 bg-white shadow-[0_30px_120px_rgba(15,23,42,0.22)]",
          drawerWidthClass,
        ].join(" ")}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div className="min-w-0">
              <div className="text-xs text-slate-500">
                任务详情 {activeTaskId ? `#${activeTaskId}` : ""}
              </div>
              <div className="mt-1 truncate text-sm font-semibold text-slate-900">
                {taskTitle || (loading ? "加载中…" : "未加载")}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void onSync()}
                disabled={!activeTaskId || syncing}
                className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {syncing ? "保存中..." : "保存并同步"}
              </button>
              <div className="hidden items-center gap-1 rounded-full border border-slate-200 bg-slate-50 p-1 sm:flex">
                {(["50", "70", "100"] as const).map((nextSize) => (
                  <button
                    key={nextSize}
                    type="button"
                    onClick={() => onSizeChange(nextSize)}
                    className={[
                      "rounded-full px-3 py-1 text-xs",
                      size === nextSize
                        ? "bg-slate-900 text-white"
                        : "text-slate-600 hover:bg-white",
                    ].join(" ")}
                    title={nextSize === "50" ? "50%" : nextSize === "70" ? "70%" : "全屏"}
                  >
                    {nextSize === "100" ? "全屏" : `${nextSize}%`}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                aria-label="关闭"
                title="关闭"
              >
                ×
              </button>
            </div>
          </div>

          <div className="border-b border-slate-200 px-5 py-3">
            <div className="flex flex-wrap gap-2">
              {tabs.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onTabChange(item.key)}
                  className={[
                    "rounded-full border px-4 py-2 text-sm",
                    tab === item.key
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                  ].join(" ")}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-auto p-5">
            {error ? (
              <div className="rounded-[18px] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                {error}
              </div>
            ) : loading ? (
              <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                正在加载…
              </div>
            ) : (
              content
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
