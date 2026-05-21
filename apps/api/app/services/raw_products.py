from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.raw_product import RawProduct
from app.schemas.raw_product import RawProductCreate, RawProductUpdate


def create_raw_product(session: Session, payload: RawProductCreate) -> RawProduct:
    raw_payload = payload.model_dump(by_alias=True)
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
        main_image=payload.main_image,
        screenshot_url=payload.screenshot,
        video_url=payload.video_url,
        main_images=payload.main_images,
        carousel_images=payload.carousel_images,
        sku_images=payload.sku_images,
        detail_images=payload.detail_images,
        size_chart_images=payload.size_chart_images,
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
        "main_image",
        "video_url",
        "main_images",
        "carousel_images",
        "sku_images",
        "detail_images",
        "size_chart_images",
    ):
        if field in changes:
            setattr(product, field, changes[field])

    if "screenshot" in alias_changes:
        product.screenshot_url = alias_changes["screenshot"]

    session.add(product)
    session.commit()
    session.refresh(product)
    return product
