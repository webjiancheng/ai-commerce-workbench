"use client";

export function CompareCard({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "raw" | "ai" | "final" | "neutral";
  items: { label: string; value: string }[];
}) {
  async function onCopyText(text: string): Promise<void> {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore copy failures
    }
  }
  const toneClass =
    tone === "raw"
      ? "border-slate-200 bg-slate-50"
      : tone === "ai"
        ? "border-sky-200 bg-sky-50"
        : tone === "neutral"
          ? "border-slate-300 bg-slate-100"
          : "border-emerald-200 bg-emerald-50";

  return (
    <div className={["rounded-[18px] border p-4", toneClass].join(" ")}>
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      <div className="mt-3 space-y-3">
        {items.map((item) => (
          <div key={`${title}-${item.label}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-slate-500">{item.label}</div>
              {item.value && item.value !== "-" ? (
                <button
                  type="button"
                  onClick={() => void onCopyText(item.value)}
                  className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
                >
                  复制
                </button>
              ) : null}
            </div>
            <div className="mt-1 whitespace-pre-wrap break-all text-sm text-slate-800">{item.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
