const COLLECT_MESSAGE = "COLLECT_PRODUCT";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === COLLECT_MESSAGE) {
    Promise.resolve()
      .then(() => collectProductAsync())
      .then((product) => sendResponse({ ok: true, product }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Collect failed" }));
    return true;
  }

  if (message?.type === "PSYNC_PREPARE_SHOT") {
    try {
      const root = document.getElementById("__product_sync_panel__");
      root?.classList?.add("is-hidden-for-shot");
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || "prepare shot failed" });
    }
    return true;
  }

  if (message?.type === "PSYNC_FINISH_SHOT") {
    try {
      const root = document.getElementById("__product_sync_panel__");
      root?.classList?.remove("is-hidden-for-shot");
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || "finish shot failed" });
    }
    return true;
  }
});

async function collectProductAsync() {
  const platform = detectPlatform();
  const structured = readStructuredProductData(platform);
  const title = normalizeTitle(readTitle(platform) || structured.title);
  const price = normalizePrice(readPrice(platform) || structured.price);
  const originalPrice = normalizePrice(readOriginalPrice()) || price;
  const url = location.href;
  const sourceId = extractSourceId(url);
  let mainImages = readMainImages(platform);
  let skuImages = readSkuImages(platform);
  let detailImages = readDetailImages(platform);

  if (!mainImages.length && structured.images.length) {
    mainImages = structured.images.slice();
  }

  if (platform === "1688") {
    const media = await collect1688MediaAsync({ offerId: sourceId });
    if (media.mainImages.length) mainImages = media.mainImages;
    if (media.skuImages.length) skuImages = media.skuImages;
    if (media.detailImages.length) detailImages = media.detailImages;
  }

  if (platform === "Temu") {
    const scriptHints = collectTemuScriptImageHints();
    mainImages = [...mainImages, ...scriptHints.mainImages];
    skuImages = [...skuImages, ...scriptHints.skuImages];
    detailImages = [...detailImages, ...scriptHints.detailImages];
    ({ mainImages, skuImages, detailImages } = refineTemuMedia({
      mainImages,
      skuImages,
      detailImages
    }));
  } else {
    mainImages = uniqueImages(mainImages);
    skuImages = excludeDuplicates(skuImages, mainImages);
    detailImages = excludeDuplicates(detailImages, [...mainImages, ...skuImages]);
  }

  const carouselImages = mainImages.slice();
  const videoUrl = readVideoUrl(platform);
  const categoryPath = readCategoryPath();
  const shopName = readShopName();
  const attributesText = readAttributesText();
  const skuText = readSkuText();
  const skuProps = readSkuProps(platform);
  const stock = readStockText();
  const currency = inferCurrency(platform, price);
  const platformSku = sourceId ? `${platformCode(platform)}-${sourceId}` : makeProductCode(url);
  const sizeChartImages = inferSizeChartImages(detailImages, [...mainImages, ...skuImages, ...detailImages]);

  if (!title) throw new Error("Current page title was not detected");
  if (!mainImages.length && !detailImages.length) {
    const fallback = collectFallbackImages({ platform });
    if (fallback.mainImages.length) mainImages = fallback.mainImages;
    if (fallback.detailImages.length) detailImages = fallback.detailImages;
  }
  const noImagesDetected = !mainImages.length && !detailImages.length;

  return {
    platform,
    url,
    title,
    price,
    originalPrice,
    currency,
    sourceId,
    platformSku,
    categoryPath,
    shopName,
    attributesText,
    skuText,
    skuProps,
    stock,
    mainImage: mainImages[0] || "",
    mainImages,
    carouselImages,
    skuImages,
    detailImages,
    sizeChartImages,
    videoUrl,
    screenshot: "",
    debug: {
      platform,
      sourceId,
      noImagesDetected,
      mainImageCount: mainImages.length,
      carouselImageCount: carouselImages.length,
      skuImageCount: skuImages.length,
      detailImageCount: detailImages.length
    }
  };
}

function inferSizeChartImages(detailImages, knownImages = []) {
  const urls = Array.isArray(detailImages) ? detailImages : [];
  const byUrl = urls.filter((url) => /size|chart|measurement|dimension|尺码|尺寸|goods_details|material-put/i.test(String(url || "")));

  const keywordNodes = Array.from(
    document.querySelectorAll("div,section,p,span,h2,h3,h4,li,strong,b")
  ).filter((node) => /size chart|size guide|measurement|dimension|尺码|尺寸|测量/i.test(clean(node.textContent || "")));

  const nearby = keywordNodes.flatMap((node) =>
    collectImagesFromElement(node.closest("section,div,article") || node)
  );

  return uniqueImages([...byUrl, ...nearby, ...knownImages.filter((url) => /尺码|尺寸|goods_details|material-put/i.test(String(url || "")))])
    .filter((url) => urls.includes(url) || nearby.includes(url))
    .slice(0, 12);
}

function collectTemuScriptImageHints() {
  const urls = extractImageUrlsFromScripts({ limit: 220 }).filter((url) => /kwcdn|temu/i.test(url));
  return {
    mainImages: urls.filter((url) => isTemuPrimaryGalleryImage(url)),
    skuImages: urls.filter((url) => isTemuSkuImage(url)),
    detailImages: urls.filter((url) => isTemuDetailImage(url))
  };
}

function collectFallbackImages({ platform }) {
  const urls = [];

  // common meta hints
  urls.push(
    normalizeImageAssetUrl(document.querySelector("meta[property='og:image']")?.getAttribute?.("content") || ""),
    normalizeImageAssetUrl(document.querySelector("meta[name='twitter:image']")?.getAttribute?.("content") || ""),
    normalizeImageAssetUrl(document.querySelector("link[rel='image_src']")?.getAttribute?.("href") || "")
  );

  // DOM scan: try a broader sweep (cheap + capped)
  urls.push(...collectImagesFromSelectors([
    "main",
    "[role='main']",
    "#__next",
    "#root",
    "body"
  ]));

  // Script scan: pick obvious image URLs (jpg/png/webp/avif)
  urls.push(...extractImageUrlsFromScripts({ limit: 80 }));

  const normalized = uniqueImages(urls.map(normalizeImageAssetUrl).filter(isUsefulImage));
  if (!normalized.length) return { mainImages: [], detailImages: [] };

  // If the platform has its own rules, keep it conservative and just treat as main gallery.
  const mainImages = normalized.slice(0, 20);
  const detailImages = normalized.slice(20, 120);
  return { mainImages, detailImages };
}

function extractImageUrlsFromScripts({ limit = 60 } = {}) {
  const results = [];
  const seen = new Set();
  const pattern = /https?:\/\/[^\s"']+\.(?:jpg|jpeg|png|webp|avif)(?:\?[^"'\s<]+)?/ig;

  for (const script of Array.from(document.scripts || [])) {
    const text = script.textContent || "";
    if (!text || text.length < 200) continue;
    const slice = text.length > 220000 ? text.slice(0, 220000) : text;
    let match;
    while ((match = pattern.exec(slice))) {
      const url = normalizeImageAssetUrl(match[0]);
      if (!isUsefulImage(url)) continue;
      const key = canonicalImageUrl(url);
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(url);
      if (results.length >= limit) return results;
    }
  }

  return results;
}

function detectPlatform() {
  const host = location.hostname.toLowerCase();
  if (host.includes("temu.com")) return "Temu";
  if (host.includes("amazon.")) return "Amazon";
  if (host.includes("1688.com")) return "1688";
  if (host.includes("taobao.com")) return "淘宝";
  if (host.includes("tmall.com")) return "天猫";
  if (host.includes("pinduoduo.com") || host.includes("yangkeduo.com")) return "拼多多";
  if (host.includes("shein.com")) return "SHEIN";
  return host.replace(/^www\./, "");
}

function readTitle(platform = detectPlatform()) {
  if (platform === "1688") {
    return textBySelectors([
      "h1.d-title",
      ".d-title",
      "span.d-title",
      ".title-text",
      ".offer-title",
      ".offer-main-title",
      "[class*='offerTitle']",
      "[class*='productTitle']",
      "[class*='title'] h1",
      "meta[property='og:title']"
    ]) || document.title;
  }

  if (platform === "Amazon") {
    return textBySelectors([
      "#productTitle",
      "#title span",
      "meta[property='og:title']",
      "h1",
      "title"
    ]) || document.title;
  }

  return textBySelectors([
    "h1[data-testid*='title']",
    "h1[class*='title']",
    "h1",
    "[data-testid='goods-title']",
    "meta[property='og:title']"
  ]) || document.title;
}

function readPrice(platform = detectPlatform()) {
  if (platform === "1688") {
    const fromDom = textBySelectors([
      ".price-now",
      ".priceMoney",
      ".price .price-text",
      ".od-pc-offer-price",
      ".od-pc-priceText",
      "[data-testid*='price']",
      "[data-price]",
      "[class*='price'][class*='value']",
      "[class*='priceDisplay']",
      "[class*='offerPrice']",
      "[class*='productPrice']"
    ]);
    if (fromDom) return fromDom;

    const meta = textBySelectors([
      "meta[property='product:price:amount']",
      "meta[property='og:price:amount']",
      "meta[itemprop='price']",
      "meta[name='price']"
    ]) || "";
    if (meta) return meta;

    // script fallback: try to find something like "price":"12.34"
    for (const script of Array.from(document.scripts || [])) {
      const text = script.textContent || "";
      if (!text || text.length < 200) continue;
      const slice = text.length > 160000 ? text.slice(0, 160000) : text;
      const match = slice.match(/\"(?:price|priceText|offerPrice)\"\s*:\s*\"?\s*(\d+(?:\.\d+)?)\s*\"?/i);
      if (match?.[1]) return match[1];
    }
    return "";
  }

  if (platform === "Amazon") {
    return textBySelectors([
      "#priceblock_ourprice",
      "#priceblock_dealprice",
      "#priceblock_saleprice",
      "#corePriceDisplay_desktop_feature_div .a-price .a-offscreen",
      "#apex_desktop .a-price .a-offscreen",
      ".a-price .a-offscreen",
      "[data-a-color='price']"
    ]);
  }

  if (platform === "Temu") {
    // 1) DOM 选择器：Temu 价格区域通常在 #rightContent 里
    const temuPrice = textBySelectors([
      "#rightContent [class*='price'] [class*='Price']",
      "#rightContent [class*='price'][class*='text']",
      "#rightContent [class*='Price'][class*='text']",
      "#rightContent [class*='salePrice']",
      "#rightContent [class*='sale-price']",
      "#rightContent [class*='currentPrice']",
      "#rightContent [data-testid*='price']",
      "[class*='price'][class*='Price']",
      "[class*='salePrice']",
      "[class*='sale-price']",
      "[class*='currentPrice']",
      "[data-testid*='price']"
    ]);
    if (temuPrice) return temuPrice;

    // 2) 直接在 rightContent 下查找包含 $ 或数字的价格元素
    const priceNodes = document.querySelectorAll(
      "#rightContent span, #rightContent div, #rightContent p"
    );
    for (const node of priceNodes) {
      // 只看叶子或短文本节点
      const text = (node.innerText || node.textContent || "").trim();
      if (!text || text.length > 30) continue;
      const priceMatch = text.match(/\$\s*(\d+(?:\.\d{1,2})?)/);
      if (priceMatch?.[1]) {
        // 排除运费/折扣等非主价格
        const parentText = (node.parentElement?.className || "").toLowerCase();
        if (/shipping|freight|delivery|coupon|discount|save/i.test(parentText)) continue;
        return priceMatch[0];
      }
    }

    // 3) JSON-LD / meta fallback
    const metaPrice = textBySelectors([
      "meta[property='product:price:amount']",
      "meta[property='og:price:amount']",
      "meta[itemprop='price']",
      "meta[name='price']"
    ]);
    if (metaPrice) return metaPrice;

    // 4) script 标签中提取价格
    for (const script of Array.from(document.scripts || [])) {
      const text = script.textContent || "";
      if (!text || text.length < 100) continue;
      const slice = text.length > 200000 ? text.slice(0, 200000) : text;

      // 匹配 "salePrice":1.23 或 "price":{"salePrice":"1.23"}
      const patterns = [
        /\"salePrice\"\s*:\s*\"?(\d+(?:\.\d+)?)\"?/i,
        /\"minSalePrice\"\s*:\s*\"?(\d+(?:\.\d+)?)\"?/i,
        /\"priceInfo\"\s*:.*?\"salePrice\"\s*:\s*\"?(\d+(?:\.\d+)?)\"?/i,
        /\"price\"\s*:\s*\"?(\d+(?:\.\d+)?)\"?/i,
        /\"displayPrice\"\s*:\s*\"?\$?(\d+(?:\.\d+)?)\"?/i
      ];

      for (const pattern of patterns) {
        const match = slice.match(pattern);
        if (match?.[1] && parseFloat(match[1]) > 0) return match[1];
      }
    }

    return "";
  }

  return textBySelectors([
    "[data-testid*='price']",
    "[class*='price'][class*='wrap']",
    "[class*='price']",
    "[data-price]"
  ]);
}

function readOriginalPrice() {
  if (detectPlatform() === "1688") {
    return textBySelectors([
      ".price-original",
      ".price-origin",
      ".reference-price",
      ".od-pc-priceOldText",
      ".od-pc-priceMarket",
      "[class*='origin'][class*='price']",
      "[class*='original'][class*='price']",
      "[class*='oldPrice']",
      "[class*='marketPrice']"
    ]);
  }

  return textBySelectors([
    "[class*='original'][class*='price']",
    "[class*='line-through']",
    "[class*='market'][class*='price']"
  ]);
}

function readCategoryPath() {
  if (detectPlatform() === "1688") {
    const crumbs = Array.from(document.querySelectorAll(
      ".crumb-wrap a, .breadcrumb a, .detail-breadcrumb a, nav .link, [class*='breadcrumb'] a, [class*='crumbs'] a"
    ))
      .map((node) => clean(node.textContent))
      .filter(Boolean);
    if (crumbs.length) return unique(crumbs).join("/");
  }

  const crumbs = Array.from(document.querySelectorAll("nav a, [class*='breadcrumb'] a, [class*='crumb'] a"))
    .map((node) => clean(node.textContent))
    .filter(Boolean);
  return unique(crumbs).join("/");
}

function readShopName() {
  if (detectPlatform() === "1688") {
    return textBySelectors([
      ".company-name",
      ".seller-company-name",
      ".seller-shop-name",
      ".seller-company",
      ".shop-name",
      ".store-name",
      "[data-company-name]",
      "[data-seller-name]",
      "[class*='companyName']",
      "[class*='sellerName']"
    ]);
  }

  return textBySelectors([
    "[data-testid*='store']",
    "[class*='shop'] [class*='name']",
    "[class*='seller'] [class*='name']"
  ]);
}

function readAttributesText() {
  if (detectPlatform() === "1688") {
    const sections = Array.from(document.querySelectorAll(
      ".offer-attr-list li, .detail-attr-list li, .attributes-list li, .offer-attr-item, .module-attributes li, table tr, [class*='attrItem'], [class*='propertyItem']"
    ))
      .map((node) => clean(node.textContent))
      .filter((value) => value && value.length >= 4 && value.length <= 180);
    if (sections.length) return unique(sections).slice(0, 50).join(" | ");
  }

  const sections = Array.from(document.querySelectorAll("li, tr, dl, [class*='attr'], [class*='param'], [class*='property']"))
    .map((node) => clean(node.textContent))
    .filter((value) => value && value.length >= 4 && value.length <= 180);
  return unique(sections).slice(0, 30).join(" | ");
}

function readSkuText() {
  if (detectPlatform() === "1688") {
    const groups = Array.from(document.querySelectorAll(
      ".sku-prop, .prop-item, .sku-item-wrapper, .sku-wrapper, .sku-selector, [class*='skuProp'], [class*='prop-item']"
    ))
      .filter(isVisible)
      .map((node) => clean(node.textContent))
      .filter((value) => value && value.length <= 500)
      .filter((value) => !isSkuNoiseText(value));
    if (groups.length) return unique(groups).slice(0, 10).join(" | ");
  }

  const temuSkuRoot = document.querySelector("#rightContent ._2nVeyNCz, ._2nVeyNCz");
  if (temuSkuRoot) {
    const text = clean(
      document.querySelector("#rightContent ._2nVeyNCz ._1thUmrmy, ._2nVeyNCz ._1thUmrmy")?.textContent ||
      document.querySelector("#rightContent ._2nVeyNCz ._2QQEVpBZ._3a0ITqR8, ._2nVeyNCz ._2QQEVpBZ._3a0ITqR8")?.textContent ||
      temuSkuRoot.textContent
    );
    if (text) return text;
  }

  const groups = Array.from(document.querySelectorAll(
    "#rightContent ._2nVeyNCz, ._2nVeyNCz, #rightContent ._3csHYvw1, ._3csHYvw1, [class*='sku'], [class*='Sku'], [class*='spec'], [class*='Spec'], [class*='variant'], [class*='Variant']"
  ))
    .filter(isVisible)
    .map((node) => clean(node.textContent))
    .filter((value) => value && value.length <= 400)
    .filter((value) => !isSkuNoiseText(value));
  return unique(groups).slice(0, 8).join(" | ");
}

const SKU_NOISE_PATTERN = /shipping|delivery|refund|return|service|coupon|discount|promo|promotion|voucher|deal|sale|save|free|活动|促销|优惠|折扣|券|满减|立减|省|包邮|保障|服务|物流|运费|退货|客服|发货|配送|支付|付款|广告|推荐|榜单|销量|已售|评价|评论|关注|分享|收藏|店铺|直播|秒杀|限时/i;
const SKU_AXIS_PATTERN = /颜色|色系|色号|尺寸|尺码|规格|款式|样式|型号|容量|口味|数量|组合|套餐|材质|Color|Colour|Size|Style|Type|Model|Capacity|Pack|Material|Flavor/i;
const SKU_VALUE_BAD_PATTERN = /¥|￥|\$|€|£|%|折|券|满|减|省|起|到手|立省|下单|包邮|已售|销量|评价|评论|收藏|关注|分享|客服|服务|物流|发货|配送/i;

function isSkuNoiseText(value) {
  const text = clean(value || "");
  if (!text) return true;
  if (SKU_NOISE_PATTERN.test(text)) return true;
  if (text.length > 80 && !/颜色|尺寸|尺码|规格|款式|型号|容量|Color|Size|Style|Model|Capacity/i.test(text)) return true;
  return false;
}

function isLikelySkuAxisLabel(value) {
  const text = clean(value || "");
  if (!text || isSkuNoiseText(text)) return false;
  if (text.length > 18) return false;
  return SKU_AXIS_PATTERN.test(text);
}

function isLikelySkuOptionText(value) {
  const text = clean(value || "");
  if (!text || isSkuNoiseText(text)) return false;
  if (SKU_VALUE_BAD_PATTERN.test(text)) return false;
  if (text.length > 40) return false;
  return true;
}

function readSkuProps(platform = detectPlatform()) {
  const roots = getSkuPropRoots(platform);
  const items = [];

  roots.forEach((root, groupIndex) => {
    const groupName = inferSkuGroupName(root, groupIndex);
    const optionNodes = getSkuOptionNodes(root);

    optionNodes.forEach((node, optionIndex) => {
      const imageUrl = getSkuOptionImageUrl(node);
      const optionName = inferSkuOptionName(node, groupName, optionIndex);
      const hintText = inferSkuOptionHint(node, optionName);
      if (!isLikelySkuAxisLabel(groupName) || !isLikelySkuOptionText(optionName) || isSkuNoiseText(hintText || optionName)) return;
      if (!imageUrl && !optionName) return;
      items.push({
        groupName,
        optionName,
        imageUrl,
        hintText,
        groupIndex,
        optionIndex,
        selected: isSkuOptionSelected(node)
      });
    });
  });

  return dedupeSkuProps(items);
}

function getSkuPropRoots(platform = detectPlatform()) {
  const selectors = platform === "1688"
    ? [
        ".sku-prop",
        ".prop-item",
        ".sku-item-wrapper",
        ".sku-wrapper",
        ".sku-selector",
        ".obj-sku",
        "[class*='skuProp']",
        "[class*='prop-item']"
      ]
    : platform === "Temu"
      ? [
          "#rightContent ._2nVeyNCz",
          "._2nVeyNCz",
          "#rightContent ._3csHYvw1",
          "._3csHYvw1",
          "[class*='sku']",
          "[class*='Sku']",
          "[class*='spec']",
          "[class*='variant']"
        ]
      : [
          "[class*='sku']",
          "[class*='Sku']",
          "[class*='spec']",
          "[class*='Spec']",
          "[class*='variant']",
          "[class*='Variant']"
        ];

  const roots = [];
  const seen = new Set();
  for (const selector of selectors) {
    for (const node of Array.from(document.querySelectorAll(selector))) {
      if (!(node instanceof HTMLElement) || !isVisible(node)) continue;
      if (!isLikelySkuPropRoot(node)) continue;
      const key = node;
      if (seen.has(key)) continue;
      seen.add(key);
      roots.push(node);
      if (roots.length >= 8) return roots;
    }
  }
  return roots;
}

function isLikelySkuPropRoot(root) {
  const text = clean(root.textContent || "");
  if (!text || isSkuNoiseText(text)) return false;
  if (text.length > 900) return false;
  const hasImages = Boolean(root.querySelector("img"));
  const hasAxisLabel = SKU_AXIS_PATTERN.test(text);
  const optionLikeCount = Array.from(root.querySelectorAll("button,li,label,[role='button'],[class*='item'],[class*='Item']"))
    .filter((node) => node instanceof HTMLElement)
    .filter(isVisible)
    .map((node) => clean(node.textContent || node.getAttribute?.("aria-label") || node.getAttribute?.("title") || ""))
    .filter(isLikelySkuOptionText)
    .length;
  return hasAxisLabel || (hasImages && optionLikeCount > 0);
}

function getSkuOptionNodes(root) {
  const selectors = [
    "button",
    "li",
    "label",
    "[role='button']",
    "[class*='sku-item']",
    "[class*='skuItem']",
    "[class*='prop-item']",
    "[class*='propItem']",
    "[class*='value-item']",
    "[class*='valueItem']",
    "[class*='option-item']",
    "[class*='optionItem']",
    "[class*='variant-item']",
    "[class*='variantItem']"
  ];
  const nodes = Array.from(root.querySelectorAll(selectors.join(",")))
    .filter((node) => node instanceof HTMLElement)
    .filter(isVisible)
    .filter((node) => {
      const text = clean(node.textContent || "");
      const hasImage = Boolean(node.querySelector("img"));
      const nestedCount = node.querySelectorAll(selectors.join(",")).length;
      if (nestedCount >= 4) return false;
      if (!hasImage && !text) return false;
      if (text && !isLikelySkuOptionText(text)) return false;
      return true;
    });

  if (nodes.length) return nodes;

  return Array.from(root.querySelectorAll("img"))
    .map((img) => img.closest("button,li,label,div,span") || img)
    .filter(Boolean)
    .filter((node, index, list) => list.indexOf(node) === index);
}

function inferSkuGroupName(root, groupIndex) {
  const attrCandidates = [
    root.getAttribute?.("data-title"),
    root.getAttribute?.("aria-label"),
    root.getAttribute?.("data-testid"),
    root.previousElementSibling?.textContent
  ];
  for (const raw of attrCandidates) {
    const label = normalizeSkuGroupLabel(raw);
    if (label) return label;
  }

  const labelNodes = Array.from(root.querySelectorAll("legend,dt,strong,h2,h3,h4,label,span,p,div"));
  for (const node of labelNodes) {
    const text = normalizeSkuGroupLabel(node.textContent);
    if (text) return text;
  }

  return `规格${groupIndex + 1}`;
}

function normalizeSkuGroupLabel(value) {
  const text = clean(value || "");
  if (!text) return "";
  const prefix = text.includes(":") || text.includes("：") ? text.split(/[:：]/)[0] : text;
  const normalized = clean(prefix).replace(/^select\s+/i, "");
  if (!isLikelySkuAxisLabel(normalized)) return "";
  if (/^(please|choose|select)\b/i.test(normalized)) return "";
  return normalized;
}

function inferSkuOptionName(node, groupName, optionIndex) {
  const attrCandidates = [
    node.getAttribute?.("aria-label"),
    node.getAttribute?.("title"),
    node.getAttribute?.("data-title"),
    node.getAttribute?.("data-name"),
    node.getAttribute?.("data-value")
  ];
  for (const raw of attrCandidates) {
    const normalized = normalizeSkuOptionLabel(raw, groupName);
    if (normalized) return normalized;
  }

  const img = node.querySelector("img");
  const imageLabel = normalizeSkuOptionLabel(img?.getAttribute?.("alt") || img?.getAttribute?.("title") || "", groupName);
  if (imageLabel) return imageLabel;

  const text = normalizeSkuOptionLabel(node.textContent, groupName);
  if (text) return text;

  return `选项${optionIndex + 1}`;
}

function normalizeSkuOptionLabel(value, groupName = "") {
  const group = clean(groupName || "");
  let text = clean(value || "");
  if (!text) return "";
  if (group) {
    const escaped = group.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = clean(text.replace(new RegExp(`^${escaped}\\s*[:：-]?\\s*`, "i"), ""));
  }
  text = clean(text.replace(/\b(selected|unavailable|sold out)\b/ig, ""));
  if (!isLikelySkuOptionText(text)) return "";
  return text;
}

function inferSkuOptionHint(node, optionName) {
  const text = clean(node.textContent || "");
  if (!text || text === optionName || text.length > 120) return "";
  if (isSkuNoiseText(text)) return "";
  return text;
}

function getSkuOptionImageUrl(node) {
  const img = node.querySelector("img");
  if (!img) return "";
  return normalizeImageAssetUrl(
    img.getAttribute("src") ||
    img.getAttribute("data-src") ||
    img.getAttribute("data-lazy-src") ||
    img.currentSrc ||
    img.src ||
    ""
  );
}

function isSkuOptionSelected(node) {
  const className = String(node.className || "");
  return (
    node.getAttribute?.("aria-pressed") === "true" ||
    node.getAttribute?.("aria-selected") === "true" ||
    /\b(active|selected|current|checked)\b/i.test(className)
  );
}

function dedupeSkuProps(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const groupName = clean(item?.groupName || "");
    const optionName = clean(item?.optionName || "");
    const imageUrl = clean(item?.imageUrl || "");
    const hintText = clean(item?.hintText || "");
    if (!groupName && !optionName && !imageUrl) continue;
    if (!isLikelySkuAxisLabel(groupName) || !isLikelySkuOptionText(optionName || hintText)) continue;
    const key = `${groupName}__${optionName}__${imageUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      groupName: groupName || "规格",
      optionName,
      imageUrl: imageUrl || null,
      hintText: hintText || null,
      groupIndex: Number.isFinite(item?.groupIndex) ? Number(item.groupIndex) : 0,
      optionIndex: Number.isFinite(item?.optionIndex) ? Number(item.optionIndex) : 0,
      selected: Boolean(item?.selected)
    });
  }
  return out;
}

function readStockText() {
  const platform = detectPlatform();

  if (platform === "1688") {
    const text = textBySelectors([
      ".quantity-limit",
      ".inventory-text",
      ".stock-text",
      "[class*='stock']",
      "[class*='inventory']"
    ]);
    return normalizeStockText(text);
  }

  if (platform === "Amazon") {
    const text = textBySelectors([
      "#availability span",
      "#availability",
      "[data-availability-message]"
    ]);
    return normalizeStockText(text);
  }

  const text = textBySelectors([
    "[class*='stock']",
    "[class*='inventory']",
    "[data-testid*='stock']"
  ]);
  return normalizeStockText(text);
}

function readMainImages(platform) {
  if (platform === "Temu") {
    const strictMain = collectImagesFromSelectors([
      "#leftContent ._1CQ4cRYC",
      "#leftContent ._2AKu-30-",
      "#leftContent ._2AOclWz7",
      "#leftContent"
    ]).filter((url) => isTemuPrimaryGalleryImage(url));
    const broadMain = collectImagesFromSelectors([
      "#leftContent",
      "[id='leftContent']",
      "[class*='swiper']",
      "[class*='gallery']",
      "[class*='thumb']",
      "[data-testid*='gallery']",
      "[data-testid*='thumb']"
    ]).filter((url) => isTemuPrimaryGalleryImage(url));
    const scriptMain = collectTemuScriptImageHints().mainImages;
    return uniqueImages([...strictMain, ...broadMain, ...scriptMain]);
  }

  if (platform === "1688") {
    return collect1688MainImages();
  }

  if (platform === "Amazon") {
    const urls = [
      ...collectAmazonLandingImages(),
      ...collectImagesFromSelectors(["#altImages", "#imageBlock", "#imgTagWrapperId"])
    ];
    return uniqueImages(urls);
  }

  if (platform === "SHEIN") {
    const structured = readStructuredProductData(platform);
    if (structured.images.length) return uniqueImages(structured.images);
    return collectImagesFromSelectors([
      "[class*='product-intro']",
      "[class*='productIntro']",
      "[class*='gallery']",
      "[class*='swiper']",
      "[class*='thumb']"
    ]);
  }

  const selectors = platform === "Temu"
    ? [
        "#leftContent",
        "[id='leftContent']",
        "[class*='swiper']",
        "[class*='gallery']",
        "[class*='thumb']"
      ]
    : platform === "1688"
      ? [
          ".vertical-img",
          ".nav-image-list",
          ".detail-gallery",
          ".swipe-pane",
          ".image-viewer-wrap",
          ".tab-trigger",
          "[class*='gallery']",
          "[class*='thumb']"
        ]
      : ["[class*='gallery']", "[class*='swiper']", "[class*='thumb']"];
  return collectImagesFromSelectors(selectors);
}

function readSkuImages(platform) {
  if (platform === "1688") {
    return collect1688SkuImages();
  }

  if (platform === "Amazon") {
    const urls = collectImagesFromSelectors([
      "#twister",
      "#variation_color_name",
      "#variation_style_name",
      "#variation_size_name",
      "[id*='variation_']"
    ]);
    return uniqueImages(urls);
  }

  if (platform === "SHEIN") {
    const urls = collectImagesFromSelectors([
      "[class*='sku']",
      "[class*='Sku']",
      "[class*='spec']",
      "[class*='variant']",
      "[class*='product-intro']"
    ]);
    return uniqueImages(urls);
  }

  if (platform === "Temu") {
    const skuRoots = Array.from(document.querySelectorAll(
      "#rightContent ._2nVeyNCz ._3csHYvw1._2Z6iM40Q, " +
      "#rightContent ._2nVeyNCz ._3csHYvw1, " +
      "#rightContent ._2nVeyNCz [style*='background-image'], " +
      "#rightContent ._2nVeyNCz img, " +
      "._2nVeyNCz ._3csHYvw1._2Z6iM40Q, " +
      "._2nVeyNCz ._3csHYvw1, " +
      "._2nVeyNCz [style*='background-image'], " +
      "._2nVeyNCz img"
    ));
    const rootUrls = skuRoots.length ? skuRoots.flatMap((root) => collectImagesFromElement(root)) : [];
    const broadUrls = collectImagesFromSelectors([
      "#rightContent ._2nVeyNCz",
      "._2nVeyNCz",
      "#rightContent ._3csHYvw1",
      "._3csHYvw1",
      "[class*='sku']",
      "[class*='Sku']",
      "[class*='spec']",
      "[class*='Spec']",
      "[class*='variant']"
    ]);
    const scriptUrls = collectTemuScriptImageHints().skuImages;
    return uniqueImages([...rootUrls, ...broadUrls, ...scriptUrls]).filter((url) => isTemuSkuImage(url));
  }

  const selectors = platform === "Temu"
    ? [
        "#rightContent ._2nVeyNCz",
        "._2nVeyNCz",
        "#rightContent ._3csHYvw1",
        "._3csHYvw1",
        "[class*='sku']",
        "[class*='Sku']",
        "[class*='spec']",
        "[class*='Spec']",
        "[class*='variant']"
      ]
    : platform === "1688"
      ? [
          ".sku-prop img",
          ".prop-item img",
          ".sku-item-wrapper img",
          ".sku-wrapper img",
          "[class*='skuProp'] img",
          "[class*='prop-item'] img",
          "[class*='sku'] img"
        ]
    : ["[class*='sku']", "[class*='Sku']", "[class*='spec']", "[class*='variant']"];
  return collectImagesFromSelectors(selectors);
}

function readDetailImages(platform) {
  if (platform === "Temu") {
    const strictDetail = collectImagesFromSelectors([
      "#goodsDetail .LqemymRS._23UQG0mN",
      "#goodsDetail .LqemymRS._3NKWJjn8",
      "#goodsDetail ._2jCYETGt",
      "#goodsDetail"
    ]);
    const broadDetail = collectImagesFromSelectors([
      "#goodsDetail",
      "[id='goodsDetail']",
      "[class*='detail']",
      "[class*='description']",
      "[data-testid*='detail']",
      "[data-testid*='description']"
    ]);
    const scriptDetail = collectTemuScriptImageHints().detailImages;
    return uniqueImages([...strictDetail, ...broadDetail, ...scriptDetail]).filter((url) => isTemuDetailImage(url));
  }

  if (platform === "1688") {
    return collect1688DetailImages();
  }

  if (platform === "Amazon") {
    const urls = collectImagesFromSelectors([
      "#aplus",
      "#productDescription",
      "#feature-bullets",
      "#importantInformation",
      "#prodDetails",
      "#dp-container"
    ]);
    return uniqueImages(urls);
  }

  if (platform === "SHEIN") {
    const urls = collectImagesFromSelectors([
      "[class*='detail']",
      "[class*='description']",
      "[class*='goods-detail']",
      "[class*='product-detail']"
    ]);
    return uniqueImages(urls);
  }

  const selectors = platform === "Temu"
    ? [
        "#goodsDetail",
        "[id='goodsDetail']",
        "[class*='detail']",
        "[class*='description']"
      ]
    : platform === "1688"
      ? [
          ".detail-content",
          ".desc-lazyload-container",
          ".offer-detail-description",
          "#mod-detail-description",
          ".detail-img-list",
          "[class*='detail-description']",
          "[class*='descV8']"
        ]
    : ["[class*='detail']", "[class*='description']"];
  return collectImagesFromSelectors(selectors);
}

function readVideoUrl(platform) {
  const video = document.querySelector("video source[src], video[src]");
  const directUrl = normalizeUrl(video?.src || video?.getAttribute("src") || "");
  if (directUrl) return directUrl;

  if (platform === "Temu") {
    const node = document.querySelector(
      "#goodsDetail video source[src], " +
      "#goodsDetail video[src], " +
      "#goodsDetail source[src], " +
      "#goodsDetail [data-video-url], " +
      "#goodsDetail [data-video-src], " +
      "#goodsDetail [class*='video'] video[src], " +
      "#goodsDetail [class*='video'] source[src], " +
      "[data-video-url], [data-video-src], [class*='video']"
    );
    const url = normalizeUrl(
      node?.getAttribute?.("data-video-url") ||
      node?.getAttribute?.("data-video-src") ||
      node?.getAttribute?.("src") ||
      node?.src ||
      ""
    );
    if (url) return url;

    const scriptUrl = findVideoUrlInScripts();
    if (scriptUrl) return scriptUrl;

    return "";
  }

  if (platform === "1688") {
    const node = document.querySelector("[data-video-url], .video-player source[src], .video-player video[src], [class*='video'] source[src], [class*='video'] video[src]");
    const url = normalizeUrl(
      node?.getAttribute?.("data-video-url") ||
      node?.getAttribute?.("src") ||
      node?.src ||
      ""
    );
    if (url) return url;

    const scriptUrl = findVideoUrlInScripts({ preferredHostPattern: /cloud\.video\.taobao\.com|alicdn|1688/i });
    if (scriptUrl) return scriptUrl;
    return "";
  }

  return findVideoUrlInScripts();
}

function findVideoUrlInScripts(options = {}) {
  const preferredHostPattern = options.preferredHostPattern instanceof RegExp ? options.preferredHostPattern : /kwcdn|temu/i;
  const candidates = [];
  const pattern = /https?:\/\/[^\s"']+\.(?:mp4|m3u8)(?:\?[^"']*)?/ig;

  for (const script of Array.from(document.scripts || [])) {
    const text = script.textContent || "";
    if (!text || text.length < 50) continue;
    // 避免超大脚本造成卡顿
    const slice = text.length > 180000 ? text.slice(0, 180000) : text;
    let match;
    while ((match = pattern.exec(slice))) {
      const url = normalizeUrl(match[0]);
      if (!url) continue;
      candidates.push(url);
      if (candidates.length >= 8) break;
    }
    if (candidates.length >= 8) break;
  }

  const preferred = candidates.find((url) => preferredHostPattern.test(url));
  return preferred || candidates[0] || "";
}

function readStructuredProductData(platform) {
  const product = readJsonLdProduct() || {};
  const title = clean(product.name);
  const images = uniqueImages(normalizeToArray(product.image).map(normalizeImageAssetUrl).filter(Boolean));
  const { price, currency } = readJsonLdPrice(product);

  if (platform === "Amazon" && (!images.length || !title || !price)) {
    const amazon = readAmazonStructuredData();
    return {
      title: title || amazon.title,
      images: images.length ? images : amazon.images,
      price: price || amazon.price,
      currency: currency || amazon.currency
    };
  }

  return { title, images, price, currency };
}

function readJsonLdProduct() {
  const scripts = Array.from(document.querySelectorAll("script[type='application/ld+json']"));
  for (const script of scripts) {
    const text = clean(script.textContent);
    if (!text) continue;
    const json = safeJsonParse(text);
    const nodes = normalizeToArray(json);
    for (const node of nodes) {
      const product = findProductNode(node);
      if (product) return product;
    }
  }
  return null;
}

function findProductNode(node) {
  if (!node || typeof node !== "object") return null;
  if (String(node["@type"] || "").toLowerCase() === "product") return node;
  if (node["@graph"] && Array.isArray(node["@graph"])) {
    for (const child of node["@graph"]) {
      const found = findProductNode(child);
      if (found) return found;
    }
  }
  return null;
}

function readJsonLdPrice(product) {
  const offers = product?.offers;
  const list = normalizeToArray(offers);
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const price = clean(item.price || item.lowPrice || item.highPrice);
    const currency = clean(item.priceCurrency);
    if (price) return { price, currency };
  }
  return { price: "", currency: "" };
}

function readAmazonStructuredData() {
  const title = clean(textBySelectors(["#productTitle", "#title span", "meta[property='og:title']", "title"]));
  const images = uniqueImages(collectAmazonLandingImages());
  const price = clean(readPrice("Amazon"));
  return { title, images, price, currency: "" };
}

function collectAmazonLandingImages() {
  const urls = [];

  const landing = document.querySelector("#landingImage, #imgBlkFront, img[data-a-dynamic-image]");
  const dynamic = landing?.getAttribute?.("data-a-dynamic-image") || "";
  const parsed = safeJsonParse(dynamic);
  if (parsed && typeof parsed === "object") {
    for (const key of Object.keys(parsed)) {
      if (typeof key === "string" && /^https?:\/\//.test(key)) urls.push(key);
    }
  }

  for (const script of Array.from(document.querySelectorAll("script[data-a-state]"))) {
    const state = clean(script.getAttribute("data-a-state"));
    if (!state) continue;
    if (!/image|landing|colorImages/i.test(state)) continue;
    const json = safeJsonParse(clean(script.textContent));
    const fromState = extractAmazonImagesFromState(json);
    urls.push(...fromState);
  }

  return uniqueImages(urls.map(normalizeImageAssetUrl).filter(Boolean));
}

function extractAmazonImagesFromState(state) {
  const urls = [];
  const payload = state?.desktop?.landingImageData || state?.landingImageData || state?.data || state;
  const colorImages = payload?.colorImages || payload?.color_images || payload?.colorImage || null;
  const initial = colorImages?.initial || colorImages?.INITIAL || colorImages;
  const list = Array.isArray(initial) ? initial : [];
  for (const item of list) {
    const candidate = clean(item?.hiRes || item?.large || item?.main || item?.variant || "");
    if (candidate) urls.push(candidate);
  }
  return urls;
}

function normalizeToArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function safeJsonParse(text) {
  try {
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function collectImagesFromSelectors(selectors) {
  const containers = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
  const urls = [];

  for (const container of containers) {
    urls.push(...collectImagesFromElement(container));
  }

  if (!urls.length) {
    urls.push(...Array.from(document.images).flatMap((img) => imageUrlsFromNode(img)));
  }

  return uniqueImages(urls);
}


async function collect1688MediaAsync({ offerId }) {
  const fallback = () => ({
    mainImages: collect1688MainImages(),
    skuImages: collect1688SkuImages(),
    detailImages: collect1688DetailImages()
  });

  if (!offerId) return fallback();

  try {
    const widget = await fetch1688WidgetOfferDetail(offerId);
    if (!widget) return fallback();

    const rawMain = uniqueImages(extract1688OfferImages(widget).filter(is1688ProductImage));
    const rawSku = uniqueImages(extract1688SkuImages(widget).filter(is1688ProductImage));

    let detailImages = uniqueImages(extract1688DescImages(widget).filter(is1688DetailImage));
    if (!detailImages.length) {
      const descUrl = extract1688DescUrl(widget);
      if (descUrl) {
        const html = await fetchTextViaBackground(descUrl);
        detailImages = uniqueImages(extract1688DetailImagesFromHtml(html).filter(is1688DetailImage));
      }
    }

    const cleanedMain = rawMain.length ? excludeDuplicates(rawMain, [...rawSku, ...detailImages]) : [];
    const normalizedMain = cleanedMain.length ? cleanedMain : collect1688MainImages();
    const normalizedSku = rawSku.length ? excludeDuplicates(rawSku, normalizedMain) : collect1688SkuImages();
    const normalizedDetail = detailImages.length
      ? excludeDuplicates(detailImages, [...normalizedMain, ...normalizedSku])
      : collect1688DetailImages();

    return {
      mainImages: uniqueImages(normalizedMain),
      skuImages: uniqueImages(normalizedSku),
      detailImages: uniqueImages(normalizedDetail)
    };
  } catch {
    return fallback();
  }
}

async function fetch1688WidgetOfferDetail(offerId) {
  const urls = [
    `https://laputa.1688.com/offer/ajax/WidgetOfferDetail.do?offerId=${encodeURIComponent(offerId)}`,
    `https://detail.1688.com/offer/ajax/WidgetOfferDetail.do?offerId=${encodeURIComponent(offerId)}`,
    `https://m.1688.com/offer/${encodeURIComponent(offerId)}.html`
  ];

  for (const url of urls) {
    try {
      const text = await fetchTextViaBackground(url, {
        "Accept": "application/json,text/plain,*/*",
        "X-Requested-With": "XMLHttpRequest"
      });
      const data = parsePossiblyJsonp(text);
      if (!data) continue;
      if (typeof data === "object") return data;
    } catch {
      // try next
    }
  }

  return null;
}

function fetchTextViaBackground(url, headers) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "FETCH_TEXT", url, headers }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.ok || typeof response.text !== "string") {
        reject(new Error(response?.error || "Fetch failed"));
        return;
      }
      resolve(response.text);
    });
  });
}

function parsePossiblyJsonp(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const direct = safeJsonParse(raw);
  if (direct) return direct;

  // JSONP: callback({...});
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return safeJsonParse(raw.slice(start, end + 1));
  }
  return null;
}

function deepCollectUrls(value, limit = 200) {
  const urls = [];
  const seen = new Set();

  const walk = (node) => {
    if (urls.length >= limit) return;
    if (!node) return;

    if (typeof node === "string") {
      const normalized = normalizeUrl(node);
      if (normalized && /^https?:\/\//i.test(normalized) && !seen.has(normalized)) {
        seen.add(normalized);
        urls.push(normalized);
      }
      return;
    }

    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }

    if (typeof node === "object") {
      for (const key of Object.keys(node)) {
        walk(node[key]);
        if (urls.length >= limit) return;
      }
    }
  };

  walk(value);
  return urls;
}

function findFirstObjectWithKeys(root, keys) {
  const wanted = keys.filter(Boolean);
  const queue = [root];
  const visited = new Set();

  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof node !== "object") continue;
    if (visited.has(node)) continue;
    visited.add(node);

    const hasAll = wanted.every((key) => Object.prototype.hasOwnProperty.call(node, key));
    if (hasAll) return node;

    if (Array.isArray(node)) {
      node.forEach((item) => queue.push(item));
      continue;
    }

    for (const value of Object.values(node)) queue.push(value);
  }

  return null;
}

function extract1688OfferImages(widget) {
  // 常见路径：widget.data.offerImgList / offerImgList / data.globalData.offerImgList
  const candidate = findFirstObjectWithKeys(widget, ["offerImgList"]) || widget?.data || widget;
  const list = normalizeToArray(candidate?.offerImgList || widget?.offerImgList || widget?.data?.offerImgList);
  const urls = [];

  for (const item of list) {
    if (!item) continue;
    if (typeof item === "string") {
      urls.push(item);
      continue;
    }
    urls.push(item?.imgUrl, item?.imageUrl, item?.bigUrl, item?.originalImageUrl, item?.originUrl);
  }

  if (urls.filter(Boolean).length) return urls.map(normalizeUrl).filter(Boolean);

  // 兜底：从 widget 中广度收集，但尽量只保留商品图域名，减少 SKU/详情混入
  return deepCollectUrls(widget, 120).filter(is1688ProductImage);
}

function extract1688SkuImages(widget) {
  const urls = [];

  // skuInfoMap / skuMap 内通常包含每个组合的 imageUrl/bigPicUrl
  const skuMapHolder =
    findFirstObjectWithKeys(widget, ["skuInfoMap"]) ||
    findFirstObjectWithKeys(widget, ["skuMap"]) ||
    null;

  const skuInfoMap = skuMapHolder?.skuInfoMap || skuMapHolder?.skuMap || widget?.data?.skuInfoMap || widget?.data?.skuMap || null;
  if (skuInfoMap && typeof skuInfoMap === "object") {
    for (const value of Object.values(skuInfoMap)) {
      if (!value) continue;
      urls.push(value?.imageUrl, value?.bigPicUrl, value?.bigPicUrlOriginal, value?.imageUrlOriginal);
    }
  }

  // skuProps 维度值也可能自带图片
  const skuPropsHolder = findFirstObjectWithKeys(widget, ["skuProps"]) || null;
  const skuProps = skuPropsHolder?.skuProps || widget?.data?.skuProps || null;
  if (Array.isArray(skuProps)) {
    for (const prop of skuProps) {
      const values = normalizeToArray(prop?.value || prop?.values || prop?.skuPropValueList);
      for (const item of values) {
        if (!item) continue;
        urls.push(item?.imageUrl, item?.bigPicUrl, item?.imgUrl, item?.image);
      }
    }
  }

  return uniqueImages(urls.map(normalizeUrl).filter(Boolean));
}

function extract1688DescImages(widget) {
  const urls = [];
  const holder =
    findFirstObjectWithKeys(widget, ["descImages"]) ||
    findFirstObjectWithKeys(widget, ["descImageList"]) ||
    null;

  const list =
    holder?.descImages ||
    holder?.descImageList ||
    widget?.data?.descImages ||
    widget?.data?.descImageList ||
    null;

  if (Array.isArray(list)) {
    list.forEach((item) => {
      if (typeof item === "string") urls.push(item);
      else urls.push(item?.url, item?.imgUrl, item?.imageUrl);
    });
  }

  // 有些页面会把详情 HTML 放在字段里
  const descHtml = widget?.data?.desc || widget?.data?.detailDesc || widget?.data?.detailHtml || "";
  if (descHtml && typeof descHtml === "string") {
    urls.push(...extract1688DetailImagesFromHtml(descHtml));
  }

  return uniqueImages(urls.map(normalizeUrl).filter(Boolean));
}

function extract1688DescUrl(widget) {
  const holder =
    findFirstObjectWithKeys(widget, ["descUrl"]) ||
    findFirstObjectWithKeys(widget, ["detailUrl"]) ||
    null;
  const raw = holder?.descUrl || holder?.detailUrl || widget?.data?.descUrl || widget?.data?.detailUrl || "";
  const normalized = normalizeUrl(raw);
  return normalized && /^https?:\/\//i.test(normalized) ? normalized : "";
}

function extract1688DetailImagesFromHtml(html) {
  const text = String(html || "");
  const urls = [
    ...(text.match(/https?:\/\/cbu01\.alicdn\.com\/img\/ibank[^"'\s<]+/gi) || []),
    ...(text.match(/https?:\/\/(?:gw|img)\.alicdn\.com\/imgextra[^"'\s<]+\.(?:jpg|jpeg|png|webp)(?:\?[^"'\s<]+)?/gi) || [])
  ];
  return uniqueImages(urls.map(normalizeUrl).filter(Boolean));
}


function collectImagesFromElement(root) {
  if (!root) return [];
  const urls = [];

  if (root.matches?.("img")) {
    urls.push(...imageUrlsFromNode(root));
  }

  urls.push(...backgroundImageUrls(root));

  for (const node of root.querySelectorAll(
    "img, source[srcset], source[data-srcset], [style*='background-image'], [data-src], [data-image], [data-bg], [data-lazy-src], [data-original-src]"
  )) {
    urls.push(...imageUrlsFromNode(node));
    urls.push(...backgroundImageUrls(node));
  }

  return urls;
}

function imageUrlsFromNode(node) {
  return [
    node.currentSrc,
    node.src,
    node.getAttribute?.("src"),
    node.getAttribute?.("data-src"),
    node.getAttribute?.("data-lazy-src"),
    node.getAttribute?.("data-original-src"),
    node.getAttribute?.("data-original"),
    node.getAttribute?.("data-image"),
    node.getAttribute?.("data-bg"),
    bestSrcsetUrl(node.getAttribute?.("srcset")),
    bestSrcsetUrl(node.getAttribute?.("data-srcset"))
  ]
    .map(normalizeImageAssetUrl)
    .filter(isUsefulImage);
}

function backgroundImageUrls(node) {
  const values = [
    node.style?.backgroundImage,
    node.getAttribute?.("style")
  ].filter(Boolean);

  return values
    .flatMap((value) => [...String(value).matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((match) => match[1]))
    .map(normalizeImageAssetUrl)
    .filter(isUsefulImage);
}

function isUsefulImage(url) {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  if (/sprite|icon|logo|avatar|placeholder|blank|loading|qrcode|二维码/i.test(url)) return false;
  if (/alicdn\.com\/imgextra\/i\d\/.*(TB1|TB0).*(png|jpg)/i.test(url) && /\/bao\/uploaded\//i.test(url) === false) {
    return false;
  }
  if (url.startsWith("data:image")) return false;
  return true;
}


function uniqueImages(urls) {
  const seen = new Set();
  const result = [];
  for (const url of urls.map(normalizeUrl).filter(Boolean)) {
    const key = canonicalImageUrl(url);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(url);
  }
  return result;
}

function excludeDuplicates(urls, existing) {
  const existingSet = new Set(existing.map(canonicalImageUrl));
  return uniqueImages(urls).filter((url) => !existingSet.has(canonicalImageUrl(url)));
}

function normalizeUrl(url) {
  if (!url) return "";
  let value = String(url).trim().replaceAll("\\/", "/").replace(/&amp;/g, "&");
  if (value.startsWith("//")) value = `${location.protocol}${value}`;
  if (value.startsWith("/")) value = `${location.origin}${value}`;
  return value;
}

function normalizeImageAssetUrl(url) {
  const value = normalizeUrl(url);
  if (!value) return "";
  return stripImageTagUrlToJpg(value);
}

function stripImageTagUrlToJpg(url) {
  const value = String(url || "");
  const jpgMatch = value.match(/^(.+?\.jpg)(?:[?#].*)?$/i);
  if (jpgMatch?.[1]) return jpgMatch[1];

  const jpegMatch = value.match(/^(.+?\.jpeg)(?:[?#].*)?$/i);
  if (jpegMatch?.[1]) return jpegMatch[1];

  const pngMatch = value.match(/^(.+?\.png)(?:[?#].*)?$/i);
  if (pngMatch?.[1]) return pngMatch[1];

  const webpMatch = value.match(/^(.+?\.webp)(?:[?#].*)?$/i);
  if (webpMatch?.[1]) return webpMatch[1];

  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return value.split("?")[0].split("#")[0];
  }
}

function canonicalImageUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    parsed.pathname = parsed.pathname
      .replace(/_\d+x\d+(?=\.)/gi, "")
      .replace(/\.(jpg|jpeg|png|webp|avif)_\.(webp|avif)$/i, ".$1")
      .toLowerCase();
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return String(url).split(/[?#]/)[0].toLowerCase();
  }
}

function textBySelectors(selectors) {
  for (const selector of selectors) {
    const node = selector.startsWith("meta[")
      ? document.querySelector(selector)
      : document.querySelector(selector);
    const value = node?.content || node?.getAttribute?.("content") || node?.innerText || node?.textContent || node?.getAttribute?.("data-price");
    if (clean(value)) return clean(value);
  }
  return "";
}

function normalizeTitle(value) {
  return clean(value).replace(/\s*[-|_]\s*(Temu|Amazon|淘宝|天猫).*$/i, "");
}

function normalizePrice(value) {
  const match = String(value || "").replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match ? match[0] : "";
}

function normalizeStockText(value) {
  const match = String(value || "").replace(/,/g, "").match(/\d+/);
  return match ? match[0] : "";
}

function inferCurrency(platform, price) {
  if (!price) return platform === "Temu" ? "USD" : "CNY";
  if (/\$|USD/i.test(price)) return "USD";
  if (/¥|CNY|RMB/i.test(price)) return "CNY";
  return platform === "Temu" || platform === "Amazon" ? "USD" : "CNY";
}

function extractSourceId(url) {
  const patterns = [
    /offer\/(\d+)\.html/i,
    /-g-(\d+)\.html/i,
    /goods\/(\d+)/i,
    /product\/(\d+)/i,
    /[?&]id=(\d+)/i,
    /[?&](?:goods_id|product_id|itemId|goodsId|productId)=(\d+)/i,
    /\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i
  ];
  for (const pattern of patterns) {
    const match = String(url).match(pattern);
    if (match?.[1]) return match[1];
  }
  return "";
}

function platformCode(platform) {
  return {
    "Temu": "TEMU",
    "Amazon": "AMZ",
    "1688": "A1688",
    "淘宝": "TB",
    "天猫": "TM",
    "拼多多": "PDD",
    "SHEIN": "SHEIN"
  }[platform] || "SKU";
}

function makeProductCode(seed) {
  let hash = 0;
  for (const char of String(seed || location.href)) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `P-${hash.toString(36).toUpperCase()}`;
}

function bestSrcsetUrl(srcset) {
  if (!srcset) return "";
  const parts = String(srcset).split(",").map((item) => item.trim().split(/\s+/)[0]).filter(Boolean);
  return parts[parts.length - 1] || "";
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values) {
  return [...new Set(values)];
}

function isVisible(node) {
  const style = window.getComputedStyle(node);
  return style.display !== "none" && style.visibility !== "hidden";
}

const PANEL_ROOT_ID = "__product_sync_panel__";
let panelState = {
  minimized: true,
  x: null,
  y: 20,
  panelWidth: 248,
  product: null,
  screenshot: "",
  selectionKey: "",
  activeBucket: "main",
  selectedUrls: new Set(),
  correctionOpen: false,
  assignTarget: "main",
  syncOptions: {
    main: true,
    sku: true,
    detail: true,
    size: true
  },
  buckets: {
    main: [],
    sku: [],
    detail: [],
    size: []
  },
  bucketLookup: new Map()
};

function renderProductPanel(product, options = {}) {
  if (product) {
    panelState.product = {
      ...panelState.product,
      ...product
    };
    panelState.screenshot = product.screenshot || panelState.screenshot || "";
    hydrateBucketsFromProduct(panelState.product);
  }
  if (typeof options.minimized === "boolean") panelState.minimized = options.minimized;

  const root = ensureProductPanelRoot();
  normalizePanelPosition();
  root.innerHTML = "";
  root.style.left = `${panelState.x}px`;
  root.style.top = `${panelState.y}px`;
  root.classList.toggle("is-minimized", panelState.minimized);
  root.classList.toggle("is-hidden-for-shot", false);
  root.classList.toggle("has-selection", (panelState.selectedUrls?.size || 0) > 0);
  root.classList.toggle("is-compact", !panelState.correctionOpen);

  if (panelState.minimized) {
    root.appendChild(buildPanelButton());
    return;
  }

  const panel = document.createElement("section");
  panel.className = "psync-panel";
  panel.append(buildPanelHeader(root), buildPanelBody());
  root.appendChild(panel);
}

function ensureProductPanelRoot() {
  let root = document.getElementById(PANEL_ROOT_ID);
  if (root) return root;

  if (panelState.x == null) {
    panelState.x = Math.max(12, window.innerWidth - 88);
  }

  root = document.createElement("div");
  root.id = PANEL_ROOT_ID;
  root.style.position = "fixed";
  root.style.left = `${panelState.x}px`;
  root.style.top = `${panelState.y}px`;
  root.style.zIndex = "2147483647";
  root.style.fontFamily = '"Aptos","Segoe UI","PingFang SC","Microsoft YaHei",sans-serif';

  // 避免面板交互影响页面本身（有些站点在捕获阶段监听点击触发滚动/聚焦）
  // 注意：不能在 capture 阶段 stopPropagation（会导致面板按钮点不了）。这里用 stopImmediatePropagation 尽量阻止后续同阶段监听。
  ["click", "dblclick", "mousedown", "mouseup", "pointerdown", "pointerup", "touchstart", "touchend"].forEach((type) => {
    root.addEventListener(type, (event) => {
      event.stopPropagation();
    }, false);
  });

  const style = document.createElement("style");
  style.textContent = `
/* 基础重置 */
#${PANEL_ROOT_ID} *{box-sizing:border-box}
#${PANEL_ROOT_ID}{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif}

/* 隐藏状态 */
#${PANEL_ROOT_ID}.is-hidden-for-shot{opacity:0 !important;pointer-events:none !important}
#${PANEL_ROOT_ID}.is-minimized .psync-panel{display:none}

/* 主面板容器 */
#${PANEL_ROOT_ID} .psync-panel{
  width:360px;max-height:72vh;overflow:hidden;border-radius:12px;resize:both;min-width:320px;min-height:300px;
  background:#fff;border:1px solid rgba(31,35,41,0.12);box-shadow:0 18px 60px rgba(31,35,41,0.22);color:#1f2329
}
#${PANEL_ROOT_ID}.is-compact .psync-panel{
  width:320px;
  min-height:220px;
}

/* 头部 */
#${PANEL_ROOT_ID} .psync-head{
  position:relative;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 34px 12px 12px;
  cursor:move;background:linear-gradient(180deg,#fafbfc,#f6f7f9);border-bottom:1px solid #eff1f5;
  border-radius:12px 12px 0 0
}
#${PANEL_ROOT_ID} .psync-head h2{margin:0;font-size:14px;line-height:1.4;font-weight:600;color:#1f2329}
#${PANEL_ROOT_ID} .psync-head p{margin:2px 0 0;font-size:12px;color:#646a73;line-height:1.4}

/* 头部操作区 */
#${PANEL_ROOT_ID} .psync-head-actions{position:absolute;top:8px;right:8px;width:26px;height:26px}
#${PANEL_ROOT_ID} .psync-icon{
  position:absolute;top:0;right:0;display:flex;align-items:center;justify-content:center;
  width:24px;height:24px;padding:0;line-height:1;border-radius:4px;border:1px solid #d9dde5;
  background:#fff;color:#1f2329;cursor:pointer;font-size:13px;
  transition:all 0.15s ease;
  hover:background:#f6f7f9;border-color:#1664ff
}
#${PANEL_ROOT_ID} .psync-icon:hover{background:#e8edf7;border-color:#1664ff;color:#1664ff}

/* 面板体 */
#${PANEL_ROOT_ID} .psync-body{padding:12px;overflow:auto;max-height:calc(72vh - 60px)}

/* 工具栏 */
#${PANEL_ROOT_ID} .psync-toolbar{display:grid;grid-template-columns:repeat(auto-fit,minmax(0,1fr));gap:6px;margin-bottom:10px}

/* 工具按钮 */
#${PANEL_ROOT_ID} .psync-tool{
  padding:8px 12px;border-radius:10px;border:1px solid rgba(31,35,41,0.14);background:#fff;color:#1f2329;cursor:pointer;font-size:13px;
  transition:all 0.15s ease;line-height:1;font-weight:600
}
#${PANEL_ROOT_ID} .psync-tool:hover{background:#f6f7f9;border-color:#1664ff}
#${PANEL_ROOT_ID} .psync-tool:active{background:#e8edf7}

/* 主工具按钮 */
#${PANEL_ROOT_ID} .psync-tool-primary{
  background:#1664ff;border:none;color:#fff;font-weight:600;
}
#${PANEL_ROOT_ID} .psync-tool-primary:hover{background:#1e54db}
#${PANEL_ROOT_ID} .psync-tool-primary:active{background:#174ac4;transform:translateY(0)}

/* Tabs */
#${PANEL_ROOT_ID} .psync-tabs{
  display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 10px
}
#${PANEL_ROOT_ID} .psync-tab{display:inline-flex;align-items:center;gap:6px}
#${PANEL_ROOT_ID} .psync-check{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:#646a73;user-select:none}
#${PANEL_ROOT_ID} .psync-check input{width:14px;height:14px;accent-color:#1664ff}

/* Assign bar (纠错：全部) */
#${PANEL_ROOT_ID} .psync-assign{
  display:flex;flex-wrap:wrap;align-items:center;gap:6px;
  padding:8px 10px;border-radius:8px;margin:0 0 10px;
  background:#f6f7f9;border:1px solid #eff1f5;color:#646a73;font-size:12px
}
#${PANEL_ROOT_ID} .psync-assign-label{margin-right:2px;color:#646a73;font-weight:600}

/* Summary (纠错关闭时) */
#${PANEL_ROOT_ID} .psync-summary{
  display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:6px 0 0
}
#${PANEL_ROOT_ID} .psync-summary-row{
  display:flex;align-items:center;justify-content:space-between;
  padding:8px 10px;border-radius:10px;background:#f6f7f9;border:1px solid #eff1f5
}
#${PANEL_ROOT_ID} .psync-summary-row span{font-size:12px;color:#646a73}
#${PANEL_ROOT_ID} .psync-summary-row strong{font-size:13px;color:#1f2329}

/* 标签药丸 */
#${PANEL_ROOT_ID} .psync-pill{
  padding:6px 10px;border-radius:999px;border:1px solid rgba(31,35,41,0.14);background:#fff;
  color:#3a3f46;cursor:pointer;font-size:12px;line-height:1;
  transition:all 0.15s ease;font-weight:600
}
#${PANEL_ROOT_ID} .psync-pill:hover{border-color:#1664ff;color:#1664ff}
#${PANEL_ROOT_ID} .psync-pill:active{transform:translateY(1px)}

/* 激活态标签 */
#${PANEL_ROOT_ID} .psync-pill.is-on{background:#e8edf7;border-color:#1664ff;color:#1664ff;font-weight:600}

/* 不同bucket的色彩标记 */
#${PANEL_ROOT_ID} .psync-pill[data-bucket=\"main\"].is-on{background:#e8edf7;border-color:#1664ff}
#${PANEL_ROOT_ID} .psync-pill[data-bucket=\"sku\"].is-on{background:#dffffc;border-color:#0fb8b3}
#${PANEL_ROOT_ID} .psync-pill[data-bucket=\"detail\"].is-on{background:#e6f8f0;border-color:#0fb8b3;color:#0a5d52}
#${PANEL_ROOT_ID} .psync-pill[data-bucket=\"size\"].is-on{background:#f0ebff;border-color:#8b5cf6;color:#6d28d9}

/* 计数标签 */
#${PANEL_ROOT_ID} .psync-count{margin-left:4px;font-weight:600;opacity:0.85}

/* 标题显示 */
#${PANEL_ROOT_ID} .psync-title{
  margin:0 0 12px;padding:8px 10px;border-radius:6px;background:#f6f7f9;border:1px solid #eff1f5;
  font-size:12px;line-height:1.4;color:#1f2329;word-break:break-word
}

/* 媒体分组 */
#${PANEL_ROOT_ID} .psync-group{margin-top:8px}
#${PANEL_ROOT_ID} .psync-group-head{
  display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px
}
#${PANEL_ROOT_ID} .psync-group-head strong{font-size:12px;font-weight:600;color:#1f2329}
#${PANEL_ROOT_ID} .psync-group-head span{font-size:11px;color:#a6a6a6}

/* 下载按钮 */
#${PANEL_ROOT_ID} .psync-download{
  padding:6px 10px;border-radius:4px;border:1px solid #d9dde5;background:#fff;color:#1f2329;
  cursor:pointer;font-size:11px;font-weight:500;
  transition:all 0.15s ease
}
#${PANEL_ROOT_ID} .psync-download:hover{background:#f6f7f9;border-color:#1664ff;color:#1664ff}

/* 图片网格 */
#${PANEL_ROOT_ID} .psync-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}

/* 缩略图 */
#${PANEL_ROOT_ID} .psync-thumb{
  position:relative;padding:0;border:0;border-radius:6px;overflow:hidden;cursor:pointer;
  background:#f6f7f9;box-shadow:inset 0 0 0 1px #eff1f5;
  transition:all 0.2s ease
}
#${PANEL_ROOT_ID} .psync-thumb:hover{box-shadow:inset 0 0 0 1px #d9dde5}

/* 选中的缩略图 */
#${PANEL_ROOT_ID} .psync-thumb.is-selected{box-shadow:inset 0 0 0 2px #1664ff}
#${PANEL_ROOT_ID} .psync-thumb.is-sku.is-selected{box-shadow:inset 0 0 0 2px #0fb8b3}
#${PANEL_ROOT_ID} .psync-thumb.is-detail.is-selected{box-shadow:inset 0 0 0 2px #0a5d52}
#${PANEL_ROOT_ID} .psync-thumb.is-size.is-selected{box-shadow:inset 0 0 0 2px #8b5cf6}
#${PANEL_ROOT_ID} .psync-thumb.is-picked{box-shadow:inset 0 0 0 2px #ff7a00}

/* 缩略图内容 */
#${PANEL_ROOT_ID} .psync-thumb img,#${PANEL_ROOT_ID} .psync-thumb video{
  display:block;width:100%;aspect-ratio:1;object-fit:cover;background:#eff1f5
}

/* 缩略图徽章 */
#${PANEL_ROOT_ID} .psync-badge{
  position:absolute;top:4px;left:4px;min-width:20px;height:20px;padding:0 6px;border-radius:999px;
  display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;
  background:#1664ff;color:#fff;box-shadow:0 2px 4px rgba(31,35,41,0.12)
}
#${PANEL_ROOT_ID} .psync-sku-tags{
  position:absolute;left:4px;right:4px;bottom:4px;display:flex;flex-wrap:wrap;gap:3px;pointer-events:none
}
#${PANEL_ROOT_ID} .psync-sku-tag{
  max-width:100%;padding:2px 5px;border-radius:999px;background:rgba(0,109,117,0.88);
  color:#fff;font-size:10px;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap
}

/* 空状态 */
#${PANEL_ROOT_ID} .psync-empty{
  padding:12px;border-radius:6px;background:#f6f7f9;color:#a6a6a6;font-size:12px;text-align:center;line-height:1.4
}

/* 响应式 */
@media (max-width:768px){#${PANEL_ROOT_ID} .psync-panel{width:min(calc(100vw - 24px),360px)}}
  `.trim();

  document.documentElement.append(style, root);
  return root;
}

function buildPanelHeader(root) {
  const header = document.createElement("header");
  header.className = "psync-head";
  const product = panelState.product;

  const left = document.createElement("div");
  left.innerHTML = `<h2>商品采集</h2><p>${escapeHtml(product?.price || "-")}</p>`;

  const right = document.createElement("div");
  right.className = "psync-head-actions";
  right.innerHTML = `
    <button type="button" class="psync-icon" data-minimize="1" aria-label="关闭">×</button>
  `;
  right.querySelector("[data-minimize]").addEventListener("click", (event) => {
    event.preventDefault();
    panelState.minimized = true;
    renderProductPanel();
  });

  attachDragBehavior(header, root);
  header.append(left, right);
  return header;
}

function buildPanelBody() {
  const body = document.createElement("div");
  body.className = "psync-body";
  const product = panelState.product;

  const toolbar = document.createElement("section");
  toolbar.className = "psync-toolbar";
  toolbar.innerHTML = `
    <button type="button" class="psync-tool" data-action="collect">重新采集</button>
    <button type="button" class="psync-tool psync-tool-primary" data-action="sync">提交本地</button>
    <button type="button" class="psync-tool" data-action="sync-create">提交并生成</button>
    <button type="button" class="psync-tool" data-action="toggle-correct">${panelState.correctionOpen ? "收起纠错" : "手动纠错"}</button>
    <button type="button" class="psync-tool" data-action="shot">截图</button>
    <button type="button" class="psync-tool" data-action="download">下载</button>
  `;
  toolbar.querySelector('[data-action="collect"]').addEventListener("click", () => collectAndShowInPanel());
  toolbar.querySelector('[data-action="sync"]').addEventListener("click", (event) => {
    event.preventDefault();
    collectAndSyncFromPanel();
  });
  toolbar.querySelector('[data-action="sync-create"]').addEventListener("click", (event) => {
    event.preventDefault();
    collectSyncCreateFromPanel();
  });
  toolbar.querySelector('[data-action="toggle-correct"]').addEventListener("click", (event) => {
    event.preventDefault();
    panelState.correctionOpen = !panelState.correctionOpen;
    panelState.selectedUrls = new Set();
    renderProductPanel();
  });
  toolbar.querySelector('[data-action="shot"]').addEventListener("click", (event) => {
    event.preventDefault();
    captureScreenshotIntoPanel();
  });
  toolbar.querySelector('[data-action="download"]').addEventListener("click", () => {
    downloadPanelGroup(panelState.activeBucket || "main", getActiveBucketUrls());
  });
  body.appendChild(toolbar);

  if (!product) {
    const empty = document.createElement("div");
    empty.className = "psync-empty";
    empty.textContent = "点“重新采集”读取当前商品";
    body.appendChild(empty);
    return body;
  }

  const title = document.createElement("p");
  title.className = "psync-title";
  title.textContent = product.title || "未识别到标题";
  body.appendChild(title);

  if (!panelState.correctionOpen) {
    const summary = document.createElement("section");
    summary.className = "psync-summary";
    const mainCount = panelState.buckets?.main?.length || 0;
    const skuCount = panelState.buckets?.sku?.length || 0;
    const detailCount = panelState.buckets?.detail?.length || 0;
    const sizeCount = panelState.buckets?.size?.length || 0;
    summary.innerHTML = `
      <div class="psync-summary-row"><span>主图</span><strong>${mainCount}</strong></div>
      <div class="psync-summary-row"><span>规格图</span><strong>${skuCount}</strong></div>
      <div class="psync-summary-row"><span>详情</span><strong>${detailCount}</strong></div>
      <div class="psync-summary-row"><span>尺寸</span><strong>${sizeCount}</strong></div>
    `;
    body.appendChild(summary);
    return body;
  }

  const tabs = document.createElement("section");
  tabs.className = "psync-tabs";
  tabs.innerHTML = `
    <div class="psync-tab"><button type="button" class="psync-pill" data-bucket="main">主图<span class="psync-count" data-count="main">0</span></button><label class="psync-check"><input type="checkbox" data-selectall="main" aria-label="全选主图"><span>全选</span></label></div>
    <div class="psync-tab"><button type="button" class="psync-pill" data-bucket="sku">规格/属性<span class="psync-count" data-count="sku">0</span></button><label class="psync-check"><input type="checkbox" data-selectall="sku" aria-label="全选规格属性"><span>全选</span></label></div>
    <div class="psync-tab"><button type="button" class="psync-pill" data-bucket="detail">详情<span class="psync-count" data-count="detail">0</span></button><label class="psync-check"><input type="checkbox" data-selectall="detail" aria-label="全选详情"><span>全选</span></label></div>
    <button type="button" class="psync-pill" data-bucket="size">尺寸<span class="psync-count" data-count="size">0</span></button>
    <div class="psync-tab"><button type="button" class="psync-pill" data-bucket="video">视频<span class="psync-count" data-count="video">0</span></button><label class="psync-check"><input type="checkbox" data-selectall="video" aria-label="全选视频"><span>全选</span></label></div>
    <button type="button" class="psync-pill" data-bucket="screenshot">截图<span class="psync-count" data-count="screenshot">0</span></button>
    <button type="button" class="psync-pill" data-bucket="all">全部<span class="psync-count" data-count="all">0</span></button>
  `;
  tabs.querySelectorAll("button[data-bucket]").forEach((button) => {
    const bucket = button.getAttribute("data-bucket");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      panelState.activeBucket = bucket;
      panelState.selectedUrls = new Set();
      renderProductPanel();
    });
  });
  tabs.querySelectorAll("input[data-selectall]").forEach((input) => {
    const bucket = input.getAttribute("data-selectall");
    input.addEventListener("change", (event) => {
      event.preventDefault();
      panelState.activeBucket = bucket;
      const urls = getBucketUrls(bucket);
      panelState.selectedUrls = input.checked ? new Set(urls) : new Set();
      renderProductPanel();
    });
  });
  updateBucketCounts(tabs);
  body.appendChild(tabs);

  if (panelState.activeBucket === "all") {
    const sizeAssignedCount = panelState.buckets?.size?.length || 0;
    const assign = document.createElement("section");
    assign.className = "psync-assign";
    assign.innerHTML = `
      <span class="psync-assign-label">归类到</span>
      <button type="button" class="psync-pill" data-assign="main">主图</button>
      <button type="button" class="psync-pill" data-assign="sku">规格/属性</button>
      <button type="button" class="psync-pill" data-assign="detail">详情</button>
      <button type="button" class="psync-pill" data-assign="size">尺寸（已归类${sizeAssignedCount}张）</button>
    `;
    assign.querySelectorAll("button[data-assign]").forEach((button) => {
      const bucket = button.getAttribute("data-assign");
      button.classList.toggle("is-on", panelState.assignTarget === bucket);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        panelState.assignTarget = bucket;
        renderProductPanel();
      });
    });
    body.appendChild(assign);
  }

  const { label, urls, kind, isVideo } = getActiveBucketRenderData();
  body.appendChild(buildMediaGroup(label, urls, kind, isVideo));
  return body;
}

async function quickCollectAndSync() {
  movePanelIntoView("expand");
  panelState.minimized = false;
  renderProductPanel();
  await collectAndSyncFromPanel();
}

async function collectAndSyncFromPanel() {
  setPanelSyncingState(true, "同步中…");

  const serverOk = await checkLocalSyncServer();
  if (!serverOk) {
    setPanelSyncingState(false);
    toast("本地服务未启动，请先运行：python -m uvicorn app.main:app --reload");
    return;
  }

  setPanelSyncingState(true, "采集中…");
  await collectAndShowInPanel();
  const baseProduct = panelState.product;
  if (!baseProduct) {
    setPanelSyncingState(false);
    toast("采集失败：未读取到商品信息");
    return;
  }

  let screenshot = panelState.screenshot;
  if (!screenshot) {
    try {
      setPanelSyncingState(true, "截图中…");
      screenshot = await captureAndUploadScreenshot(baseProduct.platformSku || baseProduct.sourceId || baseProduct.url);
      panelState.screenshot = screenshot;
    } catch (error) {
      setPanelSyncingState(false);
      toast(error.message || "截图失败");
    }
  }

  setPanelSyncingState(true, "提交本地…");
  if (!screenshot) {
    setPanelSyncingState(false);
    toast("鎴浘澶辫触");
    return;
  }

  const filtered = applySyncOptions(baseProduct, panelState.syncOptions || {});
  filtered.screenshot = screenshot || "";
  filtered.collector = await getCollectorName();

  const result = await postProductToLocalServer(filtered);
  if (!result?.ok) {
    setPanelSyncingState(false);
    toast(result?.error || "同步失败");
    return;
  }

  setPanelSyncingState(false);
  toast("已提交到本地工作台");
}

async function collectSyncCreateFromPanel() {
  setPanelSyncingState(true, "生成中…");

  const serverOk = await checkLocalSyncServer();
  if (!serverOk) {
    setPanelSyncingState(false);
    toast("本地服务未启动，请先启动 API 服务");
    return;
  }

  setPanelSyncingState(true, "采集中…");
  await collectAndShowInPanel();
  const baseProduct = panelState.product;
  if (!baseProduct) {
    setPanelSyncingState(false);
    toast("采集失败：未读取到商品信息");
    return;
  }

  let screenshot = panelState.screenshot;
  if (!screenshot) {
    try {
      setPanelSyncingState(true, "截图中…");
      screenshot = await captureAndUploadScreenshot(baseProduct.platformSku || baseProduct.sourceId || baseProduct.url);
      panelState.screenshot = screenshot;
    } catch (error) {
      setPanelSyncingState(false);
      toast(error.message || "截图失败");
      return;
    }
  }

  const filtered = applySyncOptions(baseProduct, panelState.syncOptions || {});
  filtered.screenshot = screenshot || "";
  filtered.collector = await getCollectorName();

  setPanelSyncingState(true, "提交本地…");
  const rawResult = await postProductToLocalServer(filtered);
  if (!rawResult?.ok || !rawResult.id) {
    setPanelSyncingState(false);
    toast(rawResult?.error || rawResult?.detail || "原始数据提交失败");
    return;
  }

  setPanelSyncingState(true, "创建任务…");
  const taskResult = await createTaskFromRawProduct(rawResult.id);
  if (!taskResult?.ok || !taskResult.id) {
    setPanelSyncingState(false);
    toast(taskResult?.detail || "创建任务失败");
    return;
  }

  setPanelSyncingState(false);
  toast(`已生成上架任务 #${taskResult.id}`);
  const webUrl = await getWebUrl();
  window.open(`${webUrl}/product-tasks?task_id=${encodeURIComponent(taskResult.id)}`, "_blank", "noopener");
}

async function getCollectorName() {
  try {
    const stored = await chrome.storage.local.get({ collector: "" });
    return String(stored.collector || "").trim();
  } catch {
    return "";
  }
}

function applySyncOptions(product, options) {
  const next = { ...product };
  if (!options.main) next.mainImages = [];
  else next.mainImages = (panelState.buckets?.main || []).slice();

  if (!options.sku) next.skuImages = [];
  else next.skuImages = (panelState.buckets?.sku || []).slice();
  next.skuProps = filterPanelSkuProps(next.skuProps || [], next.skuImages || []);

  if (!options.detail) next.detailImages = [];
  else next.detailImages = (panelState.buckets?.detail || []).slice();

  if (!options.size) next.sizeChartImages = [];
  else next.sizeChartImages = (panelState.buckets?.size || []).slice();
  return next;
}

async function checkLocalSyncServer() {
  try {
    const baseUrl = await getServerUrl();
    const response = await fetch(`${baseUrl}/health`);
    const data = await response.json();
    return Boolean(data?.ok);
  } catch {
    return false;
  }
}

function captureVisibleTab() {
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

async function captureAndUploadScreenshot(productId) {
  const dataUrl = await captureVisibleTabWithoutPanel();
  const baseUrl = await getServerUrl();
  const response = await fetch(`${baseUrl}/sync/screenshot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productId, dataUrl })
  });
  const data = await response.json();
  if (!data?.ok || !data.url) throw new Error(data?.error || "截图上传失败");
  return data.url;
}

async function captureVisibleTabWithoutPanel() {
  const root = ensureProductPanelRoot();
  root.classList.add("is-hidden-for-shot");
  await sleep(120);
  try {
    return await captureVisibleTab();
  } finally {
    root.classList.remove("is-hidden-for-shot");
  }
}

async function postProductToLocalServer(product) {
  const baseUrl = await getServerUrl();
  const response = await fetch(`${baseUrl}/api/raw-products`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sanitizePanelProductForSubmit(product))
  });
  return response.json();
}

function sanitizePanelProductForSubmit(product) {
  const { _allSkuProps, ...rest } = product || {};
  return rest;
}

async function createTaskFromRawProduct(rawProductId) {
  const baseUrl = await getServerUrl();
  const stored = await chrome.storage.local.get({
    generationMode: "title_and_4grid",
    includeProductInfo: true
  });
  const response = await fetch(`${baseUrl}/api/raw-products/${rawProductId}/create-task`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      split_count: 1,
      generation_mode: stored.generationMode || "title_and_4grid",
      include_product_info: stored.includeProductInfo !== false
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, detail: typeof data?.detail === "string" ? data.detail : `HTTP ${response.status}` };
  return data;
}

const DEFAULT_SERVER_URL = "http://127.0.0.1:8000";
const DEFAULT_WEB_URL = "http://127.0.0.1:3000";
let cachedServerUrl = "";
let cachedWebUrl = "";
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes?.serverUrl) cachedServerUrl = normalizeBaseUrl(changes.serverUrl.newValue, DEFAULT_SERVER_URL);
  if (changes?.webUrl) cachedWebUrl = normalizeBaseUrl(changes.webUrl.newValue, DEFAULT_WEB_URL);
});

async function getServerUrl() {
  if (cachedServerUrl) return cachedServerUrl;
  const stored = await chrome.storage.local.get({ serverUrl: DEFAULT_SERVER_URL });
  cachedServerUrl = normalizeBaseUrl(stored.serverUrl, DEFAULT_SERVER_URL);
  return cachedServerUrl;
}

async function getWebUrl() {
  if (cachedWebUrl) return cachedWebUrl;
  const stored = await chrome.storage.local.get({ webUrl: DEFAULT_WEB_URL });
  cachedWebUrl = normalizeBaseUrl(stored.webUrl, DEFAULT_WEB_URL);
  return cachedWebUrl;
}

function normalizeServerUrl(value) {
  return normalizeBaseUrl(value, DEFAULT_SERVER_URL);
}

function normalizeBaseUrl(value, fallback) {
  const url = String(value || "").trim();
  return (url || fallback).replace(/\/+$/, "");
}

function buildMediaGroup(label, urls, kind, isVideo = false) {
  const section = document.createElement("section");
  section.className = "psync-group";
  const normalizedUrls = isVideo ? (urls || []).filter(Boolean) : uniqueImages((urls || []).filter(Boolean));

  const head = document.createElement("div");
  head.className = "psync-group-head";
  head.innerHTML = `<div><strong>${label}</strong><span>${normalizedUrls.length} 项</span></div><button type="button" class="psync-download">下载</button>`;
  head.querySelector("button").addEventListener("click", () => {
    downloadPanelGroup(kind, normalizedUrls);
  });

  const grid = document.createElement("div");
  grid.className = "psync-grid";

  if (!normalizedUrls.length) {
    const empty = document.createElement("div");
    empty.className = "psync-empty";
    empty.textContent = "暂无";
    grid.appendChild(empty);
  } else {
    normalizedUrls.forEach((url, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "psync-thumb";
      button.title = url;
      button.addEventListener("pointerdown", (event) => {
        // 用 pointerdown 代替 click，尽量避免站点 click/focus 逻辑触发滚动
        event.preventDefault();
        event.stopPropagation();
        const scrollY = window.scrollY;
        
        // 保存浮窗内部的滚动位置
        const panelBody = document.querySelector(`#${PANEL_ROOT_ID} .psync-body`);
        const panelScrollY = panelBody?.scrollTop || 0;

        if (isVideo) {
          if (event.ctrlKey || event.metaKey) {
            window.open(url, "_blank", "noopener");
            scheduleScrollRestore(scrollY);
            return;
          }
          toggleSelectedUrl(url);
          renderProductPanel();
          scheduleScrollRestore(scrollY);
          return;
        }
        if (event.ctrlKey || event.metaKey) {
          window.open(url, "_blank", "noopener");
          scheduleScrollRestore(scrollY);
          return;
        }

        if (panelState.activeBucket !== "all") {
          toggleSelectedUrl(url);
        } else {
          const targetBucket = panelState.assignTarget;
          if (!["main", "sku", "detail", "size"].includes(String(targetBucket || ""))) {
            window.open(url, "_blank", "noopener");
            scheduleScrollRestore(scrollY);
            return;
          }
          toggleBucketAssignment(targetBucket, url);
        }
        button.blur?.();
        renderProductPanel();
        scheduleScrollRestore(scrollY);
        
        // 恢复浮窗内部的滚动位置
        requestAnimationFrame(() => {
          const body = document.querySelector(`#${PANEL_ROOT_ID} .psync-body`);
          if (body) {
            body.scrollTop = panelScrollY;
          }
        });
      });

      if (isVideo) {
        const video = document.createElement("video");
        video.src = url;
        video.muted = true;
        video.playsInline = true;
        video.preload = "metadata";
        button.appendChild(video);
      } else {
        const image = document.createElement("img");
        image.src = url;
        image.alt = `${kind}-${index + 1}`;
        button.appendChild(image);

        const meta = panelState.bucketLookup?.get(url) || null;
        if (meta) {
          button.classList.add("is-selected", `is-${meta.bucket}`);
          const badge = document.createElement("span");
          badge.className = "psync-badge";
          badge.textContent = String(meta.index + 1);
          button.appendChild(badge);
        }
        if (kind === "sku") {
          const tags = getPanelSkuPropsForImage(url).slice(0, 3);
          if (tags.length) {
            const wrap = document.createElement("div");
            wrap.className = "psync-sku-tags";
            tags.forEach((item) => {
              const tag = document.createElement("span");
              tag.className = "psync-sku-tag";
              tag.textContent = formatPanelSkuProp(item);
              wrap.appendChild(tag);
            });
            button.appendChild(wrap);
          }
        }
      }

      if (panelState.selectedUrls?.has?.(url)) {
        button.classList.add("is-picked");
      }
      grid.appendChild(button);
    });
  }

  section.append(head, grid);
  return section;
}

function getPanelSkuPropsForImage(url) {
  const props = Array.isArray(panelState.product?.skuProps) ? panelState.product.skuProps : [];
  return props.filter((item) => normalizePanelImageKey(item?.imageUrl || item?.image_url || "") === normalizePanelImageKey(url));
}

function filterPanelSkuProps(props, skuImages) {
  const selectedImages = new Set((skuImages || []).map(normalizePanelImageKey));
  return (props || []).filter((item) => {
    const imageKey = normalizePanelImageKey(item?.imageUrl || item?.image_url || "");
    return !imageKey || selectedImages.has(imageKey);
  });
}

function formatPanelSkuProp(item) {
  const group = item?.groupName || item?.group_name || "规格";
  const option = item?.optionName || item?.option_name || item?.hintText || item?.hint_text || "";
  return option ? `${group}: ${option}` : group;
}

function normalizePanelImageKey(url) {
  return String(url || "").split("?")[0].replace(/\/+$/, "");
}

function getBucketMeta(bucket, url) {
  const list = panelState.buckets?.[bucket] || [];
  const index = list.indexOf(url);
  if (index === -1) return null;
  return { bucket, index };
}

function hydrateBucketsFromProduct(product) {
  if (!product) return;
  const key = String(product.platformSku || product.sourceId || product.url || "");
  if (!key) return;

  const main = (product.mainImages || []).filter(Boolean);
  const sku = (product.skuImages || []).filter(Boolean);
  const detail = (product.detailImages || []).filter(Boolean);
  const size = (product.sizeChartImages || []).filter(Boolean);

  if (panelState.selectionKey !== key) {
    panelState.selectionKey = key;
    panelState.activeBucket = "main";
    panelState.buckets = {
      main: main.slice(),
      sku: sku.slice(),
      detail: detail.slice(),
      size: size.slice()
    };
  } else {
    appendMissing(panelState.buckets.main, main);
    appendMissing(panelState.buckets.sku, sku);
    appendMissing(panelState.buckets.detail, detail);
    appendMissing(panelState.buckets.size, size);
  }

  rebuildBucketLookup();
}

function appendMissing(target, list) {
  const seen = new Set(target);
  for (const url of list) {
    if (!seen.has(url)) {
      target.push(url);
      seen.add(url);
    }
  }
}

function rebuildBucketLookup() {
  const map = new Map();
  for (const bucket of ["main", "sku", "detail", "size"]) {
    const urls = panelState.buckets?.[bucket] || [];
    urls.forEach((url, index) => map.set(url, { bucket, index }));
  }
  panelState.bucketLookup = map;
}

function toggleBucketAssignment(bucket, url) {
  if (!bucket || !url) return;

  const target = panelState.buckets?.[bucket] || (panelState.buckets[bucket] = []);
  // 再次点击：从当前 bucket 移除
  const idx = target.indexOf(url);
  if (idx !== -1) target.splice(idx, 1);
  else target.push(url);

  rebuildBucketLookup();
}

function updateBucketCounts(toolbarRoot) {
  const root = toolbarRoot || document;
  const buckets = ["main", "sku", "detail", "size", "video", "screenshot", "all"];
  const product = panelState.product || {};
  const main = panelState.buckets?.main || [];
  const sku = panelState.buckets?.sku || [];
  const detail = panelState.buckets?.detail || [];
  const size = panelState.buckets?.size || [];
  const all = uniqueImages([...main, ...sku, ...detail, ...size]);

  const countOf = (bucket) => {
    if (bucket === "main") return main.length;
    if (bucket === "sku") return sku.length;
    if (bucket === "detail") return detail.length;
    if (bucket === "size") return size.length;
    if (bucket === "video") return product.videoUrl ? 1 : 0;
    if (bucket === "screenshot") return panelState.screenshot ? 1 : 0;
    if (bucket === "all") return all.length;
    return 0;
  };

  for (const bucket of buckets) {
    const countNode = root.querySelector(`[data-count=\"${bucket}\"]`);
    if (countNode) countNode.textContent = String(countOf(bucket));
    const pill = root.querySelector(`[data-bucket=\"${bucket}\"]`);
    if (pill) pill.classList.toggle("is-on", panelState.activeBucket === bucket);
    const checkbox = root.querySelector(`input[data-selectall=\"${bucket}\"]`);
    if (checkbox) {
      const urls = getBucketUrls(bucket);
      const selected = panelState.selectedUrls instanceof Set ? panelState.selectedUrls : new Set();
      const allSelected = urls.length > 0 && urls.every((url) => selected.has(url)) && panelState.activeBucket === bucket;
      const noneSelected = selected.size === 0 || panelState.activeBucket !== bucket;
      checkbox.checked = allSelected;
      checkbox.indeterminate = !noneSelected && !allSelected;
      checkbox.disabled = urls.length === 0;
    }
  }
}

function toggleSelectedUrl(url) {
  if (!url) return;
  const set = panelState.selectedUrls instanceof Set ? panelState.selectedUrls : new Set();
  if (set.has(url)) set.delete(url);
  else set.add(url);
  panelState.selectedUrls = set;
}

function removeSelectedFromBucket(bucket) {
  const selected = panelState.selectedUrls instanceof Set ? panelState.selectedUrls : new Set();
  if (!selected.size) return;

  const product = panelState.product || {};
  if (bucket === "video") {
    const videoUrl = product.videoUrl || "";
    if (videoUrl && selected.has(videoUrl)) {
      product.videoUrl = "";
      panelState.product = product;
    }
    return;
  }

  if (!["main", "sku", "detail", "size"].includes(String(bucket || ""))) return;
  const list = panelState.buckets?.[bucket] || [];
  panelState.buckets[bucket] = list.filter((url) => !selected.has(url));
  rebuildBucketLookup();
}

function getActiveBucketUrls() {
  return getBucketUrls(panelState.activeBucket || "main");
}

function getActiveBucketRenderData() {
  const product = panelState.product || {};
  const bucket = panelState.activeBucket || "main";

  if (bucket === "main") return { label: "主图", urls: getActiveBucketUrls(), kind: "main", isVideo: false };
  if (bucket === "sku") return { label: "规格/属性", urls: getActiveBucketUrls(), kind: "sku", isVideo: false };
  if (bucket === "detail") return { label: "详情", urls: getActiveBucketUrls(), kind: "detail", isVideo: false };
  if (bucket === "size") return { label: "尺寸", urls: getActiveBucketUrls(), kind: "size", isVideo: false };
  if (bucket === "video") return { label: "视频", urls: product.videoUrl ? [product.videoUrl] : [], kind: "video", isVideo: true };
  if (bucket === "screenshot") return { label: "截图", urls: panelState.screenshot ? [panelState.screenshot] : [], kind: "screenshot", isVideo: false };
  return { label: "全部", urls: getActiveBucketUrls(), kind: "all", isVideo: false };
}

function getBucketUrls(bucket) {
  const product = panelState.product || {};
  const key = String(bucket || "main");
  if (key === "main") return (panelState.buckets?.main || []).slice();
  if (key === "sku") return (panelState.buckets?.sku || []).slice();
  if (key === "detail") return (panelState.buckets?.detail || []).slice();
  if (key === "size") return (panelState.buckets?.size || []).slice();
  if (key === "video") return product.videoUrl ? [product.videoUrl] : [];
  if (key === "screenshot") return panelState.screenshot ? [panelState.screenshot] : [];
  if (key === "all") {
    return uniqueImages([
      ...(panelState.buckets?.main || []),
      ...(panelState.buckets?.sku || []),
      ...(panelState.buckets?.detail || []),
      ...(panelState.buckets?.size || [])
    ]);
  }
  return [];
}

function scheduleScrollRestore(scrollY) {
  if (typeof scrollY !== "number") return;
  const restore = () => {
    if (window.scrollY !== scrollY) {
      window.scrollTo({ top: scrollY, left: 0, behavior: "auto" });
    }
  };

  // 有些页面会在 click 后异步触发滚动，这里多次兜底恢复
  requestAnimationFrame(restore);
  setTimeout(restore, 0);
  setTimeout(restore, 30);
  setTimeout(restore, 120);
}

async function collectAndShowInPanel() {
  try {
    const product = await collectProductAsync();
    panelState.product = product;
    movePanelIntoView("expand");
    panelState.minimized = false;
    renderProductPanel(product, { minimized: false });
  } catch (error) {
    movePanelIntoView("expand");
    panelState.minimized = false;
    renderProductPanel({
      title: error.message || "采集失败",
      platform: detectPlatform(),
      price: "-",
      mainImages: [],
      skuImages: [],
      detailImages: [],
      videoUrl: "",
      screenshot: panelState.screenshot
    }, { minimized: false });
  }
}

async function captureScreenshotIntoPanel() {
  const root = ensureProductPanelRoot();
  root.classList.add("is-hidden-for-shot");
  await sleep(120);

  // 保存浮窗内部的滚动位置
  const panelBody = document.querySelector(`#${PANEL_ROOT_ID} .psync-body`);
  const panelScrollY = panelBody?.scrollTop || 0;

  try {
    const dataUrl = await captureVisibleTabFromPage();
    panelState.screenshot = dataUrl;
    if (panelState.product) {
      panelState.product.screenshot = dataUrl;
    }
  } finally {
    root.classList.remove("is-hidden-for-shot");
    renderProductPanel();
    
    // 恢复浮窗内部的滚动位置
    requestAnimationFrame(() => {
      const body = document.querySelector(`#${PANEL_ROOT_ID} .psync-body`);
      if (body) {
        body.scrollTop = panelScrollY;
      }
    });
  }
}

function captureVisibleTabFromPage() {
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

function downloadPanelGroup(kind, urls) {
  const list = (urls || []).filter(Boolean);
  if (!list.length) return;
  chrome.runtime.sendMessage({
    type: "DOWNLOAD_IMAGES",
    urls: list,
    folder: `product-capture/${kind}-${Date.now()}`
  });
}

function attachDragBehavior(handle, root, onDragStart = null) {
  handle.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const initialX = panelState.x;
    const initialY = panelState.y;
    let dragging = false;
    handle.setPointerCapture(event.pointerId);

    const onMove = (moveEvent) => {
      if (!dragging) {
        const distance = Math.abs(moveEvent.clientX - startX) + Math.abs(moveEvent.clientY - startY);
        if (distance < 8) return;
        dragging = true;
        onDragStart?.();
      }
      panelState.x = Math.max(8, initialX + moveEvent.clientX - startX);
      panelState.y = Math.max(8, initialY + moveEvent.clientY - startY);
      normalizePanelPosition();
      root.style.left = `${panelState.x}px`;
      root.style.top = `${panelState.y}px`;
    };

    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  });
}

function movePanelIntoView(mode) {
  if (mode === "expand") {
    const margin = 12;
    panelState.x = Math.max(margin, panelState.x - panelState.panelWidth + 68);
    normalizePanelPosition();
  }
}

function normalizePanelPosition() {
  const margin = 8;
  const buttonWidth = 72;
  const width = panelState.minimized ? buttonWidth : panelState.panelWidth;
  const maxX = Math.max(margin, window.innerWidth - width - margin);
  const maxY = Math.max(margin, window.innerHeight - 80);
  panelState.x = Math.min(Math.max(panelState.x ?? margin, margin), maxX);
  panelState.y = Math.min(Math.max(panelState.y ?? margin, margin), maxY);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toast(message, duration = 2500) {
  const existing = document.getElementById("__psync_toast__");
  if (existing) existing.remove();

  const el = document.createElement("div");
  el.id = "__psync_toast__";
  el.textContent = message;
  Object.assign(el.style, {
    position: "fixed",
    bottom: "24px",
    left: "50%",
    transform: "translateX(-50%)",
    padding: "10px 20px",
    borderRadius: "8px",
    background: "rgba(31,35,41,0.88)",
    color: "#fff",
    fontSize: "13px",
    fontWeight: "500",
    zIndex: "2147483647",
    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
    transition: "opacity 0.3s",
    opacity: "1",
    pointerEvents: "none"
  });
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 400);
  }, duration);
}

function setPanelSyncingState(isSyncing, label) {
  const root = document.getElementById(PANEL_ROOT_ID);
  if (!root) return;

  const syncBtn = root.querySelector('[data-action="sync"]');
  const collectBtn = root.querySelector('[data-action="collect"]');
  const shotBtn = root.querySelector('[data-action="shot"]');

  // 管理顶部进度条
  let bar = root.querySelector(".psync-progress-bar");

  if (isSyncing) {
    if (syncBtn) {
      syncBtn.disabled = true;
      syncBtn.style.opacity = "0.85";
      syncBtn.style.pointerEvents = "none";
      syncBtn.innerHTML = `<span style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.7s linear infinite;vertical-align:middle;margin-right:6px"></span>${label || "同步中…"}`;
    }
    if (collectBtn) { collectBtn.disabled = true; collectBtn.style.opacity = "0.5"; }
    if (shotBtn) { shotBtn.disabled = true; shotBtn.style.opacity = "0.5"; }

    if (!bar) {
      bar = document.createElement("div");
      bar.className = "psync-progress-bar";
      Object.assign(bar.style, {
        position: "absolute",
        top: "0",
        left: "0",
        right: "0",
        height: "3px",
        borderRadius: "3px 3px 0 0",
        background: "linear-gradient(90deg, #1664ff, #5b9aff, #1664ff)",
        backgroundSize: "200% 100%",
        animation: "progress-slide 1.2s linear infinite",
        zIndex: "10"
      });
      const panel = root.querySelector(".psync-panel");
      if (panel) {
        panel.style.position = "relative";
        panel.prepend(bar);
      }
    }

    // 注入 keyframes（只注入一次）
    if (!document.getElementById("__psync_keyframes__")) {
      const style = document.createElement("style");
      style.id = "__psync_keyframes__";
      style.textContent = `
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes progress-slide { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
      `;
      document.head.appendChild(style);
    }
  } else {
    if (syncBtn) {
      syncBtn.disabled = false;
      syncBtn.style.opacity = "";
      syncBtn.style.pointerEvents = "";
      syncBtn.textContent = "提交本地";
    }
    if (collectBtn) { collectBtn.disabled = false; collectBtn.style.opacity = ""; }
    if (shotBtn) { shotBtn.disabled = false; shotBtn.style.opacity = ""; }
    if (bar) bar.remove();
  }
}
