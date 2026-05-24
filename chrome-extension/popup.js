const DEFAULT_SERVER_URL = "http://127.0.0.1:8000";
const DEFAULT_WEB_URL = "http://127.0.0.1:3000";
let serverUrl = DEFAULT_SERVER_URL;
let webUrl = DEFAULT_WEB_URL;
let currentProduct = null;
let currentCollector = "";
let currentTaskId = null;
let correctionOpen = false;
let assignTarget = "main";
let assignMode = false; // true: 点击图片=归类；false: 点击图片=是否同步
let buckets = { main: [], sku: [], detail: [], size: [] };
let picked = new Set(); // 用于“归类到”：跨组挑图
let syncSelected = { main: new Set(), sku: new Set(), detail: new Set(), size: new Set(), video: new Set() }; // 控制提交到本地工作台的数量
let skuPropSelected = new Set();
let dragPayload = null;
let zoomPreviewEl = null;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  document.querySelector("#collect").addEventListener("click", collectOnly);
  document.querySelector("#sync").addEventListener("click", collectAndSync);
  document.querySelector("#syncCreate").addEventListener("click", collectSyncAndCreateTask);
  document.querySelector("#shot").addEventListener("click", takeScreenshot);
  document.querySelector("#toggleCorrect").addEventListener("click", toggleCorrection);
  document.querySelector("#openWorkbench").addEventListener("click", openWorkbench);
  document.querySelector("#toggleSettings").addEventListener("click", toggleSettings);
  await initServerUrlField();
  await initWebUrlField();
  await initTaskOptions();
  await initCollectorField();
  await previewCurrentTab();
}

async function initServerUrlField() {
  const input = document.querySelector("#serverUrl");
  if (!input) return;

  const stored = await chrome.storage.local.get({ serverUrl: DEFAULT_SERVER_URL });
  serverUrl = normalizeServerUrl(stored.serverUrl || DEFAULT_SERVER_URL);
  input.value = serverUrl;

  input.addEventListener("input", async (event) => {
    serverUrl = normalizeServerUrl(event.target.value || DEFAULT_SERVER_URL);
    await chrome.storage.local.set({ serverUrl });
  });
}

async function initWebUrlField() {
  const input = document.querySelector("#webUrl");
  if (!input) return;

  const stored = await chrome.storage.local.get({ webUrl: DEFAULT_WEB_URL });
  webUrl = normalizeBaseUrl(stored.webUrl || DEFAULT_WEB_URL, DEFAULT_WEB_URL);
  input.value = webUrl;

  input.addEventListener("input", async (event) => {
    webUrl = normalizeBaseUrl(event.target.value || DEFAULT_WEB_URL, DEFAULT_WEB_URL);
    await chrome.storage.local.set({ webUrl });
  });
}

async function initTaskOptions() {
  const stored = await chrome.storage.local.get({
    generationMode: "title_and_4grid",
    includeProductInfo: true
  });
  const mode = document.querySelector("#generationMode");
  const include = document.querySelector("#includeProductInfo");
  if (mode) {
    mode.value = stored.generationMode || "title_and_4grid";
    mode.addEventListener("change", async (event) => {
      await chrome.storage.local.set({ generationMode: event.target.value || "title_and_4grid" });
    });
  }
  if (include) {
    include.checked = stored.includeProductInfo !== false;
    include.addEventListener("change", async (event) => {
      await chrome.storage.local.set({ includeProductInfo: Boolean(event.target.checked) });
    });
  }
}

async function initCollectorField() {
  const input = document.querySelector("#collector");
  if (!input) return;

  const stored = await chrome.storage.local.get({ collector: "" });
  currentCollector = String(stored.collector || "").trim();
  input.value = currentCollector;

  input.addEventListener("input", async (event) => {
    currentCollector = String(event.target.value || "").trim();
    await chrome.storage.local.set({ collector: currentCollector });
  });
}

async function previewCurrentTab() {
  setStatus("读取中");
  setMessage("点击“采集”读取当前商品。");

  try {
    const product = await collectCurrentPage();
    currentProduct = product;
    hydrateBucketsFromProduct(product);
    renderAll(product);
    const serverReady = await checkServer();
    setStatus(serverReady ? "可同步" : "服务未启");
    setMessage(serverReady ? "可直接提交本地工作台，或先手动纠错再提交。" : "请先运行后端服务，再同步到原始采集箱");
  } catch (error) {
    setStatus("失败");
    setMessage(error.message || "当前页面无法采集");
  }
}

async function collectOnly() {
  setStatus("采集中");
  setMessage("正在采集当前页面");
  try {
    const product = await collectCurrentPage();
    product.collector = currentCollector;
    currentProduct = product;
    hydrateBucketsFromProduct(product);
    renderAll(product);
    setStatus("已采集");
    setMessage("可打开“手动纠错”调整图片分组。");
  } catch (error) {
    setStatus("失败");
    setMessage(error.message || "采集失败");
  }
}

async function collectAndSync() {
  setSyncingState(true, "正在采集并提交本地…");
  setStatus("同步中");
  setMessage("正在采集并提交本地…");

  try {
    const hasExisting = Boolean(currentProduct);
    const product = hasExisting ? { ...currentProduct } : await collectCurrentPage();
    product.collector = currentCollector;
    currentProduct = product;
    if (!hasExisting) {
      hydrateBucketsFromProduct(product);
    } else {
      // 保留手动纠错状态：buckets/disabledByGroup 以当前内存为准
      applyBucketsToProduct(product);
    }
    renderAll(product);

    setMessage("正在检查本地服务…");
    const serverReady = await checkServer();
    if (!serverReady) {
      setSyncingState(false);
      setStatus("服务未启");
      setMessage("本地服务未启动，请先运行 python -m uvicorn app.main:app --reload");
      return;
    }

    setMessage("正在截图并上传…");
    product.screenshot = await captureAndUploadScreenshot(product.platformSku || product.sourceId || product.url);
    currentProduct = product;
    renderAll(product);

    setMessage("正在提交本地工作台…");
    const result = await postProduct(product);
    if (!result.ok) throw new Error(result.error || "同步失败");

    renderSyncResult(result);
    setSyncingState(false);
    setStatus("已完成");
    setMessage("已写入本地工作台原始采集池。");
  } catch (error) {
    setSyncingState(false);
    setStatus("失败");
    setMessage(error.message || "同步失败");
  }
}

async function collectSyncAndCreateTask() {
  setSyncingState(true, "正在提交并生成…");
  setStatus("同步中");
  setMessage("正在提交并生成上架任务…");

  try {
    const product = await prepareProductForSubmit();
    const rawResult = await postProduct(product);
    if (!rawResult.ok || !rawResult.id) throw new Error(rawResult.error || rawResult.detail || "原始数据提交失败");

    setMessage("正在创建上架任务…");
    const taskResult = await createTaskFromRawProduct(rawResult.id);
    if (!taskResult.ok || !taskResult.id) throw new Error(taskResult.detail || "创建任务失败");

    currentTaskId = taskResult.id;
    showOpenWorkbenchButton();
    setSyncingState(false);
    setStatus("已完成");
    setMessage(`已生成上架任务 #${taskResult.id}。`);
    document.querySelector("#summary").value = [
      `原始采集：#${rawResult.id}`,
      `上架任务：#${taskResult.id}`,
      `生成模式：${getGenerationMode()}`
    ].join("\n");
  } catch (error) {
    setSyncingState(false);
    setStatus("失败");
    setMessage(error.message || "提交并生成失败");
  }
}

async function prepareProductForSubmit() {
  const hasExisting = Boolean(currentProduct);
  const product = hasExisting ? { ...currentProduct } : await collectCurrentPage();
  product.collector = currentCollector;
  currentProduct = product;
  if (!hasExisting) hydrateBucketsFromProduct(product);
  else applyBucketsToProduct(product);
  renderAll(product);

  setMessage("正在检查本地服务…");
  const serverReady = await checkServer();
  if (!serverReady) throw new Error("本地服务未启动，请先启动 API 服务");

  setMessage("正在截图并上传…");
  product.screenshot = await captureAndUploadScreenshot(product.platformSku || product.sourceId || product.url);
  currentProduct = product;
  renderAll(product);
  applyBucketsToProduct(product);
  return product;
}

async function collectCurrentPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let response;

  try {
    response = await chrome.tabs.sendMessage(tab.id, { type: "COLLECT_PRODUCT" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["platform-collectors.js", "content.js"]
    });
    response = await chrome.tabs.sendMessage(tab.id, { type: "COLLECT_PRODUCT" });
  }

  if (!response?.ok) throw new Error(response?.error || "当前页面无法采集");
  return response.product;
}

async function checkServer() {
  try {
    const response = await fetch(`${serverUrl}/health`);
    const data = await response.json();
    return Boolean(data?.ok);
  } catch {
    return false;
  }
}

async function captureVisibleTab() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "CAPTURE_VISIBLE_TAB" }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.ok || !response.dataUrl) {
        reject(new Error(response?.error || "截图失败"));
        return;
      }
      resolve(response.dataUrl);
    });
  });
}

async function captureVisibleTabWithoutPanel() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  try {
    if (tab?.id) {
      await chrome.tabs.sendMessage(tab.id, { type: "PSYNC_PREPARE_SHOT" });
      await sleep(120);
    }

    return await captureVisibleTab();
  } finally {
    try {
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, { type: "PSYNC_FINISH_SHOT" });
      }
    } catch {
      // ignore
    }
  }
}

async function captureAndUploadScreenshot(productId) {
  const dataUrl = await captureVisibleTabWithoutPanel();
  const response = await fetch(`${serverUrl}/sync/screenshot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productId, dataUrl })
  });
  const data = await response.json();
  if (!data?.ok || !data.url) throw new Error(data?.error || "截图上传失败");
  return data.url;
}

async function postProduct(product) {
  const response = await fetch(`${serverUrl}/api/raw-products`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sanitizeProductForSubmit(product))
  });
  return response.json();
}

function sanitizeProductForSubmit(product) {
  const { _allSkuProps, ...rest } = product || {};
  return rest;
}

async function createTaskFromRawProduct(rawProductId) {
  const response = await fetch(`${serverUrl}/api/raw-products/${rawProductId}/create-task`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      split_count: 1,
      generation_mode: getGenerationMode(),
      include_product_info: getIncludeProductInfo()
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof data?.detail === "string" ? data.detail : `HTTP ${response.status}`;
    return { ok: false, detail };
  }
  return data;
}

function renderProduct(product) {
  document.querySelector("#platform").textContent = product.platform || "-";
  document.querySelector("#price").textContent = product.price || "-";
  document.querySelector("#mainCount").textContent = String(product.mainImages?.length || 0);
  document.querySelector("#skuCount").textContent = String(product.skuImages?.length || 0);
  document.querySelector("#detailCount").textContent = String(product.detailImages?.length || 0);
  const warn = product?.debug?.noImagesDetected ? "（未识别到图片：将仅同步截图，可在工作台补图）" : "";
  const titleEl = document.querySelector("#titleWarning");
  if (titleEl) titleEl.textContent = warn;
  document.querySelector("#summary").value = summarize(product);
}

function renderAll(product) {
  renderProduct(product);
  renderCorrectionPanel();
}

function renderSyncResult(result) {
  const output = result.generated || {};
  const lines = [
    output["中文标题"] ? `中文标题：${output["中文标题"]}` : "",
    output["英文标题"] ? `英文标题：${output["英文标题"]}` : "",
    output["主图AI提示词"] ? `主图AI提示词：${output["主图AI提示词"]}` : ""
  ].filter(Boolean);

  if (lines.length) {
    document.querySelector("#summary").value = lines.join("\n");
  }
}

function summarize(product) {
  const skuPropCount = Array.isArray(product.skuProps) ? product.skuProps.length : 0;
  return [
    `标题：${product.title || "-"}`,
    `主图：${product.mainImages?.length || 0}`,
    `规格图：${product.skuImages?.length || 0}`,
    `规格/属性：${skuPropCount}`,
    `详情：${product.detailImages?.length || 0}`,
    `视频：${product.videoUrl ? "有" : "无"}`,
    `采集人：${product.collector || currentCollector || "-"}`
  ].join("\n");
}

function toggleCorrection() {
  correctionOpen = !correctionOpen;
  const panel = document.querySelector("#correctPanel");
  panel.classList.toggle("is-hidden", !correctionOpen);
  document.querySelector("#toggleCorrect").textContent = correctionOpen ? "收起纠错" : "手动纠错";
  picked = new Set();
  renderCorrectionPanel();
}

function hydrateBucketsFromProduct(product) {
  if (product && !Array.isArray(product._allSkuProps)) {
    product._allSkuProps = Array.isArray(product.skuProps) ? product.skuProps.slice() : [];
  }
  buckets = {
    main: Array.isArray(product?.mainImages) ? product.mainImages.filter(Boolean) : [],
    sku: Array.isArray(product?.skuImages) ? product.skuImages.filter(Boolean) : [],
    detail: Array.isArray(product?.detailImages) ? product.detailImages.filter(Boolean) : [],
    size: Array.isArray(product?.sizeChartImages) ? product.sizeChartImages.filter(Boolean) : []
  };
  syncSelected = {
    main: new Set(buckets.main),
    sku: new Set(buckets.sku),
    detail: new Set(buckets.detail),
    size: new Set(buckets.size),
    video: new Set(product?.videoUrl ? [product.videoUrl] : [])
  };
  skuPropSelected = new Set((product?._allSkuProps || product?.skuProps || []).map((item, index) => skuPropKey(item, index)));
  picked = new Set();
}

function applyBucketsToProduct(product) {
  product.mainImages = buckets.main.filter((url) => syncSelected.main.has(url));
  product.skuImages = buckets.sku.filter((url) => syncSelected.sku.has(url));
  product.detailImages = buckets.detail.filter((url) => syncSelected.detail.has(url));
  product.sizeChartImages = buckets.size.filter((url) => syncSelected.size.has(url));
  product.mainImage = product.mainImages[0] || "";
  product.carouselImages = product.mainImages.slice();
  product.skuImage = product.skuImages[0] || product.mainImage || "";
  const allSkuProps = Array.isArray(product._allSkuProps) ? product._allSkuProps : (product.skuProps || []);
  product.skuProps = filterSkuPropsForSync(allSkuProps, product.skuImages);
  if (product.videoUrl && !syncSelected.video.has(product.videoUrl)) product.videoUrl = "";
  return product;
}

async function takeScreenshot() {
  setStatus("截图中");
  setMessage("正在截取当前页面");
  try {
    const productId = currentProduct?.platformSku || currentProduct?.sourceId || currentProduct?.url || Date.now();
    const screenshotUrl = await captureAndUploadScreenshot(productId);
    if (!currentProduct) currentProduct = {};
    currentProduct.screenshot = screenshotUrl;
    renderAll(currentProduct);
    setStatus("已截图");
    setMessage("截图已更新，可继续手动纠错或提交本地");
  } catch (error) {
    setStatus("失败");
    setMessage(error.message || "截图失败");
  }
}

function getTabUrls(tab) {
  const key = String(tab || "main");
  if (key === "video") return currentProduct?.videoUrl ? [currentProduct.videoUrl] : [];
  if (key === "all") return uniqueImages([...buckets.main, ...buckets.sku, ...buckets.detail, ...buckets.size]);
  return (buckets[key] || []).slice();
}

function getSyncSelectedCount(group) {
  const key = String(group || "main");
  if (key === "all") {
    const merged = uniqueImages([
      ...buckets.main.filter((url) => syncSelected.main.has(url)),
      ...buckets.sku.filter((url) => syncSelected.sku.has(url)),
      ...buckets.detail.filter((url) => syncSelected.detail.has(url)),
      ...buckets.size.filter((url) => syncSelected.size.has(url))
    ]);
    return merged.length;
  }
  if (key === "video") return currentProduct?.videoUrl && syncSelected.video.has(currentProduct.videoUrl) ? 1 : 0;
  return (syncSelected[key] ? syncSelected[key].size : 0);
}

function renderCorrectionPanel() {
  const panel = document.querySelector("#correctPanel");
  if (!panel || !correctionOpen) return;

  const assignBar = panel.querySelector("#assignBar");
  const modeBtn = panel.querySelector("#assignMode");
  if (modeBtn) {
    modeBtn.textContent = assignMode ? "归类模式：开" : "归类模式：关";
    modeBtn.classList.toggle("is-hot", assignMode);
    modeBtn.onclick = (event) => {
      event.preventDefault();
      assignMode = !assignMode;
      picked = new Set();
      renderCorrectionPanel();
    };
  }

  assignBar.querySelectorAll("button[data-assign]").forEach((button) => {
    const key = button.getAttribute("data-assign");
    button.onclick = (event) => {
      event.preventDefault();
      assignTarget = key;
      // 归类模式：直接点图归类，所以这里只是切换目标
      button.closest("#assignBar")?.querySelectorAll("button[data-assign]")?.forEach((b) => b.classList.toggle("is-on", b === button));
      renderCorrectionPanel();
    };
  });

  // “全选/反选”：只在“全选 ↔ 全不选”之间切换（并联动将同步数量）
  panel.querySelectorAll("input[data-invert]").forEach((input) => {
    const group = input.getAttribute("data-invert");
    const urls = getTabUrls(group);
    const set = syncSelected[group] || new Set();
    const selectedCount = urls.filter((url) => set.has(url)).length;
    input.disabled = urls.length === 0;
    input.checked = urls.length > 0 && selectedCount === urls.length;
    input.indeterminate = selectedCount > 0 && selectedCount < urls.length;
    input.onchange = (event) => {
      event.preventDefault();
      if (!syncSelected[group]) syncSelected[group] = new Set();
      if (selectedCount === urls.length) {
        syncSelected[group] = new Set(); // 反选 -> 0
      } else {
        syncSelected[group] = new Set(urls); // 全选
      }
      applyBucketsToProduct(currentProduct || {});
      renderAll(currentProduct || {});
    };
  });

  panel.querySelectorAll("input[data-invert-sku-props]").forEach((input) => {
    const props = getAllSkuProps();
    const keys = props.map((item, index) => skuPropKey(item, index));
    const selectedCount = keys.filter((key) => skuPropSelected.has(key)).length;
    input.disabled = keys.length === 0;
    input.checked = keys.length > 0 && selectedCount === keys.length;
    input.indeterminate = selectedCount > 0 && selectedCount < keys.length;
    input.onchange = (event) => {
      event.preventDefault();
      if (selectedCount === keys.length) {
        keys.forEach((key) => skuPropSelected.delete(key));
      } else {
        keys.forEach((key) => skuPropSelected.add(key));
      }
      applyBucketsToProduct(currentProduct || {});
      renderCorrectionPanel();
    };
  });

  // per-group “下载选中”
  panel.querySelectorAll("button[data-download-selected]").forEach((button) => {
    const group = button.getAttribute("data-download-selected");
    button.onclick = (event) => {
      event.preventDefault();
      downloadSelectedInGroup(group);
    };
  });

  // counts: data-count shows images that will be submitted.
  for (const group of ["main", "sku", "detail", "size", "video", "all"]) {
    const countNode = panel.querySelector(`[data-count="${group}"]`);
    if (countNode) countNode.textContent = String(getSyncSelectedCount(group));
  }

  // render each grid section
  for (const group of ["main", "sku", "detail", "size", "video", "all"]) {
    const grid = panel.querySelector(`[data-grid="${group}"]`);
    if (!grid) continue;
    grid.innerHTML = "";
    grid.classList.toggle("sku-grid", group === "sku");
    const urls = getTabUrls(group);
    if (!urls.length) {
      const empty = document.createElement("div");
      empty.textContent = "暂无";
      empty.style.color = "#a6a6a6";
      empty.style.fontSize = "12px";
      grid.appendChild(empty);
      continue;
    }
    urls.forEach((url, index) => {
      grid.appendChild(group === "sku" ? buildSkuCard({ url, group, index }) : buildThumb({ url, group, index }));
    });
  }
}

function buildSkuCard({ url, group, index }) {
  const card = document.createElement("div");
  const isSelected = syncSelected.sku?.has?.(url) || false;
  card.className = `sku-card${isSelected ? "" : " is-off"}`;
  const thumb = buildThumb({ url, group, index });
  const props = getSkuPropsForImage(url);

  const info = document.createElement("div");
  info.className = "sku-info";
  const checkbox = document.createElement("label");
  checkbox.innerHTML = `<input type="checkbox" ${isSelected ? "checked" : ""}><span>同步规格图</span>`;
  checkbox.querySelector("input").addEventListener("change", (event) => {
    event.stopPropagation();
    if (event.target.checked) syncSelected.sku.add(url);
    else syncSelected.sku.delete(url);
    applyBucketsToProduct(currentProduct || {});
    renderCorrectionPanel();
  });

  const tags = document.createElement("div");
  tags.className = "sku-tags";
  if (props.length) {
    props.forEach((item, propIndex) => {
      const key = skuPropKey(item, propIndex);
      const tag = document.createElement("label");
      tag.className = "sku-tag";
      tag.innerHTML = `<input type="checkbox" ${skuPropSelected.has(key) ? "checked" : ""}> ${escapeHtml(formatSkuProp(item))}`;
      tag.querySelector("input").addEventListener("change", (event) => {
        event.stopPropagation();
        if (event.target.checked) skuPropSelected.add(key);
        else skuPropSelected.delete(key);
        applyBucketsToProduct(currentProduct || {});
      });
      tags.appendChild(tag);
    });
  } else {
    const empty = document.createElement("div");
    empty.className = "sku-empty-tag";
    empty.textContent = "未识别规格/属性";
    tags.appendChild(empty);
  }

  info.append(checkbox, tags);
  card.append(thumb, info);
  return card;
}

function toggleAssign(url) {
  const target = String(assignTarget || "main");
  if (!["main", "sku", "detail", "size"].includes(target)) return;
  const list = buckets[target];
  const idx = list.indexOf(url);
  if (idx === -1) list.push(url);
  else list.splice(idx, 1);
  // 归类规则：
  // - SKU/详情/尺寸 之间互斥
  // - SKU/详情 允许复用主图（主图可同时包含这些图）
  const exclusives = ["sku", "detail", "size"];
  if (exclusives.includes(target)) {
    for (const key of exclusives) {
      if (key === target) continue;
      buckets[key] = buckets[key].filter((item) => item !== url);
    }
  } else if (target === "main") {
    // 选择为主图时，不强制移除 sku/detail/size（允许“主图里包含 sku/detail/尺寸”）
  }
  if (currentProduct) {
    applyBucketsToProduct(currentProduct);
    renderProduct(currentProduct);
  }
}

function buildThumb({ url, group }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "thumb";
  button.title = url;
  button.draggable = ["main", "sku", "detail", "size"].includes(group);
  const isSyncSelected =
    group === "video"
      ? (currentProduct?.videoUrl === url && syncSelected.video.has(url))
      : (syncSelected[group]?.has?.(url) || false);
  button.classList.toggle("is-selected", isSyncSelected);
  button.classList.toggle("is-picked", picked.has(url));

  if (group === "all") {
    const membership =
      buckets.sku.includes(url) ? "b-sku" :
      buckets.detail.includes(url) ? "b-detail" :
      buckets.size.includes(url) ? "b-size" :
      buckets.main.includes(url) ? "b-main" :
      "";
    if (membership) button.classList.add(membership);
  }

  button.onclick = (event) => {
    if (assignMode) {
      assignSingleTo(assignTarget, url);
      renderCorrectionPanel();
      return;
    }

    // 默认行为：切换是否提交到本地工作台
    if (group !== "all") {
      if (!syncSelected[group]) syncSelected[group] = new Set();
      if (syncSelected[group].has(url)) syncSelected[group].delete(url);
      else syncSelected[group].add(url);
      // video: only 0/1
      if (group === "video" && currentProduct?.videoUrl) {
        if (syncSelected.video.has(currentProduct.videoUrl)) syncSelected.video = new Set([currentProduct.videoUrl]);
        else syncSelected.video = new Set();
      }
    } else {
      // 全部图库：同步模式下仅用于查看，不做任何动作
    }
    renderCorrectionPanel();
  };

  const download = document.createElement("button");
  download.type = "button";
  download.className = "dl";
  download.title = "下载";
  download.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3v10m0 0 4-4m-4 4-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  `;
  download.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    downloadUrls([url], group);
  };

  if (group === "video") {
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    button.appendChild(video);
  } else {
    const img = document.createElement("img");
    img.src = url;
    img.alt = "img";
    img.addEventListener("mouseenter", (event) => showZoomPreview(url, event));
    img.addEventListener("mousemove", (event) => moveZoomPreview(event));
    img.addEventListener("mouseleave", hideZoomPreview);
    button.appendChild(img);
  }

  if (button.draggable) {
    button.addEventListener("dragstart", (event) => {
      dragPayload = { group, url, index: (buckets[group] || []).indexOf(url) };
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", url);
      button.classList.add("is-dragging");
    });
    button.addEventListener("dragend", () => {
      dragPayload = null;
      button.classList.remove("is-dragging");
    });
    button.addEventListener("dragover", (event) => {
      event.preventDefault();
      button.classList.add("is-drop-target");
    });
    button.addEventListener("dragleave", () => {
      button.classList.remove("is-drop-target");
    });
    button.addEventListener("drop", (event) => {
      event.preventDefault();
      button.classList.remove("is-drop-target");
      if (!dragPayload || dragPayload.group !== group || dragPayload.url === url) return;
      reorderBucket(group, dragPayload.url, url);
      dragPayload = null;
      renderCorrectionPanel();
    });
  }

  button.appendChild(download);
  return button;
}

function getSkuPropsForImage(url) {
  return getAllSkuProps().filter((item) => normalizeImageKey(item?.imageUrl || item?.image_url || "") === normalizeImageKey(url));
}

function getAllSkuProps() {
  return Array.isArray(currentProduct?._allSkuProps) ? currentProduct._allSkuProps : (currentProduct?.skuProps || []);
}

function filterSkuPropsForSync(props, skuImages) {
  const selectedImages = new Set((skuImages || []).map(normalizeImageKey));
  return (props || []).filter((item, index) => {
    const imageKey = normalizeImageKey(item?.imageUrl || item?.image_url || "");
    const selectedByProp = skuPropSelected.has(skuPropKey(item, index));
    return selectedByProp && (!imageKey || selectedImages.has(imageKey));
  });
}

function skuPropKey(item, _index) {
  return [
    item?.groupName || item?.group_name || "",
    item?.optionName || item?.option_name || "",
    item?.imageUrl || item?.image_url || ""
  ].join("__");
}

function formatSkuProp(item) {
  const group = item?.groupName || item?.group_name || "规格";
  const option = item?.optionName || item?.option_name || item?.hintText || item?.hint_text || "";
  return option ? `${group}: ${option}` : group;
}

function normalizeImageKey(url) {
  return String(url || "").split("?")[0].replace(/\/+$/, "");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function reorderBucket(group, draggedUrl, targetUrl) {
  const list = buckets[group] || [];
  const fromIndex = list.indexOf(draggedUrl);
  const toIndex = list.indexOf(targetUrl);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;
  const next = list.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  buckets[group] = next;
  applyBucketsToProduct(currentProduct || {});
  renderProduct(currentProduct || {});
}

function showZoomPreview(url, event) {
  if (!url) return;
  if (!zoomPreviewEl) {
    zoomPreviewEl = document.createElement("div");
    zoomPreviewEl.className = "zoom-preview";
    document.body.appendChild(zoomPreviewEl);
  }
  zoomPreviewEl.innerHTML = "";
  const image = document.createElement("img");
  image.src = url;
  image.alt = "preview";
  zoomPreviewEl.appendChild(image);
  zoomPreviewEl.classList.add("is-visible");
  moveZoomPreview(event);
}

function moveZoomPreview(event) {
  if (!zoomPreviewEl || !event) return;
  const margin = 12;
  const width = 300;
  const left = Math.max(margin, Math.min(event.clientX + 12, window.innerWidth - width - margin));
  const top = Math.max(margin, Math.min(event.clientY - 150, window.innerHeight - 320 - margin));
  zoomPreviewEl.style.left = `${left}px`;
  zoomPreviewEl.style.top = `${top}px`;
}

function hideZoomPreview() {
  zoomPreviewEl?.classList.remove("is-visible");
}

function assignPickedTo(_target) {
  // deprecated: 归类改为“归类模式”下点图直接入组
}

function downloadSelectedInGroup(group) {
  const key = String(group || "main");
  const urls = getTabUrls(key).filter((url) => (syncSelected[key]?.has?.(url) || false));
  if (!urls.length) return;
  downloadUrls(urls, `${key}-selected`);
}

function assignSingleTo(target, url) {
  const key = String(target || "main");
  if (!["main", "sku", "detail", "size"].includes(key)) return;
  if (!url) return;

  const list = buckets[key] || (buckets[key] = []);
  const idx = list.indexOf(url);
  const willAdd = idx === -1;
  if (willAdd) list.push(url);
  else list.splice(idx, 1);

  // SKU/detail/size 三者互斥；允许与 main 重叠
  if (["sku", "detail", "size"].includes(key) && willAdd) {
    for (const other of ["sku", "detail", "size"]) {
      if (other === key) continue;
      buckets[other] = (buckets[other] || []).filter((item) => item !== url);
      syncSelected[other]?.delete(url);
    }
  }

  // 同步选择：加入桶时默认勾选同步，移除时取消同步
  if (!syncSelected[key]) syncSelected[key] = new Set();
  if (willAdd) syncSelected[key].add(url);
  else syncSelected[key].delete(url);

  applyBucketsToProduct(currentProduct || {});
  renderProduct(currentProduct || {});
}

function downloadUrls(urls, group) {
  const list = Array.isArray(urls) ? urls.filter(Boolean) : [];
  if (!list.length) return;
  chrome.runtime.sendMessage({
    type: "DOWNLOAD_IMAGES",
    urls: list,
    folder: `产品采集同步/${currentProduct?.platformSku || currentProduct?.sourceId || Date.now()}/${group || "assets"}`
  });
}

function uniqueImages(urls) {
  return [...new Set((urls || []).filter(Boolean))];
}

function setStatus(text) {
  const el = document.querySelector("#status");
  el.textContent = text;
  el.classList.remove("is-syncing", "is-done", "is-error");
  if (text === "同步中" || text === "采集中") el.classList.add("is-syncing");
  else if (text === "已完成" || text === "已采集") el.classList.add("is-done");
  else if (text === "失败") el.classList.add("is-error");
}

function setMessage(text) {
  document.querySelector("#message").textContent = text;
}

function setSyncingState(isSyncing, buttonText) {
  const syncBtn = document.querySelector("#sync");
  const syncCreateBtn = document.querySelector("#syncCreate");
  const collectBtn = document.querySelector("#collect");
  const shotBtn = document.querySelector("#shot");
  let overlay = document.querySelector(".sync-overlay");

  if (isSyncing) {
    // 禁用所有操作按钮
    if (syncBtn) {
      syncBtn.disabled = true;
      syncBtn.classList.add("is-syncing");
      syncBtn.innerHTML = `<span class="btn-spinner"></span>${buttonText || "同步中…"}`;
    }
    if (collectBtn) { collectBtn.disabled = true; }
    if (syncCreateBtn) { syncCreateBtn.disabled = true; }
    if (shotBtn) { shotBtn.disabled = true; }

    // 添加顶部进度条
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "sync-overlay";
      document.body.prepend(overlay);
    }
  } else {
    // 恢复按钮
    if (syncBtn) {
      syncBtn.disabled = false;
      syncBtn.classList.remove("is-syncing");
      syncBtn.textContent = "提交本地";
    }
    if (collectBtn) { collectBtn.disabled = false; }
    if (syncCreateBtn) { syncCreateBtn.disabled = false; }
    if (shotBtn) { shotBtn.disabled = false; }

    // 移除进度条
    if (overlay) { overlay.remove(); }
  }
}

function getGenerationMode() {
  return document.querySelector("#generationMode")?.value || "title_and_4grid";
}

function getIncludeProductInfo() {
  return document.querySelector("#includeProductInfo")?.checked !== false;
}

function showOpenWorkbenchButton() {
  const button = document.querySelector("#openWorkbench");
  if (button) button.classList.remove("is-hidden");
}

function openWorkbench() {
  const target = `${webUrl}/product-tasks${currentTaskId ? `?task_id=${encodeURIComponent(currentTaskId)}` : ""}`;
  chrome.tabs.create({ url: target });
}

function toggleSettings() {
  const panel = document.querySelector("#settingsPanel");
  panel?.classList.toggle("is-hidden");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeServerUrl(value) {
  return normalizeBaseUrl(value, DEFAULT_SERVER_URL);
}

function normalizeBaseUrl(value, fallback) {
  const url = String(value || "").trim();
  return (url || fallback).replace(/\/+$/, "");
}
