"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const SIDEBAR_COLLAPSED_KEY = "ai-caiji.workbench.sidebarCollapsed";
const SETTINGS_EXPANDED_KEY = "ai-caiji.workbench.settingsExpanded";

type NavItem = {
  href: string;
  label: string;
  shortLabel: string;
  disabled?: boolean;
};

const mainNavItems: NavItem[] = [
  { href: "/", label: "工作台", shortLabel: "台" },
  { href: "/logs", label: "任务日志", shortLabel: "志" },
  { href: "/raw-products", label: "原始采集数据", shortLabel: "采" },
  { href: "/product-tasks", label: "上架加工工作台", shortLabel: "工" },
];

const settingsBaseItems: NavItem[] = [
  { href: "/settings", label: "系统设置", shortLabel: "设" },
  { href: "/settings/ai", label: "AI 配置向导", shortLabel: "AI" },
  { href: "/prompts", label: "提示词中心", shortLabel: "词" },
  { href: "/rules", label: "上架默认值", shortLabel: "值" },
];

const settingsAdvancedItems: NavItem[] = [
  { href: "/exports", label: "导出中心", shortLabel: "导" },
  { href: "/batch-edit", label: "批图队列", shortLabel: "批" },
];

function safeParseBoolean(value: string | null): boolean | null {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

export function WorkbenchShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(true);
  const [settingsExpanded, setSettingsExpanded] = useState(false);

  useEffect(() => {
    const stored = safeParseBoolean(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY));
    if (stored !== null) setCollapsed(stored);
    const storedSettings = safeParseBoolean(window.localStorage.getItem(SETTINGS_EXPANDED_KEY));
    if (storedSettings !== null) setSettingsExpanded(storedSettings);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    window.localStorage.setItem(SETTINGS_EXPANDED_KEY, String(settingsExpanded));
  }, [settingsExpanded]);

  const activeHref = useMemo(() => {
    if (pathname === "/") return "/";
    const allItems = [...mainNavItems, ...settingsBaseItems, ...settingsAdvancedItems];
    const matched = allItems.find((item) => item.href !== "/" && pathname.startsWith(item.href));
    return matched?.href ?? pathname;
  }, [pathname]);

  const renderNavItems = (items: NavItem[]) =>
    items.map((item) => {
      const isActive = item.href === activeHref;
      const baseClass = "group flex items-center gap-3 rounded-[14px] px-3 py-2 text-sm transition";
      const activeClass = isActive
        ? "bg-[linear-gradient(135deg,#14b8a6,#0f766e)] text-white shadow-[0_10px_30px_rgba(20,184,166,0.28)]"
        : "text-slate-100 hover:bg-white/10";
      const disabledClass = item.disabled ? "pointer-events-none opacity-40" : "";

      return (
        <Link
          key={item.href}
          href={item.href}
          aria-disabled={item.disabled}
          className={[baseClass, activeClass, disabledClass].join(" ")}
          title={collapsed ? item.label : undefined}
        >
          <span
            className={[
              "flex h-9 w-9 items-center justify-center rounded-[12px] border text-xs font-semibold",
              isActive
                ? "border-white/15 bg-white/10 text-white"
                : "border-white/10 bg-white/8 text-slate-100 group-hover:bg-white/12",
            ].join(" ")}
          >
            {item.shortLabel}
          </span>
          {!collapsed ? <span className="truncate">{item.label}</span> : null}
        </Link>
      );
    });

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(13,148,136,0.16),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(245,158,11,0.16),transparent_28%),linear-gradient(180deg,#f5f7f4_0%,#eef4f1_44%,#e8f0ee_100%)] text-slate-900">
      <div className="flex min-h-screen">
        <aside
          className={[
            "sticky top-0 h-screen shrink-0 border-r border-white/50 bg-[rgba(10,37,64,0.78)] text-white backdrop-blur-xl",
            collapsed ? "w-[72px]" : "w-[248px]",
          ].join(" ")}
        >
          <div className="flex h-full flex-col px-3 py-4">
            <div className="flex items-center justify-between gap-2 px-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold tracking-[0.02em] text-white">
                  {collapsed ? "A+" : "AI 跨境上架台"}
                </div>
                {!collapsed ? (
                  <div className="text-xs text-slate-300">采集 · AI · 图片 · 导出</div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setCollapsed((value) => !value)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/8 text-white hover:bg-white/14"
                aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
                title={collapsed ? "展开" : "收起"}
              >
                {collapsed ? "»" : "«"}
              </button>
            </div>

            {!collapsed ? (
              <div className="mt-5 rounded-[20px] border border-white/10 bg-white/8 px-4 py-4 text-white">
                <div className="text-[11px] uppercase tracking-[0.24em] text-emerald-200">Global Seller Flow</div>
                <div className="mt-2 text-lg font-semibold leading-6">从插件采集到 Temu 导出，一条链路完成。</div>
                <div className="mt-3 flex gap-2 text-[11px] text-slate-200">
                  <span className="rounded-full border border-white/10 bg-white/10 px-2 py-1">批量优先</span>
                  <span className="rounded-full border border-white/10 bg-white/10 px-2 py-1">运营可读</span>
                </div>
              </div>
            ) : null}

            <nav className="mt-6 flex flex-1 flex-col gap-4">
              <div className="flex flex-col gap-1">
                {!collapsed ? (
                  <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">
                    工作区
                  </div>
                ) : null}
                {renderNavItems(mainNavItems)}
              </div>
              <div className="flex flex-col gap-1">
                {!collapsed ? (
                  <button
                    type="button"
                    className="flex items-center justify-between px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300"
                    onClick={() => setSettingsExpanded((value) => !value)}
                  >
                    <span>设置</span>
                    <span>{settingsExpanded ? "−" : "+"}</span>
                  </button>
                ) : null}
                {renderNavItems(settingsBaseItems)}
                {!collapsed && settingsExpanded ? (
                  <div className="mt-1 flex flex-col gap-1">
                    <div className="px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-slate-400">高级工具</div>
                    {renderNavItems(settingsAdvancedItems)}
                  </div>
                ) : null}
              </div>
            </nav>

            <div className="mt-4 rounded-[18px] border border-white/10 bg-white/8 px-3 py-3 text-xs text-slate-200">
              {collapsed ? (
                <div className="text-center">v0.1</div>
              ) : (
                <>
                  <div className="font-medium text-white">当前定位</div>
                  <div className="mt-1 leading-5">
                    面向跨境电商运营的批量上架工具，不做重 ERP，强调采集、整理、AI 处理和导出效率。
                  </div>
                </>
              )}
            </div>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <div className="pointer-events-none fixed inset-x-0 top-0 z-0 h-32 bg-[linear-gradient(180deg,rgba(255,255,255,0.34),transparent)]" />
          {children}
        </div>
      </div>
    </div>
  );
}
