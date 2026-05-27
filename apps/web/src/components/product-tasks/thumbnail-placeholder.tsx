export function ThumbnailPlaceholder({ label = "暂无图" }: { label?: string }) {
  return (
    <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-[10px] text-slate-400">
      {label}
    </div>
  );
}
