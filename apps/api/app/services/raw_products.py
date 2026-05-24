from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.raw_product import RawProduct
from app.schemas.raw_product import RawProductCreate, RawProductUpdate


def _dedupe_urls(items: list[str] | None) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for raw in items or []:
        url = str(raw or "").strip()
        if not url or url in seen:
            continue
        seen.add(url)
        out.append(url)
    return out


def _normalize_image_groups(
    *,
    main_image: str | None,
    main_images: list[str] | None,
    carousel_images: list[str] | None,
    sku_images: list[str] | None,
    detail_images: list[str] | None,
    size_chart_images: list[str] | None,
) -> dict[str, object]:
    normalized_main_images = _dedupe_urls(main_images)
    normalized_carousel_images = _dedupe_urls(carousel_images)
    normalized_sku_images = _dedupe_urls(sku_images)
    normalized_detail_images = _dedupe_urls(detail_images)
    normalized_size_chart_images = _dedupe_urls(size_chart_images)
    normalized_main_image = (main_image or "").strip() or None

    if normalized_main_image and normalized_main_image not in normalized_main_images:
        normalized_main_images.insert(0, normalized_main_image)

    if not normalized_main_image and normalized_main_images:
        normalized_main_image = normalized_main_images[0]

    if not normalized_carousel_images and normalized_main_images:
        normalized_carousel_images = list(normalized_main_images)

    if normalized_main_image and normalized_main_image not in normalized_carousel_images:
        normalized_carousel_images.insert(0, normalized_main_image)

    return {
        "main_image": normalized_main_image,
        "main_images": normalized_main_images,
        "carousel_images": normalized_carousel_images,
        "sku_images": normalized_sku_images,
        "detail_images": normalized_detail_images,
        "size_chart_images": normalized_size_chart_images,
    }


def create_raw_product(session: Session, payload: RawProductCreate) -> RawProduct:
    raw_payload = payload.model_dump(by_alias=True)
    normalized = _normalize_image_groups(
        main_image=payload.main_image,
        main_images=payload.main_images,
        carousel_images=payload.carousel_images,
        sku_images=payload.sku_images,
        detail_images=payload.detail_images,
        size_chart_images=payload.size_chart_images,
    )
    product = RawProduct(
        platform=payload.platform,
        url=payload.url,
        title=payload.title,
        price=payload.price,
        original_price=payload.original_price,
        currency=payload.currency,
        source_id=payload.source_id,
        platform_sku=payload.platform_sku,
        category_path=payload.category_path,
        shop_name=payload.shop_name,
        attributes_text=payload.attributes_text,
        sku_text=payload.sku_text,
        stock=payload.stock,
        collector=payload.collector,
        main_image=normalized["main_image"],
        screenshot_url=payload.screenshot,
        video_url=payload.video_url,
        main_images=normalized["main_images"],
        carousel_images=normalized["carousel_images"],
        sku_images=normalized["sku_images"],
        detail_images=normalized["detail_images"],
        size_chart_images=normalized["size_chart_images"],
        debug_payload=payload.debug,
        raw_payload=raw_payload,
    )
    session.add(product)
    session.commit()
    session.refresh(product)
    return product


def list_raw_products(session: Session, *, limit: int, offset: int) -> tuple[list[RawProduct], int]:
    total = session.scalar(select(func.count()).select_from(RawProduct)) or 0
    items = session.scalars(
        select(RawProduct)
        .order_by(RawProduct.created_at.desc(), RawProduct.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return items, total


def get_raw_product(session: Session, product_id: int) -> RawProduct | None:
    return session.get(RawProduct, product_id)


def delete_raw_product(session: Session, product: RawProduct) -> None:
    session.delete(product)
    session.commit()


def update_raw_product(session: Session, product: RawProduct, payload: RawProductUpdate) -> RawProduct:
    changes = payload.model_dump(exclude_unset=True, by_alias=False)
    alias_changes = payload.model_dump(exclude_unset=True, by_alias=True)
    normalized = _normalize_image_groups(
        main_image=changes["main_image"] if "main_image" in changes else product.main_image,
        main_images=changes["main_images"] if "main_images" in changes else product.main_images,
        carousel_images=changes["carousel_images"] if "carousel_images" in changes else product.carousel_images,
        sku_images=changes["sku_images"] if "sku_images" in changes else product.sku_images,
        detail_images=changes["detail_images"] if "detail_images" in changes else product.detail_images,
        size_chart_images=changes["size_chart_images"] if "size_chart_images" in changes else product.size_chart_images,
    )

    for field in (
        "platform",
        "url",
        "title",
        "price",
        "original_price",
        "currency",
        "source_id",
        "platform_sku",
        "category_path",
        "shop_name",
        "attributes_text",
        "sku_text",
        "stock",
        "collector",
        "video_url",
    ):
        if field in changes:
            setattr(product, field, changes[field])

    product.main_image = normalized["main_image"]
    product.main_images = normalized["main_images"]
    product.carousel_images = normalized["carousel_images"]
    product.sku_images = normalized["sku_images"]
    product.detail_images = normalized["detail_images"]
    product.size_chart_images = normalized["size_chart_images"]

    if "screenshot" in alias_changes:
        product.screenshot_url = alias_changes["screenshot"]

    session.add(product)
    session.commit()
    session.refresh(product)
    return product
