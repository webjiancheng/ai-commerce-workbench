/**
 * 平台特定的商品采集逻辑
 * 为各个电商平台提供定制化的数据提取函数
 */

// ============= 1688 采集逻辑 =============

function collect1688MainImages() {
  const urls = collectImagesFromSelectors([
    ".detail-gallery",
    ".nav-image-list",
    ".vertical-img",
    ".image-viewer-wrap",
    ".tab-trigger"
  ]);
  const scriptImages = extract1688ImagesFromScripts();
  return uniqueImages([...urls, ...scriptImages].filter(is1688ProductImage));
}

function collect1688SkuImages() {
  const urls = [];
  const containers = document.querySelectorAll(
    ".sku-prop, .prop-item, .sku-item-wrapper, .sku-wrapper, .obj-sku, [class*='skuProp'], [class*='prop-item']"
  );

  for (const container of containers) {
    for (const img of container.querySelectorAll("img")) {
      urls.push(...imageUrlsFromNode(img));
    }
  }

  const scriptImages = extract1688SkuImagesFromScripts();
  return uniqueImages([...urls, ...scriptImages].filter(is1688ProductImage));
}

function collect1688DetailImages() {
  const urls = [];

  urls.push(...collectImagesFromSelectors([
    ".detail-content",
    ".desc-lazyload-container",
    ".offer-detail-description",
    "#mod-detail-description",
    ".detail-img-list"
  ]));

  for (const script of document.querySelectorAll("script")) {
    const text = script.textContent || "";
    const matches = [
      ...(text.match(/https?:\/\/cbu01\.alicdn\.com\/img\/ibank[^"'\s<]+/gi) || []),
      ...(text.match(/https?:\/\/(?:gw|img)\.alicdn\.com\/imgextra[^"'\s<]+\.(?:jpg|jpeg|png|webp)/gi) || [])
    ];
    urls.push(...matches);
  }

  return uniqueImages(
    urls
      .map(normalizeUrl)
      .filter(is1688DetailImage)
  );
}

function extract1688ImagesFromScripts() {
  const urls = [];
  const patterns = [
    /https?:\/\/cbu01\.alicdn\.com\/img\/ibank[^"'\s<]+/ig,
    /https?:\/\/(?:gw|img)\.alicdn\.com\/imgextra[^"'\s<]+\.(?:jpg|jpeg|png|webp)(?:\?[^"'\s<]+)?/ig
  ];

  for (const script of Array.from(document.scripts || [])) {
    const text = script.textContent || "";
    if (!text || text.length < 80) continue;
    const slice = text.length > 220000 ? text.slice(0, 220000) : text;
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(slice))) {
        const url = normalizeUrl(match[0]);
        if (url) urls.push(url);
        if (urls.length > 80) break;
      }
      if (urls.length > 80) break;
    }
    if (urls.length > 80) break;
  }

  return uniqueImages(urls);
}

function extract1688SkuImagesFromScripts() {
  const urls = [];
  const patterns = [
    /\"(?:bigPicUrl|imageUrl|imageUrlOriginal|skuProps|propertyPicUrl|propPicUrl)\"\s*:\s*\"(https?:\/\/[^\"\\]+)\"/ig,
    /[\"'](https?:\/\/[^\"'\\]+\.(?:jpg|jpeg|png|webp))[\"']/ig,
    /'(https?:\/\/[^'\\]+)'/ig
  ];

  for (const script of Array.from(document.scripts || [])) {
    const text = script.textContent || "";
    if (!text || text.length < 200) continue;
    if (!/skuMap|skuProps|skuProp|sku/i.test(text)) continue;
    const slice = text.length > 220000 ? text.slice(0, 220000) : text;
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(slice))) {
        const url = normalizeUrl(match[1] || match[0]);
        if (url && isUsefulImage(url)) urls.push(url);
        if (urls.length > 80) break;
      }
      if (urls.length > 80) break;
    }
    if (urls.length > 80) break;
  }

  return uniqueImages(urls);
}

function is1688ProductImage(url) {
  const value = String(url || "");
  if (!/^https?:\/\//i.test(value)) return false;
  if (!/\.(jpg|jpeg|png|webp|gif|avif)(?:[?#].*)?$/i.test(value)) return false;

  if (!/alicdn\.com\//i.test(value)) return false;

  if (/(?:^|[\/_-])(logo|icon|icons|sprite|avatar)(?:[\/_-]|$)/i.test(value)) return false;
  if (/-tps-(?:32|48|50|60|64|80|96|100)-(?:32|48|50|60|64|80|96|100)\.(?:png|jpg|jpeg|webp)/i.test(value)) return false;
  if (/\/tps\//i.test(value)) return false;

  return true;
}

function is1688DetailImage(url) {
  if (!is1688ProductImage(url)) return false;
  if (/img\.taobao\.com/i.test(url)) return false;
  if (/NewGualianyingxiao|startFlag|endFlag/i.test(url)) return false;
  return true;
}

// ============= Temu 采集逻辑 =============

function refineTemuMedia({ mainImages, skuImages, detailImages }) {
  const main = prioritizeTemuGallery(mainImages.filter(isTemuPrimaryGalleryImage));
  const sku = prioritizeTemuGallery(skuImages.filter(isTemuSkuImage));
  const detail = prioritizeTemuDetailImages(detailImages.filter(isTemuDetailImage));

  return {
    mainImages: main,
    skuImages: sku,
    detailImages: detail
  };
}

function prioritizeTemuGallery(urls) {
  return uniqueImages(urls)
    .sort((left, right) => scoreTemuGalleryUrl(right) - scoreTemuGalleryUrl(left))
    .slice(0, 12);
}

function prioritizeTemuDetailImages(urls) {
  return uniqueImages(urls)
    .sort((left, right) => scoreTemuDetailUrl(right) - scoreTemuDetailUrl(left))
    .slice(0, 24);
}

function scoreTemuGalleryUrl(url) {
  let score = 0;
  // 新版详情页常见：local-goods-image（高分辨率主图）
  if (/img\.kwcdn\.com\/local-goods-image\//i.test(url)) score += 12;
  if (/product\/open\/.+-goods\.(?:jpeg|jpg)$/i.test(url)) score += 10;
  if (/product\/fancy\//i.test(url)) score += 5;
  if (/algo_check/i.test(url)) score -= 5;
  return score;
}

function scoreTemuDetailUrl(url) {
  let score = 0;
  if (/product\/fancy\//i.test(url)) score += 8;
  if (/product\/open\/.+-goods\.(?:jpeg|jpg)$/i.test(url)) score += 5;
  return score;
}

function isTemuPrimaryGalleryImage(url) {
  if (isTemuUiImage(url)) return false;
  if (/img\.kwcdn\.com\/product\/algo_check\//i.test(url)) return false;
  if (/img\.kwcdn\.com\/local-goods-image\//i.test(url)) return true;
  if (/img\.kwcdn\.com\/product\/open\/.+-goods\.(?:jpeg|jpg)$/i.test(url)) return true;
  if (/img\.kwcdn\.com\/product\/fancy\//i.test(url)) return true;
  return false;
}

function isTemuSkuImage(url) {
  if (isTemuUiImage(url)) return false;
  // `goods_details` on Temu is much more often long-detail material than SKU swatch.
  // Classifying it as SKU causes detail images to be deduped away downstream.
  if (/upload_aimg\/goods_details\//i.test(url)) return false;
  if (/upload_aimg\/kolplay\//i.test(url)) return false;
  // 有些商品 SKU 图直接复用 local-goods-image
  if (/img\.kwcdn\.com\/local-goods-image\//i.test(url)) return true;
  if (/img\.kwcdn\.com\/product\/open\/.+-goods\.(?:jpeg|jpg)$/i.test(url)) return true;
  if (/img\.kwcdn\.com\/product\/fancy\//i.test(url)) return true;
  return false;
}

function isTemuDetailImage(url) {
  if (/upload_aimg\/goods_details\//i.test(url)) return true;
  if (isTemuUiImage(url)) return false;
  if (/aimg\.kwcdn\.com\/material-put\//i.test(url)) return true;
  return false;
}

function isTemuUiImage(url) {
  return /tree-selector|upload_aimg_b\/web\/pc|upload_aimg\/pc\/|upload_aimg\/dawn\/|upload_aimg\/pho\/|upload_aimg\/kolplay\/|\/web\/pc\/|\/nav\/|\/menu\/|\/icon\/|\/icons\/|\/badge\/|goods-icon\/|avatar|logo|sprite|placeholder|thumbnailoverlay|play-button|coupon|trustmark|algo_check|cart\//i.test(url);
}
