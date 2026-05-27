export function statusBadgeColor(status: string): string {
  if (status === "failed") return "bg-rose-100 text-rose-700 border-rose-200";
  if (status === "exported") return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (status.endsWith("running") || status === "running") {
    return "bg-amber-100 text-amber-800 border-amber-200";
  }
  if (status === "success" || status === "ready") {
    return "bg-emerald-100 text-emerald-700 border-emerald-200";
  }
  return "bg-slate-100 text-slate-700 border-slate-200";
}

export function statusText(status: string): string {
  const map: Record<string, string> = {
    draft: "草稿",
    collected: "已采集",
    normalized: "已清洗",
    ai_running: "AI 处理中",
    ai_ready: "AI 已完成",
    prompts_ready: "提示词已准备",
    image_running: "图片处理中",
    review_ready: "待复核",
    export_ready: "可导出",
    exported: "已导出",
    failed: "失败",
    pending: "待处理",
    queued: "已排队",
    started: "已启动",
    running: "处理中",
    success: "成功",
    warning: "警告",
    low_confidence: "类目待确认",
    ready: "已就绪",
    skipped: "已跳过",
  };
  return map[status] || status;
}

export function StatusBadge({
  status,
  prefix,
  className,
}: {
  status: string;
  prefix?: string;
  className?: string;
}) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full border px-2.5 py-1 font-medium",
        statusBadgeColor(status),
        className || "",
      ].join(" ")}
    >
      {prefix ? `${prefix}${statusText(status)}` : statusText(status)}
    </span>
  );
}
