import Link from "next/link";

const STEPS = [
  {
    title: "步骤 1：准备 API Key",
    lines: [
      "去模型平台后台创建 API Key（建议单独创建工作台专用 Key）。",
      "先确认这个 Key 有你要用的模型权限，比如文案模型和生图模型。",
      "如果测试失败，先排查 Key 权限，再排查余额和限流。",
    ],
  },
  {
    title: "步骤 2：新增接口",
    lines: [
      "在 AI 配置向导点“新增接口”。",
      "名称写成你能区分的格式，例如：DeepSeek-文案、OpenAI-生图。",
      "Base URL 填官方 OpenAI 兼容地址，API Key 粘贴后保存。",
    ],
  },
  {
    title: "步骤 3：勾选支持能力",
    lines: [
      "文案接口勾“文本”。",
      "生图接口勾“图片”。",
      "如果一个接口两者都支持，可以都勾，但建议先按功能拆开，排错更容易。",
    ],
  },
  {
    title: "步骤 4：测试连接",
    lines: [
      "点击“测试连接”，看到“连接成功”再继续。",
      "成功后会返回模型列表，点模型标签可加入“常用模型”。",
      "如果没有返回模型，也可以手填模型名，但要确保平台上真实存在。",
    ],
  },
  {
    title: "步骤 5：用途分配",
    lines: [
      "文案能力：标题、卖点、关键词、翻译、属性提取，建议都分给文本模型。",
      "图片能力：生图、修图、放大，建议分给图片模型。",
      "每个用途都要同时选“接口 + 模型名”，否则这个用途不会生效。",
    ],
  },
  {
    title: "步骤 6：按业务验证",
    lines: [
      "去商品任务页先跑 1 个任务：运行 AI，确认标题和描述能产出。",
      "再试 1 次生图，确认主图或四宫格能正常生成。",
      "最后再批量跑，避免配置错误放大成本。",
    ],
  },
  {
    title: "步骤 7：设置降本与风控",
    lines: [
      "先给高成本用途（生图、重生成）设置日限额，避免误操作导致超支。",
      "文本模型优先用低成本型号，只有效果不足时再切到高阶型号。",
      "先在小样本（10~20 个任务）上验证后，再切全量批跑。",
    ],
  },
];

const MAINSTREAM_SETUPS = [
  {
    name: "OpenAI",
    scene: "通用质量优先，适合标题优化、商品理解、图片生成",
    baseUrl: "https://api.openai.com/v1",
    capability: "文本 + 图片",
    models: "文本可用 gpt-5；图片可用 gpt-image-1.5 / gpt-image-1 / gpt-image-1-mini",
    docsUrl: "https://platform.openai.com/docs/quickstart",
  },
  {
    name: "DeepSeek",
    scene: "中文文案、低成本文本处理，适合标题、卖点、翻译、属性提取",
    baseUrl: "https://api.deepseek.com/v1（推荐直接填这个）",
    capability: "文本",
    models: "推荐 deepseek-v4-flash；高质量可选 deepseek-v4-pro",
    docsUrl: "https://api-docs.deepseek.com/",
  },
  {
    name: "阿里云百炼 / 通义千问",
    scene: "国内可用性高，适合文本理解、多模型统一采购",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    capability: "文本为主",
    models: "可按业务选 qwen 系列模型；具体以控制台开通模型为准",
    docsUrl: "https://help.aliyun.com/zh/model-studio/",
  },
  {
    name: "火山引擎 Ark",
    scene: "国内团队常用网关，适合把多个模型统一走一个出口",
    baseUrl: "以火山引擎控制台提供的接入点为准",
    capability: "取决于你开通的模型",
    models: "按控制台 Endpoint / Model 名填写",
    docsUrl: "https://www.volcengine.com/docs/",
  },
];

const TROUBLESHOOTING = [
  {
    title: "报错 401 / Invalid API Key",
    lines: ["通常是 Key 填错、过期或前后多了空格。", "重新生成 Key 后，回到向导重测连接。"],
  },
  {
    title: "报错 403 / 模型无权限",
    lines: ["Key 有效但没有该模型权限。", "去平台控制台开通模型，再回到向导测试。"],
  },
  {
    title: "报错 404 / 路径不存在",
    lines: ["多数是 Base URL 少了版本后缀，比如缺 `/v1`。", "检查是否填写了 OpenAI 兼容地址，而不是普通官网地址。"],
  },
  {
    title: "报错 429 / 限流",
    lines: ["接口并发太高或触发配额限制。", "降低并发、分批执行，或提高平台限额。"],
  },
  {
    title: "生图报提示词解析失败",
    lines: ["提示词模板不存在、被禁用，或变量未正确替换。", "去提示词中心检查对应 `image_prompt_*` 模板是否启用并可渲染。"],
  },
];

const SECURITY_CHECKLIST = [
  "生产环境不要把 Key 长期放浏览器 localStorage；应迁移到服务端安全配置中心。",
  "不同环境（测试/生产）使用不同 Key，防止串环境消耗。",
  "高权限 Key 不要共享给多人，建议一人一 Key 并可随时吊销。",
  "定期轮换 Key，发现泄露风险时立即禁用旧 Key。",
];

const GO_LIVE_CHECKLIST = [
  "文本用途（标题/卖点/翻译）均已分配到“测试成功”的文本接口。",
  "图片用途（生图/四宫格/修图）均已分配到“测试成功”的图片接口。",
  "至少完成 1 次单任务全链路：跑 AI -> 生图 -> 导出校验。",
  "已设置每日额度与失败重试策略，避免无限重试。",
];

export default function AiGuidePage() {
  return (
    <div className="min-h-screen px-4 py-6 md:px-6">
      <section className="mx-auto max-w-5xl space-y-6">
        <header className="rounded-[28px] border border-[var(--card-border)] bg-[var(--card)] p-6 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm text-slate-500">AI 配置图文说明</div>
              <h1 className="mt-1 text-3xl font-semibold">AI 配置详细教程</h1>
              <div className="mt-2 text-sm text-slate-600">按下面顺序配置，基本可以避免 90% 的接入错误。</div>
            </div>
            <Link
              href="/settings/ai"
              className="h-10 rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50 inline-flex items-center"
            >
              返回 AI 配置向导
            </Link>
          </div>
        </header>

        <div className="grid gap-4 md:grid-cols-2">
          {STEPS.map((step, idx) => (
            <div key={step.title} className="rounded-[24px] border border-slate-200 bg-white p-5">
              <div className="text-xs text-slate-500">步骤 {idx + 1}</div>
              <div className="mt-1 text-base font-semibold text-slate-900">{step.title}</div>
              <div className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
                {step.lines.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <section className="rounded-[24px] border border-slate-200 bg-white p-5">
          <div className="text-base font-semibold text-slate-900">主流 AI 配置参考</div>
          <div className="mt-2 text-sm text-slate-600">优先选 OpenAI 兼容协议平台，接入最快。</div>
          <div className="mt-4 space-y-3">
            {MAINSTREAM_SETUPS.map((item) => (
              <div key={item.name} className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-900">{item.name}</div>
                  <a
                    href={item.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-slate-500 underline decoration-slate-300 underline-offset-4"
                  >
                    官方文档
                  </a>
                </div>
                <div className="mt-2 text-xs leading-6 text-slate-600">
                  <div>适合场景：{item.scene}</div>
                  <div>Base URL：{item.baseUrl}</div>
                  <div>能力：{item.capability}</div>
                  <div>模型示例：{item.models}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[24px] border border-slate-200 bg-white p-5">
          <div className="text-base font-semibold text-slate-900">常见报错与处理</div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {TROUBLESHOOTING.map((item) => (
              <div key={item.title} className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-900">{item.title}</div>
                <div className="mt-2 space-y-1 text-xs leading-6 text-slate-600">
                  {item.lines.map((line) => (
                    <div key={line}>{line}</div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-[24px] border border-slate-200 bg-white p-5">
            <div className="text-base font-semibold text-slate-900">安全建议</div>
            <div className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
              {SECURITY_CHECKLIST.map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>
          </div>
          <div className="rounded-[24px] border border-slate-200 bg-white p-5">
            <div className="text-base font-semibold text-slate-900">上线前检查清单</div>
            <div className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
              {GO_LIVE_CHECKLIST.map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>
          </div>
        </section>

        <div className="rounded-[24px] border border-amber-200 bg-amber-50 p-5 text-sm leading-7 text-amber-900">
          常见问题：DeepSeek 填 `https://api.deepseek.com` 报 404 时，通常是少了 `/v1`。当前系统已自动补 `/v1` 再测试。
        </div>
      </section>
    </div>
  );
}
