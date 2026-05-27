import type {
  ProductTaskDetail,
  ProductTaskTimelineEvent,
  ProductTaskTimelineResponse,
  RawProductDetail,
} from "@/features/product-tasks/types";

type NormalizedGenerationMode = "task_only" | "title_only" | "title_and_4grid";

type BuildTraceSummaryParams = {
  task: ProductTaskDetail;
  raw: RawProductDetail | null;
  timeline: ProductTaskTimelineResponse | null;
  normalizeGenerationMode: (raw: string) => NormalizedGenerationMode;
  dedupeCompatAiEvents: (events: ProductTaskTimelineEvent[]) => ProductTaskTimelineEvent[];
  isModelCallEvent: (event: ProductTaskTimelineEvent) => boolean;
  getLatestImageJobSummaries: (events: ProductTaskTimelineEvent[]) => ProductTaskTimelineEvent[];
  displayTimelineEvent: (
    event: ProductTaskTimelineEvent,
    allEvents: ProductTaskTimelineEvent[],
  ) => ProductTaskTimelineEvent;
};

export function buildTraceSummary({
  task,
  raw,
  timeline,
  normalizeGenerationMode,
  dedupeCompatAiEvents,
  isModelCallEvent,
  getLatestImageJobSummaries,
  displayTimelineEvent,
}: BuildTraceSummaryParams) {
  const allEvents = timeline?.events || [];
  const aiEvents = dedupeCompatAiEvents(allEvents.filter((event) => String(event.stage).startsWith("ai.")));
  const modelEvents = aiEvents.filter(isModelCallEvent);
  const codeStepEvents = aiEvents.filter((event) => !isModelCallEvent(event));
  const backendEvents = allEvents.filter((event) => !String(event.stage).startsWith("ai."));
  const normMode = normalizeGenerationMode(task.generation_mode);
  const categoryEvent = aiEvents.find((event) => event.stage === "ai.category_match") || null;
  const categoryOutput = ((categoryEvent?.meta?.output as Record<string, unknown> | undefined) || {});
  const categoryInput = ((categoryEvent?.meta?.input as Record<string, unknown> | undefined) || {});
  const categoryQueries = (((categoryInput.queries as Record<string, unknown> | undefined)?.queries as unknown[]) || [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  const categoryQuerySources = (((categoryInput.queries as Record<string, unknown> | undefined)?.query_sources as unknown[]) || [])
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  const categoryCandidates = ((categoryOutput.candidates as unknown[]) || [])
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  const categoryKeywords = ((categoryOutput.category_search_keywords as unknown[]) || [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  const runtimeFromEvents =
    ((aiEvents.find((event) => event.meta?.runtime)?.meta?.runtime as Record<string, unknown> | undefined) || {});
  const timelineEventsForDisplay = allEvents;
  const expectedModelStages = (() => {
    const mode = normalizeGenerationMode(task.generation_mode);
    if (mode === "title_only") {
      return task.include_product_info
        ? ["ai.product_info", "ai.title_package"]
        : ["ai.title_package"];
    }
    if (mode === "title_and_4grid") {
      return task.include_product_info
        ? ["ai.product_info", "ai.title_package"]
        : ["ai.title_package"];
    }
    return [];
  })();
  const flowPlan = (() => {
    const mode = normalizeGenerationMode(task.generation_mode);
    if (mode === "title_only") {
      return [
        { label: "商品理解", value: task.include_product_info ? "product_info_from_screenshot -> 先生成商品摘要，补充标题上下文" : "已关闭，标题只使用原始采集字段" },
        { label: "标题生成", value: "title_package -> 生成中英文标题 + 类目检索关键词" },
        { label: "类目处理", value: "category_match -> 基于 AI 检索词和原始字段做代码字典召回，默认采用第 1 候选" },
      ];
    }
    if (mode === "title_and_4grid") {
      return [
        { label: "商品理解", value: task.include_product_info ? "product_info_from_screenshot -> 输出商品摘要和四宫格元素" : "已关闭，四宫格使用原始采集字段补上下文" },
        { label: "标题生成", value: "title_package -> 生成中英文标题 + 类目检索关键词" },
        { label: "类目处理", value: "category_match -> 结合标题关键词和原始字段做代码字典检索" },
        { label: "图片提示词上下文", value: "image_prompt_package -> 代码拼装精简上下文，不调模型；真正耗 token 的是后续图片模型出图" },
        { label: "四宫格出图", value: "bootstrap -> image_prompt_carousel_4grid -> 自动生成母图并裁切 carousel_1~4" },
      ];
    }
    return [{ label: "当前模式", value: "task_only，不触发 AI，只保留原始采集和人工处理。" }];
  })();
  const totalPromptTokens = modelEvents.reduce((sum, event) => sum + Number((event.meta?.usage as Record<string, unknown> | undefined)?.prompt_tokens || 0), 0);
  const totalCompletionTokens = modelEvents.reduce((sum, event) => sum + Number((event.meta?.usage as Record<string, unknown> | undefined)?.completion_tokens || 0), 0);
  const totalTokens = modelEvents.reduce((sum, event) => sum + Number((event.meta?.usage as Record<string, unknown> | undefined)?.total_tokens || 0), 0);
  const totalEstimatedCost = modelEvents.reduce((sum, event) => {
    const cost = Number((event.meta?.cost as Record<string, unknown> | undefined)?.estimated_cost);
    return sum + (Number.isFinite(cost) ? cost : 0);
  }, 0);
  const costCurrency = String(
    ((modelEvents.find((event) => (event.meta?.cost as Record<string, unknown> | undefined)?.currency)?.meta?.cost as Record<string, unknown> | undefined)?.currency ||
      (runtimeFromEvents.pricing as Record<string, unknown> | undefined)?.currency ||
      "USD"),
  );
  const aiStepRows = modelEvents.map((event) => {
    const runtime = (event.meta?.runtime as Record<string, unknown> | undefined) || {};
    const promptTemplate = (event.meta?.prompt_template as Record<string, unknown> | undefined) || {};
    const usage = (event.meta?.usage as Record<string, unknown> | undefined) || {};
    const cost = (event.meta?.cost as Record<string, unknown> | undefined) || {};
    const provider = (event.meta?.provider as Record<string, unknown> | undefined) || {};
    return {
      step: event.title,
      stage: event.stage,
      status: event.status,
      promptType: String(event.meta?.prompt_type || "-"),
      provider: String(provider.provider_display_name || runtime.provider_display_name || provider.provider_name || runtime.provider_name || "-"),
      providerSource: String(provider.provider_source || runtime.provider_source || "-"),
      model: String(event.meta?.model || runtime.model || "-"),
      templateId: String(promptTemplate.template_id || "-"),
      templateVersion: String(promptTemplate.version || "-"),
      scope: String(promptTemplate.scope || "-"),
      durationMs: String(event.meta?.duration_ms || 0),
      promptTokens: Number(usage.prompt_tokens || 0),
      completionTokens: Number(usage.completion_tokens || 0),
      totalTokens: Number(usage.total_tokens || 0),
      estimatedCost: Number(cost.estimated_cost),
      currency: String(cost.currency || costCurrency),
    };
  });
  const processChecks = [
    {
      key: "task_created",
      label: "任务创建",
      hint: "是否已经从 raw_product 生成 product_task。",
      done: allEvents.some((event) => event.stage === "task.created"),
      status: "success",
    },
    {
      key: "product_info",
      label: "商品理解",
      hint: task.include_product_info ? "是否跑过商品理解 / 截图理解。" : "创建任务时已关闭商品理解。",
      done: aiEvents.some((event) => event.stage === "ai.product_info" && event.status === "success"),
      status:
        !task.include_product_info || normMode === "task_only"
          ? "skipped"
          : task.main_status === "failed" && task.title_status === "failed"
            ? "failed"
            : task.main_status === "ai_running"
              ? "running"
              : "pending",
    },
    {
      key: "category_match",
      label: "类目处理",
      hint: "是否基于标题检索关键词和原始字段产出候选类目。",
      done: aiEvents.some((event) => event.stage === "ai.category_match" && event.status === "success") || Boolean(task.selected_category_id),
      status: task.category_status,
    },
    {
      key: "title_package",
      label: "标题包",
      hint: normMode === "title_only" ? "应只调用一次标题 AI，直接返回中英标题。" : "是否生成标题包并回写任务标题。",
      done: aiEvents.some((event) => event.stage === "ai.title_package" && event.status === "success") || Boolean(task.ai?.title_package),
      status: task.title_status,
    },
    {
      key: "image_prompt_package",
      label: "图片提示词上下文",
      hint:
        normMode === "title_only"
          ? "当前模式应跳过该步骤。"
          : "是否已基于商品理解、标题包和类目结果生成动态图片提示词上下文（不调 AI）。",
      done: aiEvents.some((event) => event.stage === "ai.image_prompt_package" && event.status === "success") || Boolean(task.ai?.image_prompt_package),
      status: normMode === "title_only" ? "skipped" : task.image_prompt_status,
    },
    {
      key: "image_jobs",
      label: "图片任务",
      hint: "是否创建过 image_generation_jobs。",
      done: backendEvents.some((event) => String(event.stage).startsWith("image.")),
      status: task.image_status,
    },
    {
      key: "export_draft",
      label: "导出草稿",
      hint: "是否生成过 export_field_drafts。",
      done: backendEvents.some((event) => String(event.stage).startsWith("export.")),
      status: task.export_status,
    },
  ];
  const defaultChainChecks = (() => {
    if (normMode === "title_only") {
      return [
        processChecks[0],
        {
          key: "material_sync",
          label: "素材回显",
          hint: "原始主图、轮播图、SKU 图等素材应同步到上架台，供后续按需生成图片。",
          done: Boolean(raw) || Boolean(task.screenshot_url) || Boolean(task.source_url),
          status: "success",
        },
        processChecks[3],
        processChecks[2],
        {
          key: "manual_review",
          label: "人工待确认",
          hint: "默认第 1 候选类目和 AI 标题都需要人工确认后再继续图片或导出动作。",
          done: task.main_status === "review_ready" || task.main_status === "export_ready" || task.main_status === "exported",
          status: task.main_status === "failed" ? "failed" : task.main_status === "ai_running" ? "running" : "pending",
        },
      ];
    }
    return processChecks.slice(0, 5);
  })();
  const followupChecks = [
    {
      key: "image_jobs_followup",
      label: "图片任务",
      hint: "主图、SKU 图、四宫格、轮播图都属于创建任务后的主动触发动作。",
      done: backendEvents.some((event) => String(event.stage).startsWith("image.")),
      status: task.image_status,
    },
    {
      key: "export_draft_followup",
      label: "导出草稿",
      hint: "导出草稿不属于创建任务默认链路，通常在预览、导出或应用规则时生成。",
      done: backendEvents.some((event) => String(event.stage).startsWith("export.")),
      status: task.export_status,
    },
  ];
  const compactImageSummaries = getLatestImageJobSummaries(allEvents);
  const compactTimelineEvents = timelineEventsForDisplay.map((event) => displayTimelineEvent(event, allEvents));

  return {
    allEvents,
    aiEvents,
    modelEvents,
    codeStepEvents,
    backendEvents,
    normMode,
    categoryOutput,
    categoryQueries,
    categoryQuerySources,
    categoryCandidates,
    categoryKeywords,
    runtimeFromEvents,
    timelineEventsForDisplay,
    expectedModelStages,
    flowPlan,
    totalPromptTokens,
    totalCompletionTokens,
    totalTokens,
    totalEstimatedCost,
    costCurrency,
    aiStepRows,
    defaultChainChecks,
    followupChecks,
    compactImageSummaries,
    compactTimelineEvents,
  };
}

export type TraceSummary = ReturnType<typeof buildTraceSummary>;
