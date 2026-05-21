const phaseCards = [
  {
    title: "采集入口",
    value: "Chrome 插件",
    description: "从 Temu、1688、Amazon 等商品页抓标题、价格、主图、SKU 图、详情图和截图。",
  },
  {
    title: "工作方式",
    value: "批量处理",
    description: "先筛原始采集数据，再批量生成商品任务，适合运营连续处理一批商品。",
  },
  {
    title: "最终输出",
    value: "Excel 导出",
    description: "基于模板字段映射和图片最终图选择，生成平台可直接继续处理的表格。",
  },
];

const quickLinks = [
  { href: "/raw-products", label: "进入原始采集数据", tone: "primary" },
  { href: "/product-tasks", label: "进入商品任务", tone: "secondary" },
  { href: "/exports", label: "查看导出中心", tone: "ghost" },
];

export default function Home() {
  return (
    <main className="min-h-screen px-6 py-10 md:px-10">
      <section className="mx-auto flex max-w-7xl flex-col gap-8">
        <div className="overflow-hidden rounded-[32px] border border-[var(--card-border)] bg-[linear-gradient(135deg,rgba(255,255,255,0.92),rgba(255,255,255,0.72))] p-8 shadow-[0_24px_90px_rgba(10,37,64,0.10)] backdrop-blur md:p-10">
          <div className="grid gap-8 lg:grid-cols-[1.18fr_0.82fr]">
            <div>
              <div className="mb-5 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold tracking-[0.18em] text-emerald-700 uppercase">
                Cross-border Listing Flow
              </div>
              <h1 className="max-w-4xl text-4xl font-semibold leading-tight tracking-tight text-[var(--accent-ink)] md:text-5xl">
                用一条业务链路把采集、整理、AI 处理、图片管理和 Temu 导出串起来。
              </h1>
              <p className="mt-5 max-w-3xl text-base leading-7 text-slate-600">
                这不是一个重型 ERP，而是面向跨境运营的上架工作台。重点是批量可处理、字段可追溯、图片可复核、导出能落地。
              </p>

              <div className="mt-7 flex flex-wrap gap-3">
                {quickLinks.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    className={[
                      "inline-flex rounded-full px-5 py-3 text-sm font-medium transition",
                      item.tone === "primary"
                        ? "bg-[linear-gradient(135deg,#14b8a6,#0f766e)] text-white shadow-[0_14px_40px_rgba(20,184,166,0.28)]"
                        : item.tone === "secondary"
                          ? "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                          : "border border-transparent bg-slate-100 text-slate-700 hover:bg-slate-200",
                    ].join(" ")}
                  >
                    {item.label}
                  </a>
                ))}
              </div>
            </div>

            <div className="grid gap-4">
              <div className="rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#0a2540,#123a59)] p-5 text-white shadow-[0_18px_48px_rgba(10,37,64,0.28)]">
                <div className="text-xs uppercase tracking-[0.22em] text-cyan-200">核心流程</div>
                <div className="mt-4 space-y-3 text-sm">
                  <div className="rounded-[18px] border border-white/10 bg-white/8 px-4 py-3">1. 插件采集商品详情页</div>
                  <div className="rounded-[18px] border border-white/10 bg-white/8 px-4 py-3">2. 原始采集数据筛选与批量建任务</div>
                  <div className="rounded-[18px] border border-white/10 bg-white/8 px-4 py-3">3. AI 文案与图片处理</div>
                  <div className="rounded-[18px] border border-white/10 bg-white/8 px-4 py-3">4. 默认值补齐与 Excel 导出</div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-[22px] border border-slate-200 bg-white/88 p-5">
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-500">本地地址</div>
                  <div className="mt-3 space-y-2 text-sm text-slate-700">
                    <div>Web: `http://127.0.0.1:3000`</div>
                    <div>API: `http://127.0.0.1:8000`</div>
                    <div>插件: `chrome-extension/`</div>
                  </div>
                </div>
                <div className="rounded-[22px] border border-amber-200 bg-amber-50/88 p-5">
                  <div className="text-xs uppercase tracking-[0.16em] text-amber-700">当前目标</div>
                  <div className="mt-3 text-sm leading-6 text-amber-900">
                    让普通运营能看懂采集结果、批量处理任务、看到图片状态，并顺利导出平台表格。
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <section className="grid gap-5 md:grid-cols-3">
          {phaseCards.map((card) => (
            <article
              key={card.title}
              className="rounded-[24px] border border-[var(--card-border)] bg-[rgba(255,255,255,0.82)] p-6 shadow-[0_12px_40px_rgba(15,23,42,0.06)] backdrop-blur"
            >
              <div className="text-sm text-slate-500">{card.title}</div>
              <div className="mt-3 text-2xl font-semibold text-[var(--accent-ink)]">{card.value}</div>
              <p className="mt-3 text-sm leading-6 text-slate-600">{card.description}</p>
            </article>
          ))}
        </section>
      </section>
    </main>
  );
}
