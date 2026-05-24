"use client";

import { apiBaseUrl } from "@/lib/api";
import Link from "next/link";
import { useEffect, useState } from "react";

type Overview = {
  defaults: {
    image_provider: { provider_name: string; display_name: string; api_key_configured: boolean; masked_key?: string } | null;
    text_provider: { provider_name: string; display_name: string; api_key_configured: boolean; masked_key?: string } | null;
    storage_provider: { provider_name: string; display_name: string; api_key_configured: boolean; masked_key?: string } | null;
    export_template: { id: number; name: string; version: string; platform: string } | null;
  };
  cost_config: { enabled: boolean; config_json: Record<string, unknown> };
};

type Health = {
  db: { ok: boolean; error?: string | null };
  storage: { ok: boolean | null; root?: string };
  worker: { ok: boolean | null; note?: string };
  redis: { ok: boolean | null; note?: string };
};

export default function SettingsPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    setError(null);
    try {
      const [oRes, hRes] = await Promise.all([
        fetch(`${apiBaseUrl}/api/settings/overview`, { cache: "no-store" }),
        fetch(`${apiBaseUrl}/api/system/health`, { cache: "no-store" }),
      ]);
      if (!oRes.ok) throw new Error(`overview HTTP ${oRes.status}`);
      if (!hRes.ok) throw new Error(`health HTTP ${hRes.status}`);
      const o = (await oRes.json()) as Overview;
      const h = (await hRes.json()) as Health;
      setOverview(o);
      setHealth(h);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="min-h-screen px-4 py-6 md:px-6">
      <section className=" space-y-6">
        <header className="rounded-[28px] border border-[var(--card-border)] bg-[var(--card)] p-6 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="text-sm text-slate-500">运营配置总览</div>
          <h1 className="mt-1 text-3xl font-semibold">系统设置</h1>
          <div className="mt-2 text-sm text-slate-600">
            只保留运营能看懂的设置分组：AI 模型、图片存储、导出模板、费用限制、系统状态。
          </div>
        </header>

        {error ? (
          <div className="rounded-[18px] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-[24px] border border-slate-200 bg-white p-6">
            <div className="text-sm font-semibold text-slate-900">AI 模型设置</div>
            <div className="mt-4 space-y-3 text-sm text-slate-700">
              <Item
                label="图片模型"
                value={
                  overview?.defaults.image_provider
                    ? `${overview.defaults.image_provider.display_name}（${overview.defaults.image_provider.provider_name}）`
                    : "-"
                }
                sub={
                  overview?.defaults.image_provider
                    ? overview.defaults.image_provider.api_key_configured
                      ? `接口密钥已配置 ${overview.defaults.image_provider.masked_key || ""}`
                      : "接口密钥未配置"
                    : undefined
                }
              />
              <Item
                label="文字模型"
                value={
                  overview?.defaults.text_provider
                    ? `${overview.defaults.text_provider.display_name}（${overview.defaults.text_provider.provider_name}）`
                    : "-"
                }
                sub={
                  overview?.defaults.text_provider
                    ? overview.defaults.text_provider.api_key_configured
                      ? `接口密钥已配置 ${overview.defaults.text_provider.masked_key || ""}`
                      : "接口密钥未配置"
                    : undefined
                }
              />
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-6">
            <div className="text-sm font-semibold text-slate-900">图片存储设置</div>
            <div className="mt-4 space-y-3 text-sm text-slate-700">
              <Item
                label="图片存储方式"
                value={
                  overview?.defaults.storage_provider
                    ? `${overview.defaults.storage_provider.display_name}（${overview.defaults.storage_provider.provider_name}）`
                    : "-"
                }
              />
              <Item label="存储状态" value={health ? (health.storage.ok ? "可用" : "异常") : "-"} sub={health?.storage.root || ""} />
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-6">
            <div className="text-sm font-semibold text-slate-900">导出模板设置</div>
            <div className="mt-4 space-y-3 text-sm text-slate-700">
              <Item
                label="当前导出模板"
                value={
                  overview?.defaults.export_template
                    ? `${overview.defaults.export_template.name}（${overview.defaults.export_template.version}）`
                    : "-"
                }
              />
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link
                href="/settings/ai"
                className="h-10 rounded-full border border-slate-200 bg-white px-4 text-sm leading-10 text-slate-700 hover:bg-slate-50"
              >
                AI 配置向导（推荐）
              </Link>
              <Link
                href="/settings/providers"
                className="h-10 rounded-full border border-slate-200 bg-white px-4 text-sm leading-10 text-slate-700 hover:bg-slate-50"
              >
                AI 与存储配置
              </Link>
              <Link
                href="/exports"
                className="h-10 rounded-full border border-slate-200 bg-white px-4 text-sm leading-10 text-slate-700 hover:bg-slate-50"
              >
                导出模板与字段映射
              </Link>
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-6">
            <div className="text-sm font-semibold text-slate-900">费用与限制</div>
            <div className="mt-4 space-y-3 text-sm text-slate-700">
              <Item
                label="费用控制"
                value={overview ? (overview.cost_config.enabled ? "已开启" : "未开启") : "-"}
              />
              <Link
                href="/settings/cost"
                className="inline-flex h-10 rounded-full border border-slate-200 bg-white px-4 text-sm leading-10 text-slate-700 hover:bg-slate-50"
              >
                打开费用限制设置
              </Link>
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-6 lg:col-span-2">
            <div className="text-sm font-semibold text-slate-900">系统状态</div>
            <div className="mt-4 grid gap-3 md:grid-cols-4 text-sm text-slate-700">
              <Item label="数据库" value={health ? (health.db.ok ? "正常" : "异常") : "-"} sub={health?.db.error || ""} />
              <Item label="图片存储" value={health ? (health.storage.ok ? "正常" : "异常") : "-"} sub={health?.storage.root || ""} />
              <Item label="后台任务" value={health ? (health.worker.ok ? "正常" : "异常") : "-"} sub={health?.worker.note || ""} />
              <Item label="缓存队列" value={health ? (health.redis.ok ? "正常" : "异常") : "-"} sub={health?.redis.note || ""} />
            </div>
            <div className="mt-5">
              <button
                type="button"
                onClick={() => void load()}
                className="h-10 rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50"
              >
                刷新
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function Item({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 font-medium text-slate-900">{value}</div>
      {sub ? <div className="mt-1 break-all text-xs text-slate-600">{sub}</div> : null}
    </div>
  );
}
