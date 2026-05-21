(() => {
  const PANEL_ID = "temu-source-inspector-panel";
  const OVERLAY_ID = "temu-source-inspector-overlay";
  const STYLE_ID = "temu-source-inspector-style";
  const MAX_REQUESTS = 40;
  const MAX_MEDIA_PER_SOURCE = 40;
  const MAX_TEXT = 240;

  const previousPanel = document.getElementById(PANEL_ID);
  if (previousPanel) previousPanel.remove();
  const previousOverlay = document.getElementById(OVERLAY_ID);
  if (previousOverlay) previousOverlay.remove();

  const state = window.__TEMU_SOURCE_INSPECTOR__ || {
    page: {
      title: document.title,
      url: location.href,
      startedAt: new Date().toISOString()
    },
    requests: [],
    snapshots: [],
    selections: [],
    pickMode: "",
    hoverPath: "",
    lastError: ""
  };

  window.__TEMU_SOURCE_INSPECTOR__ = state;
  installStyles();
  installHooks(state);
  capturePageState(state, "manual-start");
  render(state);

  function installHooks(appState) {
    if (window.__TEMU_SOURCE_INSPECTOR_HOOKED__) return;
    window.__TEMU_SOURCE_INSPECTOR_HOOKED__ = true;

    const originalFetch = window.fetch;
    if (typeof originalFetch === "function") {
      window.fetch = async function patchedFetch(...args) {
        const startedAt = Date.now();
        const request = typeof args[0] === "string" ? { url: args[0], method: (args[1] && args[1].method) || "GET" } : {
          url: args[0] && args[0].url,
          method: (args[0] && args[0].method) || (args[1] && args[1].method) || "GET"
        };

        try {
          const response = await originalFetch.apply(this, args);
          processResponse({
            channel: "fetch",
            url: request.url,
            method: request.method,
            status: response.status,
            contentType: response.headers && response.headers.get ? response.headers.get("content-type") || "" : "",
            durationMs: Date.now() - startedAt,
            reader: () => response.clone().text()
          });
          return response;
        } catch (error) {
          recordRequest(appState, {
            channel: "fetch",
            url: request.url || "",
            method: request.method || "GET",
            status: 0,
            contentType: "",
            durationMs: Date.now() - startedAt,
            summary: summarizeError(error)
          });
          throw error;
        }
      };
    }

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
      this.__temuInspectorMeta = { method: method || "GET", url: String(url || ""), startedAt: 0 };
      return originalOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function patchedSend(body) {
      if (this.__temuInspectorMeta) this.__temuInspectorMeta.startedAt = Date.now();
      this.addEventListener("loadend", () => {
        const meta = this.__temuInspectorMeta || {};
        processResponse({
          channel: "xhr",
          url: meta.url || "",
          method: meta.method || "GET",
          status: this.status || 0,
          contentType: this.getResponseHeader ? this.getResponseHeader("content-type") || "" : "",
          durationMs: meta.startedAt ? Date.now() - meta.startedAt : 0,
          reader: () => Promise.resolve(typeof this.responseText === "string" ? this.responseText : "")
        });
      }, { once: true });
      return originalSend.call(this, body);
    };

    function processResponse(meta) {
      Promise.resolve()
        .then(meta.reader)
        .then((text) => {
          const summary = summarizePayload(meta.url, meta.contentType, text);
          if (!summary) return;
          recordRequest(appState, {
            channel: meta.channel,
            url: meta.url || "",
            method: meta.method || "GET",
            status: meta.status || 0,
            contentType: meta.contentType || "",
            durationMs: meta.durationMs || 0,
            summary
          });
        })
        .catch((error) => {
          recordRequest(appState, {
            channel: meta.channel,
            url: meta.url || "",
            method: meta.method || "GET",
            status: meta.status || 0,
            contentType: meta.contentType || "",
            durationMs: meta.durationMs || 0,
            summary: summarizeError(error)
          });
        });
    }
  }

  function render(appState) {
    const diagnosis = buildDiagnosis(appState);
    const panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="tsi-head">
        <strong>Temu Source Inspector</strong>
        <div class="tsi-head-actions">
          <button data-action="snapshot">抓一次页面状态</button>
          <button data-action="download">Download</button>
          <button data-action="close">Close</button>
        </div>
      </div>
      <div class="tsi-meta">
        <div>${escapeHtml(appState.page.title || "")}</div>
        <div class="tsi-sub">${escapeHtml(appState.page.url || "")}</div>
      </div>
      <div class="tsi-toolbar">
        <button data-pick="main">选主图区域</button>
        <button data-pick="sku">选SKU区域</button>
        <button data-pick="detail">选详情区域</button>
        <button data-pick="size">选尺寸区域</button>
        <button data-pick="video">选视频区域</button>
        <button data-action="clear-pick">取消选择</button>
      </div>
      <div class="tsi-status">
        <div>当前模式: <strong>${labelOf(appState.pickMode) || "未选择"}</strong></div>
        <div>接口 ${appState.requests.length} 条 | 页面快照 ${appState.snapshots.length} 个 | 区域 ${appState.selections.length} 个</div>
        ${appState.hoverPath ? `<div class="tsi-sub">hover: ${escapeHtml(appState.hoverPath)}</div>` : ""}
        ${appState.lastError ? `<div class="tsi-error">${escapeHtml(appState.lastError)}</div>` : ""}
      </div>
      <div class="tsi-body">
        <section>
          <h4>已选区域</h4>
          <div data-role="selections"></div>
        </section>
        <section>
          <h4>推荐采集结果</h4>
          <div data-role="diagnosis"></div>
        </section>
        <section>
          <h4>接口/状态来源</h4>
          <div data-role="requests"></div>
        </section>
      </div>
    `;

    const old = document.getElementById(PANEL_ID);
    if (old) old.replaceWith(panel);
    else document.body.appendChild(panel);

    panel.querySelector("[data-action='close']").addEventListener("click", teardown);
    panel.querySelector("[data-action='download']").addEventListener("click", () => downloadJson(exportState(appState)));
    panel.querySelector("[data-action='snapshot']").addEventListener("click", () => {
      capturePageState(appState, "manual-snapshot");
      render(appState);
    });
    panel.querySelector("[data-action='clear-pick']").addEventListener("click", () => {
      appState.pickMode = "";
      updateOverlay(null, appState);
      render(appState);
    });
    panel.querySelectorAll("[data-pick]").forEach((button) => {
      button.addEventListener("click", () => {
        appState.pickMode = button.getAttribute("data-pick") || "";
        render(appState);
      });
    });

    fillSelections(panel.querySelector("[data-role='selections']"), appState);
    fillDiagnosis(panel.querySelector("[data-role='diagnosis']"), diagnosis);
    fillRequests(panel.querySelector("[data-role='requests']"), appState);
    bindPicker(panel, appState);
  }

  function fillSelections(container, appState) {
    container.innerHTML = "";
    if (!appState.selections.length) {
      container.innerHTML = `<div class="tsi-empty">还没选区域。先点上面的“选主图区域 / 选SKU区域 / 选详情区域 / 选视频区域”，再去页面里点容器。</div>`;
      return;
    }

    for (const selection of appState.selections) {
      const card = document.createElement("article");
      card.className = "tsi-card";
      card.innerHTML = `
        <div class="tsi-card-top">
          <strong>${labelOf(selection.label)}</strong>
          <div class="tsi-card-actions">
            <button data-act="jump">定位</button>
            <button data-act="remove">删除</button>
          </div>
        </div>
        <div class="tsi-sub">${escapeHtml(selection.selector)}</div>
        <div>${selection.imageCount} 图 / ${selection.videoCount} 视频 / ${selection.text ? escapeHtml(selection.text) : "无文本"}</div>
        <div class="tsi-chip-row">${selection.samples.map((sample) => `<span class="tsi-chip">${escapeHtml(sample.kind)}</span>`).join("")}</div>
        ${renderSelectionBreakdown(selection)}
      `;
      card.querySelector("[data-act='remove']").addEventListener("click", () => {
        appState.selections = appState.selections.filter((item) => item.id !== selection.id);
        render(appState);
      });
      card.querySelector("[data-act='jump']").addEventListener("click", () => {
        const target = document.querySelector(selection.selector);
        if (!target) return;
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        flashElement(target);
      });
      container.appendChild(card);
    }
  }

  function fillDiagnosis(container, diagnosis) {
    container.innerHTML = "";
    const rows = [
      ["main", "主图"],
      ["sku", "SKU"],
      ["detail", "详情"],
      ["size", "尺寸"],
      ["video", "视频"]
    ];

    for (const [key, label] of rows) {
      const media = diagnosis.recommended[key] || [];
      const card = document.createElement("article");
      card.className = "tsi-card";
      const sampleText = media.slice(0, 3).map((url) => trimText(url, 96)).join(" | ");
      card.innerHTML = `
        <div class="tsi-card-top">
          <strong>${label}</strong>
          <span class="tsi-chip">${media.length} ${key === "video" ? "url" : "items"}</span>
        </div>
        <div>${escapeHtml(diagnosis.notes[key] || "-")}</div>
        <div class="tsi-sub">${sampleText ? escapeHtml(sampleText) : "No matched media"}</div>
        ${renderMediaList(media, key)}
        ${renderCandidateSummary(diagnosis.autoCandidates[key] || [], key)}
      `;
      container.appendChild(card);
    }

    if (diagnosis.warnings.length) {
      const warning = document.createElement("article");
      warning.className = "tsi-card";
      warning.innerHTML = `
        <div class="tsi-card-top"><strong>Warnings</strong></div>
        <div>${diagnosis.warnings.map((item) => escapeHtml(item)).join("<br>")}</div>
      `;
      container.appendChild(warning);
    }
  }

  function fillRequests(container, appState) {
    container.innerHTML = "";
    if (!appState.requests.length && !appState.snapshots.length) {
      container.innerHTML = `<div class="tsi-empty">还没有可用来源。你可以先刷新页面，或者点“抓一次页面状态”。</div>`;
      return;
    }

    for (const snapshot of [...appState.snapshots].reverse()) {
      container.appendChild(renderSourceCard({
        title: `页面状态: ${snapshot.source}`,
        subtitle: snapshot.createdAt,
        data: snapshot.summary
      }));
    }

    for (const request of [...appState.requests].reverse()) {
      container.appendChild(renderSourceCard({
        title: `${request.channel.toUpperCase()} ${request.method} ${request.status}`,
        subtitle: request.url,
        data: request.summary,
        meta: `${request.durationMs}ms ${request.contentType || ""}`.trim()
      }));
    }
  }

  function renderSourceCard({ title, subtitle, meta, data }) {
    const card = document.createElement("article");
    card.className = "tsi-card";
    card.innerHTML = `
      <div class="tsi-card-top">
        <strong>${escapeHtml(title)}</strong>
        ${meta ? `<span class="tsi-sub">${escapeHtml(meta)}</span>` : ""}
      </div>
      <div class="tsi-sub">${escapeHtml(subtitle || "")}</div>
      <div class="tsi-grid-2">
        <div>title: ${escapeHtml(data.title || "-")}</div>
        <div>price: ${escapeHtml(data.price || "-")}</div>
        <div>productId: ${escapeHtml(data.productId || "-")}</div>
        <div>video: ${(data.videoUrls || []).length}</div>
        <div>main候选: ${(data.mainImages || []).length}</div>
        <div>sku候选: ${(data.skuImages || []).length}</div>
        <div>详情候选: ${(data.detailImages || []).length}</div>
        <div>尺寸候选: ${(data.sizeImages || []).length}</div>
        <div>keys: ${(data.topKeys || []).slice(0, 6).join(", ") || "-"}</div>
      </div>
      ${(data.pathHints || []).length ? `<div class="tsi-sub">paths: ${escapeHtml(data.pathHints.slice(0, 6).join(" | "))}</div>` : ""}
    `;
    return card;
  }

  function renderSelectionBreakdown(selection) {
    const details = [];
    if (selection.productImages?.length) details.push(`product ${selection.productImages.length}`);
    if (selection.uiImages?.length) details.push(`ui ${selection.uiImages.length}`);
    if (selection.otherImages?.length) details.push(`other ${selection.otherImages.length}`);
    if (!details.length) return "";
    return `<div class="tsi-sub">${escapeHtml(details.join(" / "))}</div>`;
  }

  function renderCandidateSummary(candidates, key) {
    if (!candidates.length) {
      return `<div class="tsi-sub">auto: no ${escapeHtml(key)} candidate container found</div>`;
    }
    const lines = candidates.slice(0, 2).map((candidate) => {
      const stats = [
        `score ${candidate.score}`,
        `product ${candidate.productImageCount}`,
        `ui ${candidate.uiImageCount}`,
        `other ${candidate.otherImageCount}`,
        `video ${candidate.videoCount}`
      ].join(" / ");
      return `${candidate.selector} | ${stats}`;
    });
    return `<div class="tsi-sub">auto: ${escapeHtml(lines.join(" || "))}</div>`;
  }

  function renderMediaList(media, key) {
    if (!media.length) return "";
    const rows = media.slice(0, 8).map((url, index) => {
      const label = key === "video" ? `video ${index + 1}` : `${index + 1}`;
      return `<div class="tsi-sub">${label}: ${escapeHtml(trimText(url, 140))}</div>`;
    }).join("");
    return `<div>${rows}</div>`;
  }

  function bindPicker(panel, appState) {
    if (document.__temuSourceInspectorBound) return;
    document.__temuSourceInspectorBound = true;

    document.addEventListener("mousemove", (event) => {
      if (!appState.pickMode) return;
      if (panel.contains(event.target)) return;
      const target = bestContainer(event.target);
      updateOverlay(target, appState);
    }, true);

    document.addEventListener("click", (event) => {
      if (!appState.pickMode) return;
      if (panel.contains(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const target = bestContainer(event.target);
      if (!target) return;
      saveSelection(appState, appState.pickMode, target);
      appState.pickMode = "";
      updateOverlay(null, appState);
      render(appState);
    }, true);
  }

  function saveSelection(appState, label, element) {
    const selector = cssSelector(element);
    const media = collectMediaFromElement(element);
    const selection = {
      id: `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label,
      selector,
      domPath: elementPath(element),
      text: trimText(nearbyText(element), 120),
      imageCount: media.images.length,
      videoCount: media.videos.length,
      images: media.images,
      videos: media.videos,
      productImages: media.productImages,
      uiImages: media.uiImages,
      otherImages: media.otherImages,
      samples: media.samples.slice(0, 10),
      rect: rectSummary(element.getBoundingClientRect())
    };

    appState.selections = appState.selections.filter((item) => item.label !== label);
    appState.selections.push(selection);
  }

  function capturePageState(appState, source) {
    const snapshots = [
      ["window.__NEXT_DATA__", safeRead(() => window.__NEXT_DATA__)],
      ["window.__INITIAL_STATE__", safeRead(() => window.__INITIAL_STATE__)],
      ["ld+json", collectLdJson()],
      ["performance", performance.getEntriesByType("resource").slice(-60).map((entry) => ({ name: entry.name, initiatorType: entry.initiatorType }))]
    ];

    for (const [name, payload] of snapshots) {
      if (!payload || (Array.isArray(payload) && !payload.length)) continue;
      const summary = summarizeAnyPayload(payload);
      if (!summary) continue;
      appState.snapshots.push({
        source: `${source}:${name}`,
        createdAt: new Date().toISOString(),
        summary
      });
    }

    appState.snapshots = appState.snapshots.slice(-12);
  }

  function summarizePayload(url, contentType, text) {
    const lower = `${url || ""} ${contentType || ""}`.toLowerCase();
    const likelyProduct = /temu|goods|product|detail|sku|gallery|video|api|search/.test(lower);
    const trimmed = (text || "").trim();
    if (!likelyProduct && !/^[\[{]/.test(trimmed)) return null;
    if (!trimmed) return null;

    try {
      const payload = JSON.parse(trimmed);
      return summarizeAnyPayload(payload);
    } catch {
      if (!likelyProduct) return null;
      return summarizeAnyPayload(trimmed.slice(0, 40000));
    }
  }

  function summarizeAnyPayload(payload) {
    const summary = {
      title: "",
      price: "",
      productId: "",
      mainImages: [],
      skuImages: [],
      detailImages: [],
      sizeImages: [],
      videoUrls: [],
      topKeys: [],
      pathHints: []
    };

    walkPayload(payload, "", summary, 0);
    summary.mainImages = dedupe(summary.mainImages).slice(0, MAX_MEDIA_PER_SOURCE);
    summary.skuImages = dedupe(summary.skuImages).slice(0, MAX_MEDIA_PER_SOURCE);
    summary.detailImages = dedupe(summary.detailImages).slice(0, MAX_MEDIA_PER_SOURCE);
    summary.sizeImages = dedupe(summary.sizeImages).slice(0, MAX_MEDIA_PER_SOURCE);
    summary.videoUrls = dedupe(summary.videoUrls).slice(0, MAX_MEDIA_PER_SOURCE);
    summary.pathHints = dedupe(summary.pathHints).slice(0, 20);
    summary.topKeys = summary.topKeys.slice(0, 20);

    if (!summary.title && !summary.price && !summary.productId && !summary.mainImages.length && !summary.skuImages.length && !summary.detailImages.length && !summary.sizeImages.length && !summary.videoUrls.length) {
      return null;
    }
    return summary;
  }

  function walkPayload(value, path, summary, depth) {
    if (value == null || depth > 10) return;

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      const text = String(value);
      const key = path.split(".").pop() || "";
      if (!summary.title && /goodsname|productname|producttitle|title/i.test(key) && text.length > 3 && text.length < 240) summary.title = trimText(text, 240);
      if (!summary.productId && /goodsid|productid|mallgoodsid|itemid/i.test(key) && /\d{5,}/.test(text)) summary.productId = text.match(/\d{5,}/)[0];
      if (!summary.price && /price|amount|minprice|maxprice|saleprice/i.test(key) && /[\d.]/.test(text)) summary.price = text;

      if (/^https?:\/\//i.test(text)) {
        const lowerPath = path.toLowerCase();
        if (/\.(mp4|m3u8)(\?|$)/i.test(text) || /video/i.test(lowerPath)) summary.videoUrls.push(text);
        else if (/sizechart|size_chart|measurement|dimension|尺码|尺寸/i.test(lowerPath)) summary.sizeImages.push(text);
        else if (/sku|spec|variant|color|size|swatch/i.test(lowerPath)) summary.skuImages.push(text);
        else if (/detail|desc|description|goodsdetail|longimage/i.test(lowerPath)) summary.detailImages.push(text);
        else summary.mainImages.push(text);
        if (lowerPath) summary.pathHints.push(lowerPath);
      }
      return;
    }

    if (Array.isArray(value)) {
      value.slice(0, 120).forEach((item, index) => walkPayload(item, `${path}[${index}]`, summary, depth + 1));
      return;
    }

    if (typeof value === "object") {
      const keys = Object.keys(value);
      if (!summary.topKeys.length) summary.topKeys = keys.slice(0, 20);
      for (const [key, nested] of Object.entries(value)) {
        const nextPath = path ? `${path}.${key}` : key;
        if (/gallery|image|img|video|sku|spec|detail|goods/i.test(nextPath)) summary.pathHints.push(nextPath);
        walkPayload(nested, nextPath, summary, depth + 1);
      }
    }
  }

  function collectLdJson() {
    return Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .map((node) => node.textContent || "")
      .filter(Boolean)
      .slice(0, 10)
      .map((text) => {
        try {
          return JSON.parse(text);
        } catch {
          return text.slice(0, 3000);
        }
      });
  }

  function bestContainer(node) {
    let current = node instanceof Element ? node : null;
    let fallback = null;
    while (current && current !== document.body) {
      if (!fallback && /(img|video|picture)/i.test(current.tagName)) fallback = current.parentElement || current;
      const score = candidateScore(current);
      if (score >= 3) return current;
      current = current.parentElement;
    }
    return fallback || (node instanceof Element ? node : null);
  }

  function candidateScore(element) {
    const path = elementPath(element).toLowerCase();
    const text = nearbyText(element).toLowerCase();
    const images = element.querySelectorAll("img").length;
    const videos = element.querySelectorAll("video").length;
    let score = 0;
    if (images >= 2) score += 2;
    if (images >= 5) score += 1;
    if (videos >= 1) score += 2;
    if (/goodsdetail|detail|description/.test(path)) score += 2;
    if (/sku|spec|variant|color|size|swatch/.test(path)) score += 2;
    if (/gallery|swiper|carousel|thumb|goods image/.test(path)) score += 2;
    if (/choose|color|size|variation|specification/.test(text)) score += 1;
    return score;
  }

  function collectMediaFromElement(element) {
    const images = Array.from(element.querySelectorAll("img"))
      .map((img) => normalizeTemuMediaUrl(img.currentSrc || img.src || ""))
      .filter(Boolean);
    const videos = Array.from(element.querySelectorAll("video, source"))
      .map((video) => normalizeTemuMediaUrl(video.currentSrc || video.src || ""))
      .filter(Boolean);
    const dedupedImages = dedupe(images);
    const productImages = dedupedImages.filter(isTemuProductImage);
    const uiImages = dedupedImages.filter(isTemuUiImage);
    const otherImages = dedupedImages.filter((url) => !productImages.includes(url) && !uiImages.includes(url));

    return {
      images: dedupedImages,
      videos: dedupe(videos),
      productImages,
      uiImages,
      otherImages,
      samples: [
        ...dedupedImages.slice(0, 8).map((url) => ({ kind: classifyImageKind(url), url })),
        ...dedupe(videos).slice(0, 4).map((url) => ({ kind: "video", url }))
      ]
    };
  }

  function buildDiagnosis(appState) {
    const recommended = { main: [], sku: [], detail: [], size: [], video: [] };
    const notes = { main: "", sku: "", detail: "", size: "", video: "" };
    const warnings = [];
    const autoCandidates = collectAutomaticCandidates();
    const sourceCandidates = collectSourceMediaCandidates(appState);
    const byLabel = Object.fromEntries((appState.selections || []).map((item) => [item.label, item]));
    const topMainCandidate = autoCandidates.main[0] || null;
    const topSkuCandidate = autoCandidates.sku[0] || null;
    const topDetailCandidate = autoCandidates.detail[0] || null;
    const topSizeCandidate = autoCandidates.size[0] || null;
    const topVideoCandidate = autoCandidates.video[0] || null;

    if (byLabel.main) {
      recommended.main = filterMainSelection(byLabel.main);
      notes.main = recommended.main.length
        ? "Use the left gallery/thumb container. Keep product images only."
        : "Main area selected, but no valid product image matched.";
    } else if (topMainCandidate) {
      recommended.main = filterMainSelection(topMainCandidate);
      notes.main = recommended.main.length
        ? `Auto matched main container: ${topMainCandidate.selector}`
        : `Auto found main candidate, but it did not yield clean product images: ${topMainCandidate.selector}`;
    } else {
      notes.main = "Select the left gallery thumbnail container, not the whole left column.";
    }

    if (byLabel.sku) {
      recommended.sku = filterSkuSelection(byLabel.sku, recommended.main);
      notes.sku = recommended.sku.length
        ? "Use only variant/color/spec thumbnails. Avoid the whole right info column."
        : "SKU area contains mostly UI assets or duplicates of main images.";
    } else if (topSkuCandidate) {
      recommended.sku = filterSkuSelection(topSkuCandidate, recommended.main);
      notes.sku = recommended.sku.length
        ? `Auto matched SKU container: ${topSkuCandidate.selector}`
        : `Auto found SKU candidate, but it contains mostly UI assets or duplicates: ${topSkuCandidate.selector}`;
    } else {
      notes.sku = "Select only the variant swatch/spec image block.";
    }

    if (byLabel.detail) {
      recommended.detail = filterDetailSelection(byLabel.detail, [...recommended.main, ...recommended.sku]);
      notes.detail = recommended.detail.length
        ? "Detail images should come from the goods detail block below the fold."
        : "Detail area did not yield clean detail images.";
    } else if (topDetailCandidate) {
      recommended.detail = filterDetailSelection(topDetailCandidate, [...recommended.main, ...recommended.sku]);
      notes.detail = recommended.detail.length
        ? `Auto matched detail container: ${topDetailCandidate.selector}`
        : `Auto found detail candidate, but it did not yield clean detail images: ${topDetailCandidate.selector}`;
    } else {
      notes.detail = "Select the long detail image block under goods detail.";
    }

    if (byLabel.size) {
      recommended.size = filterSizeSelection(byLabel.size, [...recommended.main, ...recommended.sku, ...recommended.detail]);
      notes.size = recommended.size.length
        ? "Size images should come from the size chart / measurement block."
        : "Selected size area did not yield a clean size chart image.";
    } else if (topSizeCandidate) {
      recommended.size = filterSizeSelection(topSizeCandidate, [...recommended.main, ...recommended.sku, ...recommended.detail]);
      notes.size = recommended.size.length
        ? `Auto matched size container: ${topSizeCandidate.selector}`
        : `Auto found size candidate, but it did not yield a clean size chart image: ${topSizeCandidate.selector}`;
    } else {
      notes.size = "Select the size chart / measurement image block if the page has one.";
    }

    if (byLabel.video) {
      recommended.video = dedupe(byLabel.video.videos || []).filter((url) => /(\.mp4|\.m3u8)(\?|$)/i.test(url) || /video/i.test(url));
      notes.video = recommended.video.length
        ? "Use only the actual product player/video source."
        : "Selected video area has no playable video URL.";
    } else if (topVideoCandidate) {
      recommended.video = dedupe(topVideoCandidate.videos || []).filter((url) => /(\.mp4|\.m3u8)(\?|$)/i.test(url) || /video/i.test(url));
      notes.video = recommended.video.length
        ? `Auto matched video container: ${topVideoCandidate.selector}`
        : `Auto found video candidate, but no playable URL was extracted: ${topVideoCandidate.selector}`;
    } else {
      notes.video = "Video, if present, usually lives inside the goods detail area. This page may simply have no video.";
    }

    recommended.main = mergeRankedMedia(recommended.main, sourceCandidates.main, 16);
    recommended.detail = mergeRankedMedia(recommended.detail, sourceCandidates.detail, 24);
    recommended.size = mergeRankedMedia(recommended.size, sourceCandidates.size, 12);

    if (byLabel.sku && (byLabel.sku.uiImages || []).length >= Math.max(4, (byLabel.sku.productImages || []).length)) {
      warnings.push("SKU selection includes too many UI assets. Do not select the whole #rightContent block.");
    }
    if (!byLabel.sku && topSkuCandidate && !recommended.sku.length && topSkuCandidate.uiImageCount > topSkuCandidate.productImageCount) {
      warnings.push(`SKU auto candidate is dominated by UI assets: ${topSkuCandidate.selector}`);
    }
    if (!byLabel.detail && topDetailCandidate && !recommended.detail.length && !topDetailCandidate.productImageCount) {
      warnings.push(`Detail auto candidate has no product images: ${topDetailCandidate.selector}`);
    }
    if (!byLabel.size && !topSizeCandidate && sourceCandidates.size.length) {
      warnings.push("Size-chart-like images were found in page/script sources, but no dedicated size container was auto-detected.");
    }
    if (recommended.main.length < sourceCandidates.main.length && sourceCandidates.main.length >= 8) {
      warnings.push(`DOM 主图区域少于脚本/状态里的主图候选：DOM ${recommended.main.length} / Source ${sourceCandidates.main.length}`);
    }
    if (!recommended.detail.length && sourceCandidates.detail.length) {
      warnings.push(`DOM 详情区域未识别到干净详情图，但脚本/状态里还有 ${sourceCandidates.detail.length} 张详情候选。`);
    }
    if (!topSkuCandidate) warnings.push("No SKU candidate container was auto-detected on this Temu page.");
    if (!topDetailCandidate) warnings.push("No detail candidate container was auto-detected on this Temu page.");
    if (!recommended.video.length && byLabel.video) warnings.push("Video area selected but no <video>/<source> URL was found.");
    if (!appState.requests.length) warnings.push("No network requests were captured. Inject the script, then refresh the page.");
    if (!appState.snapshots.some((item) => /__NEXT_DATA__|__INITIAL_STATE__|ld\\+json/i.test(item.source || ""))) {
      warnings.push("Structured page state was not detected in the scanned globals.");
    }

    return { recommended, notes, warnings, autoCandidates };
  }

  function filterMainSelection(selection) {
    const urls = dedupe(selection.productImages || [])
      .filter((url) => !isTemuUiImage(url))
      .filter((url) => !/detail|desc|description|recommend|similar|review|avatar|icon|goods-icon|sku|spec|variant|color/i.test(url));
    return prioritizeGalleryImages(urls).slice(0, 12);
  }

  function filterSkuSelection(selection, mainImages) {
    const urls = dedupe(selection.productImages || [])
      .filter((url) => !isTemuUiImage(url))
      .filter((url) => !mainImages.includes(url));
    return urls.filter((url) => /product\/(?:fancy|open)\//i.test(url)).slice(0, 20);
  }

  function filterDetailSelection(selection, excluded) {
    return dedupe([...(selection.productImages || []), ...(selection.otherImages || [])])
      .filter((url) => !isTemuUiImage(url))
      .filter((url) => !excluded.includes(url))
      .filter((url) => /upload_aimg\/goods_details|material-put/i.test(url))
      .slice(0, 20);
  }

  function filterSizeSelection(selection, excluded) {
    return dedupe([...(selection.productImages || []), ...(selection.otherImages || [])])
      .filter((url) => !isTemuUiImage(url))
      .filter((url) => !excluded.includes(url))
      .filter((url) => /size|chart|measurement|dimension|goods_details|material-put|尺码|尺寸/i.test(url))
      .slice(0, 12);
  }

  function collectAutomaticCandidates() {
    return {
      main: collectCandidatesForKind("main", [
        "#leftContent ._1CQ4cRYC ._2AKu-30-",
        "#leftContent ._1CQ4cRYC ._2AKu-30- ._2AOclWz7",
        "#leftContent ._2AKu-30- ._2AOclWz7",
        "#leftContent ._2AKu-30-",
        "#leftContent ._1CQ4cRYC",
        "#leftContent [data-testid*='gallery']",
        "#leftContent [data-testid*='thumb']",
        "#leftContent [class*='gallery']",
        "#leftContent [class*='thumb']"
      ], "#leftContent"),
      sku: collectCandidatesForKind("sku", [
        "#rightContent ._2nVeyNCz",
        "#rightContent ._2nVeyNCz ._2QQEVpBZ._3a0ITqR8",
        "#rightContent ._2nVeyNCz ._1thUmrmy",
        "#rightContent ._2nVeyNCz ._3csHYvw1._2Z6iM40Q",
        "._2nVeyNCz",
        "#rightContent [class*='sku']",
        "#rightContent [class*='Sku']",
        "#rightContent [class*='spec']",
        "#rightContent [class*='Spec']",
        "#rightContent [class*='color']",
        "#rightContent [class*='Color']",
        "#rightContent [class*='variant']",
        "#rightContent [class*='Variant']",
        "#rightContent [data-testid*='sku']",
        "#rightContent [data-testid*='spec']",
        "#rightContent [data-testid*='color']",
        "#rightContent [data-testid*='variant']",
        "div._3ahj1iso._2t9k5tsc",
        "div._3ahj1iso",
        "[class*='_2t9k5tsc']",
        "#rightContent [class*='swatch']"
      ], "#rightContent"),
      detail: collectCandidatesForKind("detail", [
        "#goodsDetail .LqemymRS._23UQG0mN",
        "#goodsDetail .LqemymRS._3NKWJjn8",
        "#goodsDetail .LqemymRS._23UQG0mN ._2jCYETGt",
        "#goodsDetail ._2jCYETGt",
        "#goodsDetail",
        "[id*='goodsDetail']",
        "[id*='detail']",
        "[data-testid*='detail']",
        "[data-testid*='description']",
        "[class*='detail']",
        "[class*='Detail']",
        "[class*='description']",
        "[class*='Description']"
      ], "#goodsDetail"),
      size: collectCandidatesForKind("size", [
        "#goodsDetail [class*='size']",
        "#goodsDetail [class*='chart']",
        "#goodsDetail [class*='measure']",
        "#goodsDetail [data-testid*='size']",
        "#goodsDetail [data-testid*='chart']",
        "[class*='size-chart']",
        "[class*='sizeChart']",
        "[class*='measurement']",
        "[class*='dimension']"
      ], "#goodsDetail"),
      video: collectCandidatesForKind("video", [
        "#leftContent video",
        "#leftContent [class*='video']",
        "#goodsDetail video",
        "#goodsDetail source",
        "#goodsDetail [class*='video']",
        "#goodsDetail [data-video-url]",
        "#goodsDetail [data-video-src]",
        "[data-video-url]",
        "[data-video-src]"
      ], "#leftContent")
    };
  }

  function collectCandidatesForKind(kind, selectors, heuristicRootSelector) {
    const map = new Map();
    for (const selector of selectors) {
      let elements = [];
      try {
        elements = Array.from(document.querySelectorAll(selector));
      } catch {
        elements = [];
      }
      for (const element of elements) {
        if (!(element instanceof Element)) continue;
        addCandidate(map, kind, element, selector, "selector");
      }
    }

    const heuristicRoot = heuristicRootSelector ? document.querySelector(heuristicRootSelector) : null;
    const heuristicNodes = heuristicRoot ? Array.from(heuristicRoot.querySelectorAll("*")) : [];
    for (const element of heuristicNodes) {
      if (!(element instanceof Element)) continue;
      if (candidateScoreForKind(kind, element) < heuristicThreshold(kind)) continue;
      addCandidate(map, kind, element, heuristicRootSelector || "heuristic-root", "heuristic");
    }

    return Array.from(map.values())
      .sort((a, b) => b.score - a.score || b.productImageCount - a.productImageCount || b.videoCount - a.videoCount || a.selector.length - b.selector.length)
      .slice(0, 6);
  }

  function addCandidate(map, kind, element, matchedBy, source) {
    const selector = cssSelector(element);
    if (!selector || map.has(selector)) return;
    const media = collectMediaFromElement(element);
    const candidate = {
      label: kind,
      selector,
      matchedBy,
      source,
      domPath: elementPath(element),
      text: trimText(nearbyText(element), 120),
      images: media.images,
      videos: media.videos,
      productImages: media.productImages,
      uiImages: media.uiImages,
      otherImages: media.otherImages,
      imageCount: media.images.length,
      productImageCount: media.productImages.length,
      uiImageCount: media.uiImages.length,
      otherImageCount: media.otherImages.length,
      videoCount: media.videos.length,
      score: scoreAutoCandidate(kind, element, media, matchedBy)
    };
    if (!candidate.imageCount && !candidate.videoCount) return;
    map.set(selector, candidate);
  }

  function heuristicThreshold(kind) {
    return { main: 4, sku: 5, detail: 4, size: 4, video: 3 }[kind] || 4;
  }

  function candidateScoreForKind(kind, element) {
    const path = elementPath(element).toLowerCase();
    const text = nearbyText(element).toLowerCase();
    const images = element.querySelectorAll("img").length;
    const videos = element.querySelectorAll("video, source").length;
    let score = 0;
    if (images >= 1) score += 1;
    if (images >= 3) score += 1;
    if (videos >= 1) score += 2;
    if (kind === "sku" && /sku|spec|variant|color|size|swatch/.test(path)) score += 2;
    if (kind === "sku" && /color|size|variation|specification|choose/.test(text)) score += 1;
    if (kind === "detail" && /goodsdetail|detail|description/.test(path)) score += 3;
    if (kind === "size" && /size|chart|measure|dimension/.test(path)) score += 4;
    if (kind === "size" && /size|measurement|dimension|尺码|尺寸/.test(text)) score += 2;
    if (kind === "main" && /gallery|thumb/.test(path)) score += 2;
    if (kind === "main" && /carousel|swiper/.test(path)) score -= 1;
    if (kind === "sku" && /_2nveyncz/.test(path)) score += 4;
    if (kind === "video" && /video/.test(path)) score += 2;
    return score;
  }

  function scoreAutoCandidate(kind, element, media, matchedBy) {
    const path = elementPath(element).toLowerCase();
    const text = nearbyText(element).toLowerCase();
    let score = media.productImages.length * 3 + media.videos.length * 4 + Math.min(media.otherImages.length, 2) - media.uiImages.length;
    if (kind === "main" && /leftcontent|gallery|thumb/.test(path)) score += 4;
    if (kind === "main" && /carousel|swiper/.test(path)) score -= 2;
    if (kind === "sku" && /_2nveyncz/.test(path)) score += 8;
    if (kind === "sku" && /rightcontent|sku|spec|variant|color|size|swatch/.test(path)) score += 5;
    if (kind === "detail" && /goodsdetail|detail|description/.test(path)) score += 6;
    if (kind === "size" && /size|chart|measure|dimension/.test(path)) score += 7;
    if (kind === "video" && /video/.test(path)) score += 5;
    if (kind === "sku" && /color|size|variation|specification|choose/.test(text)) score += 2;
    if (kind === "detail" && /description|detail|material|specification/.test(text)) score += 2;
    if (kind === "size" && /size|measurement|dimension|尺码|尺寸/.test(text)) score += 3;
    if (kind === "main" && /review|recommend|similar/.test(path)) score -= 4;
    if (kind === "main" && media.productImages.some((url) => /w\/800|q\/70|format\/avif/i.test(url)) && media.productImages.some((url) => /w\/180|w\/50/i.test(url))) score += 1;
    if (matchedBy && matchedBy !== "heuristic-root") score += 1;
    return score;
  }

  function updateOverlay(target, appState) {
    let overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = OVERLAY_ID;
      document.body.appendChild(overlay);
    }

    if (!target) {
      overlay.style.display = "none";
      appState.hoverPath = "";
      return;
    }

    const rect = target.getBoundingClientRect();
    overlay.style.display = "block";
    overlay.style.left = `${rect.left + window.scrollX}px`;
    overlay.style.top = `${rect.top + window.scrollY}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    overlay.textContent = `${labelOf(appState.pickMode)}: ${trimText(elementPath(target), 120)}`;
    appState.hoverPath = elementPath(target);
  }

  function flashElement(element) {
    const previous = element.style.outline;
    element.style.outline = "3px solid #1664ff";
    setTimeout(() => {
      element.style.outline = previous;
    }, 1200);
  }

  function exportState(appState) {
    return {
      page: appState.page,
      exportedAt: new Date().toISOString(),
      diagnosis: buildDiagnosis(appState),
      selections: appState.selections,
      snapshots: appState.snapshots,
      requests: appState.requests
    };
  }

  function recordRequest(appState, request) {
    const key = `${request.channel}|${request.method}|${request.url}|${request.status}`;
    if (appState.requests.some((item) => item.key === key)) return;
    appState.requests.push({ key, ...request, capturedAt: new Date().toISOString() });
    appState.requests = appState.requests.slice(-MAX_REQUESTS);
    const panel = document.getElementById(PANEL_ID);
    if (panel) fillRequests(panel.querySelector("[data-role='requests']"), appState);
  }

  function downloadJson(data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `temu-source-inspector-${Date.now()}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function teardown() {
    const panel = document.getElementById(PANEL_ID);
    if (panel) panel.remove();
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) overlay.remove();
    state.pickMode = "";
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID}{
        position:fixed;top:16px;right:16px;z-index:2147483647;width:560px;max-height:86vh;overflow:hidden;
        background:#fff;border:1px solid #d9dde5;border-radius:12px;box-shadow:0 20px 56px rgba(31,35,41,.22);
        font:12px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f2329;display:grid;grid-template-rows:auto auto auto auto 1fr;
      }
      #${PANEL_ID} button{cursor:pointer;border:1px solid #d0d7e2;background:#fff;border-radius:8px;padding:5px 8px;font:inherit}
      #${PANEL_ID} h4{margin:0 0 8px;font-size:12px}
      #${PANEL_ID} .tsi-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#1664ff;color:#fff}
      #${PANEL_ID} .tsi-head-actions{display:flex;gap:6px}
      #${PANEL_ID} .tsi-head-actions button{background:rgba(255,255,255,.14);color:#fff;border-color:rgba(255,255,255,.24)}
      #${PANEL_ID} .tsi-meta,#${PANEL_ID} .tsi-toolbar,#${PANEL_ID} .tsi-status{padding:10px 12px;border-bottom:1px solid #eff1f5}
      #${PANEL_ID} .tsi-toolbar{display:flex;gap:8px;flex-wrap:wrap;background:#fafbfc}
      #${PANEL_ID} .tsi-body{overflow:auto;padding:12px;display:grid;gap:14px}
      #${PANEL_ID} .tsi-card{display:grid;gap:6px;padding:10px;border:1px solid #eff1f5;border-radius:10px;background:#fff}
      #${PANEL_ID} .tsi-card-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
      #${PANEL_ID} .tsi-card-actions{display:flex;gap:6px}
      #${PANEL_ID} .tsi-sub{font-size:11px;color:#8f959e;word-break:break-all}
      #${PANEL_ID} .tsi-empty{padding:10px;border:1px dashed #d9dde5;border-radius:10px;color:#646a73;background:#fafbfc}
      #${PANEL_ID} .tsi-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:4px 10px}
      #${PANEL_ID} .tsi-chip-row{display:flex;gap:6px;flex-wrap:wrap}
      #${PANEL_ID} .tsi-chip{display:inline-flex;align-items:center;padding:2px 6px;border-radius:999px;background:#f2f3f5;color:#4e5969;font-size:10px}
      #${PANEL_ID} .tsi-error{margin-top:4px;color:#d4380d}
      #${OVERLAY_ID}{
        position:absolute;z-index:2147483646;pointer-events:none;border:3px solid #1664ff;background:rgba(22,100,255,.08);
        border-radius:8px;display:none;color:#1664ff;font:12px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:4px 6px;box-sizing:border-box
      }
    `;
    document.documentElement.appendChild(style);
  }

  function labelOf(value) {
    return { main: "主图", sku: "SKU", detail: "详情", size: "尺寸", video: "视频" }[value] || value || "";
  }

  function collectSourceMediaCandidates(appState) {
    const sourceSummaries = [
      ...(appState.snapshots || []).map((item) => item.summary),
      ...(appState.requests || []).map((item) => item.summary)
    ].filter(Boolean);

    return {
      main: prioritizeGalleryImages(
        sourceSummaries
          .flatMap((item) => item.mainImages || [])
          .filter(isTemuProductImage)
          .filter((url) => !isTemuUiImage(url))
      ).slice(0, 20),
      detail: dedupe(
        sourceSummaries
          .flatMap((item) => item.detailImages || [])
          .filter(isTemuProductImage)
          .filter((url) => !isTemuUiImage(url))
          .filter((url) => /upload_aimg\/goods_details|material-put/i.test(url))
      ).slice(0, 24),
      size: dedupe(
        sourceSummaries
          .flatMap((item) => item.sizeImages || [])
          .filter(isTemuProductImage)
          .filter((url) => !isTemuUiImage(url))
          .filter((url) => /size|chart|measurement|dimension|goods_details|material-put|尺码|尺寸/i.test(url))
      ).slice(0, 12)
    };
  }

  function mergeRankedMedia(primary, secondary, limit) {
    return prioritizeGalleryImages([...(primary || []), ...(secondary || [])]).slice(0, limit);
  }

  function normalizeUrl(url) {
    try {
      return url ? new URL(url, location.href).href : "";
    } catch {
      return url || "";
    }
  }

  function dedupe(list) {
    return Array.from(new Set((list || []).filter(Boolean)));
  }

  function classifyImageKind(url) {
    if (isTemuUiImage(url)) return "ui-image";
    if (isTemuProductImage(url)) return "product-image";
    return "image";
  }

  function normalizeTemuMediaUrl(url) {
    const normalized = normalizeUrl(url);
    if (!normalized || !/kwcdn\.com|temu|upload_aimg/i.test(normalized)) return normalized;
    try {
      const parsed = new URL(normalized);
      parsed.hash = "";
      if (/imageview2|format=|image_format=|w\/\d+|q\/\d+/i.test(parsed.search)) parsed.search = "";
      parsed.pathname = parsed.pathname
        .replace(/\.jpg_\.(webp|avif)$/i, ".jpg")
        .replace(/\.jpeg_\.(webp|avif)$/i, ".jpeg")
        .replace(/_(?:\d+x\d+|\d+x\d+xq\d+)(?=\.(?:jpg|jpeg|png|webp|avif)$)/i, "");
      return parsed.href;
    } catch {
      return normalized
        .replace(/\.jpg_\.(webp|avif)$/i, ".jpg")
        .replace(/\.jpeg_\.(webp|avif)$/i, ".jpeg")
        .replace(/_(?:\d+x\d+|\d+x\d+xq\d+)(?=\.(?:jpg|jpeg|png|webp|avif)$)/i, "");
    }
  }

  function isTemuProductImage(url) {
    return /img\.kwcdn\.com\/product\//i.test(url)
      || /aimg\.kwcdn\.com\/product\//i.test(url)
      || /\/upload_aimg\/.*\/product\//i.test(url)
      || /\/product\/fancy\//i.test(url)
      || /\/product\/open\//i.test(url)
      || /kwcdn\.com\/[^?#]+(?:goods|gallery|sku|spec|detail|open|fancy)/i.test(url)
      || /(?:format|image_format)=(?:avif|webp)/i.test(url) && /kwcdn\.com/i.test(url);
  }

  function isTemuUiImage(url) {
    return /tree-selector|upload_aimg_b\/web\/pc|upload_aimg\/pc\/|upload_aimg\/dawn\/|upload_aimg\/pho\/|\/web\/pc\/|\/nav\/|\/menu\/|\/icon\/|\/icons\/|\/badge\/|goods-icon\/|avatar|logo|sprite|placeholder|thumbnailoverlay|play-button|coupon|trustmark|cart\//i.test(url);
  }

  function prioritizeGalleryImages(urls) {
    const byKey = new Map();
    for (const url of urls) {
      const key = canonicalMediaKey(url);
      const current = byKey.get(key);
      if (!current || rankMediaUrl(url) > rankMediaUrl(current)) {
        byKey.set(key, url);
      }
    }
    return Array.from(byKey.values()).sort((a, b) => rankMediaUrl(b) - rankMediaUrl(a));
  }

  function rankMediaUrl(url) {
    let score = 0;
    if (/\/w\/800|\/w\/1300|[?&]w=800|[?&]w=1300/i.test(url)) score += 4;
    if (/\/w\/180|\/w\/50|[?&]w=180|[?&]w=50/i.test(url)) score += 1;
    if (/product\/fancy|product\/open/i.test(url)) score += 2;
    return score;
  }

  function canonicalMediaKey(url) {
    try {
      const parsed = new URL(url);
      return `${parsed.origin}${parsed.pathname}`.toLowerCase();
    } catch {
      return String(url || "").split("?")[0].toLowerCase();
    }
  }

  function pickText(node) {
    return trimText((node && (node.textContent || node.innerText) || "").replace(/\s+/g, " ").trim(), MAX_TEXT);
  }

  function nearbyText(node) {
    if (!(node instanceof Element)) return "";
    const parts = [pickText(node)];
    let current = node.parentElement;
    for (let i = 0; i < 2 && current; i += 1, current = current.parentElement) parts.push(pickText(current));
    return parts.filter(Boolean).join(" | ");
  }

  function trimText(text, limit) {
    return text && text.length > limit ? `${text.slice(0, limit - 1)}…` : (text || "");
  }

  function escapeHtml(text) {
    return String(text || "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char]));
  }

  function safeRead(reader) {
    try {
      return reader();
    } catch {
      return null;
    }
  }

  function summarizeError(error) {
    return { title: "", price: "", productId: "", mainImages: [], skuImages: [], detailImages: [], sizeImages: [], videoUrls: [], topKeys: [], pathHints: [trimText(String(error && error.message || error || "unknown error"), 160)] };
  }

  function rectSummary(rect) {
    return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
  }

  function elementPath(node) {
    const parts = [];
    let current = node;
    while (current && current.nodeType === 1 && parts.length < 5) {
      let part = current.tagName.toLowerCase();
      if (current.id) part += `#${current.id}`;
      const classes = Array.from(current.classList || []).slice(0, 2);
      if (classes.length) part += `.${classes.join(".")}`;
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(" > ");
  }

  function cssSelector(element) {
    if (!(element instanceof Element)) return "";
    if (element.id) return `#${cssEscape(element.id)}`;
    const parts = [];
    let current = element;
    while (current && current.nodeType === 1 && current !== document.body && parts.length < 5) {
      let part = current.tagName.toLowerCase();
      const classes = Array.from(current.classList || []).filter(Boolean).slice(0, 2);
      if (classes.length) part += `.${classes.map(cssEscape).join(".")}`;
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
      parts.unshift(part);
      current = parent;
    }
    return parts.join(" > ");
  }

  function cssEscape(value) {
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }
})();
