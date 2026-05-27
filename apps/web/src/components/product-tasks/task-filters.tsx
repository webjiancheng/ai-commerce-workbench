"use client";

type TaskFiltersProps = {
  isLogsRoute: boolean;
  keyword: string;
  status: string;
  categoryStatus: string;
  exportStatus: string;
  exceptionOnly: boolean;
  lowConfidenceOnly: boolean;
  onKeywordChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onCategoryStatusChange: (value: string) => void;
  onExportStatusChange: (value: string) => void;
  onToggleExceptionOnly: () => void;
  onToggleLowConfidenceOnly: () => void;
};

export function TaskFilters({
  isLogsRoute,
  keyword,
  status,
  categoryStatus,
  exportStatus,
  exceptionOnly,
  lowConfidenceOnly,
  onKeywordChange,
  onStatusChange,
  onCategoryStatusChange,
  onExportStatusChange,
  onToggleExceptionOnly,
  onToggleLowConfidenceOnly,
}: TaskFiltersProps) {
  const gridClass = isLogsRoute
    ? "lg:grid-cols-[1.4fr_0.75fr_0.75fr_0.75fr_auto]"
    : "lg:grid-cols-[1.3fr_0.7fr_0.7fr_0.7fr_auto]";

  return (
    <div className={["mt-6 grid gap-3", gridClass].join(" ")}>
      <input
        value={keyword}
        onChange={(event) => onKeywordChange(event.target.value)}
        placeholder="搜索：标题 / 平台 SKU"
        className="h-11 rounded-[16px] border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
      />
      <select
        value={status}
        onChange={(event) => onStatusChange(event.target.value)}
        className="h-11 rounded-[16px] border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
      >
        <option value="">主状态：全部</option>
        <option value="draft">草稿</option>
        <option value="collected">已采集</option>
        <option value="normalized">已清洗</option>
        <option value="ai_running">AI 处理中</option>
        <option value="ai_ready">AI 已完成</option>
        <option value="prompts_ready">提示词已准备</option>
        <option value="image_running">图片处理中</option>
        <option value="review_ready">待复核</option>
        <option value="export_ready">可导出</option>
        <option value="exported">已导出</option>
        <option value="failed">失败</option>
      </select>
      <select
        value={categoryStatus}
        onChange={(event) => onCategoryStatusChange(event.target.value)}
        className="h-11 rounded-[16px] border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
      >
        <option value="">类目状态：全部</option>
        <option value="pending">待处理</option>
        <option value="running">处理中</option>
        <option value="success">成功</option>
        <option value="low_confidence">类目待确认</option>
        <option value="failed">失败</option>
      </select>
      <select
        value={exportStatus}
        onChange={(event) => onExportStatusChange(event.target.value)}
        className="h-11 rounded-[16px] border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
      >
        <option value="">导出状态：全部</option>
        <option value="pending">待处理</option>
        <option value="ready">已就绪</option>
        <option value="running">处理中</option>
        <option value="exported">已导出</option>
        <option value="failed">失败</option>
      </select>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={onToggleExceptionOnly}
          className={[
            "h-11 rounded-full px-4 text-sm",
            exceptionOnly
              ? "border border-rose-300 bg-rose-50 text-rose-700"
              : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
          ].join(" ")}
        >
          {exceptionOnly ? "仅异常：开" : "仅异常：关"}
        </button>
        <button
          type="button"
          onClick={onToggleLowConfidenceOnly}
          className={[
            "h-11 rounded-full px-4 text-sm",
            lowConfidenceOnly
              ? "border border-amber-300 bg-amber-50 text-amber-800"
              : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
          ].join(" ")}
        >
          {lowConfidenceOnly ? "类目待确认：开" : "类目待确认：关"}
        </button>
      </div>
    </div>
  );
}
