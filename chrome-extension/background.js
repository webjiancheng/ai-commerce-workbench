chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "FETCH_TEXT") {
    const url = String(message.url || "");
    if (!url) {
      sendResponse({ ok: false, error: "Missing url" });
      return;
    }

    fetch(url, {
      method: "GET",
      credentials: "include",
      headers: message.headers && typeof message.headers === "object" ? message.headers : undefined
    })
      .then((res) => res.text().then((text) => ({ ok: res.ok, status: res.status, text })))
      .then((payload) => sendResponse(payload.ok ? { ok: true, status: payload.status, text: payload.text } : { ok: false, status: payload.status, error: `HTTP ${payload.status}`, text: payload.text }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Fetch failed" }));

    return true;
  }

  if (message?.type === "CAPTURE_VISIBLE_TAB") {
    chrome.tabs.captureVisibleTab({ format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }

      sendResponse({ ok: true, dataUrl });
    });

    return true;
  }

  if (message?.type === "DOWNLOAD_IMAGES") {
    const urls = Array.isArray(message.urls) ? message.urls.filter(Boolean) : [];
    const folder = sanitizePath(message.folder || `产品采集同步/${Date.now()}`);

    urls.forEach((url, index) => {
      chrome.downloads.download({
        url,
        filename: `${folder}/${String(index + 1).padStart(2, "0")}-${filenameFromUrl(url)}`,
        saveAs: false
      });
    });

    sendResponse({ ok: true, count: urls.length });
  }
});

function filenameFromUrl(url) {
  try {
    const parsed = new URL(url);
    const name = decodeURIComponent(parsed.pathname.split("/").pop() || "");
    if (/\.(jpg|jpeg|png|webp|gif|avif|mp4|webm|mov|m3u8)$/i.test(name)) {
      return sanitizePath(name);
    }
  } catch {
    // ignore
  }
  return "asset.bin";
}

function sanitizePath(value) {
  return String(value || "image").replace(/[\\:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim();
}
