from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field
from app.core.task_status import GenerationMode


class ScreenshotUploadIn(BaseModel):
    product_id: str = Field(alias="productId", min_length=1)
    data_url: str = Field(alias="dataUrl", min_length=1)

    model_config = ConfigDict(populate_by_name=True)


class RawProductCreate(BaseModel):
    platform: str | None = None
    url: str
    title: str
    price: str | None = None
    original_price: str | None = Field(default=None, alias="originalPrice")
    currency: str | None = None
    source_id: str | None = Field(default=None, alias="sourceId")
    platform_sku: str | None = Field(default=None, alias="platformSku")
    category_path: str | None = Field(default=None, alias="categoryPath")
    shop_name: str | None = Field(default=None, alias="shopName")
    attributes_text: str | None = Field(default=None, alias="attributesText")
    sku_text: str | None = Field(default=None, alias="skuText")
    sku_props: list[dict] = Field(default_factory=list, alias="skuProps")
    stock: str | None = None
    collector: str | None = None
    main_image: str | None = Field(default=None, alias="mainImage")
    screenshot: str | None = None
    video_url: str | None = Field(default=None, alias="videoUrl")
    main_images: list[str] = Field(default_factory=list, alias="mainImages")
    carousel_images: list[str] = Field(default_factory=list, alias="carouselImages")
    sku_images: list[str] = Field(default_factory=list, alias="skuImages")
    detail_images: list[str] = Field(default_factory=list, alias="detailImages")
    size_chart_images: list[str] = Field(default_factory=list, alias="sizeChartImages")
    debug: dict = Field(default_factory=dict)

    model_config = ConfigDict(populate_by_name=True, extra="allow")


class RawProductUpdate(BaseModel):
    platform: str | None = None
    url: str | None = None
    title: str | None = None
    price: str | None = None
    original_price: str | None = Field(default=None, alias="originalPrice")
    currency: str | None = None
    source_id: str | None = Field(default=None, alias="sourceId")
    platform_sku: str | None = Field(default=None, alias="platformSku")
    category_path: str | None = Field(default=None, alias="categoryPath")
    shop_name: str | None = Field(default=None, alias="shopName")
    attributes_text: str | None = Field(default=None, alias="attributesText")
    sku_text: str | None = Field(default=None, alias="skuText")
    sku_props: list[dict] | None = Field(default=None, alias="skuProps")
    stock: str | None = None
    collector: str | None = None
    main_image: str | None = Field(default=None, alias="mainImage")
    screenshot: str | None = None
    video_url: str | None = Field(default=None, alias="videoUrl")
    main_images: list[str] | None = Field(default=None, alias="mainImages")
    carousel_images: list[str] | None = Field(default=None, alias="carouselImages")
    sku_images: list[str] | None = Field(default=None, alias="skuImages")
    detail_images: list[str] | None = Field(default=None, alias="detailImages")
    size_chart_images: list[str] | None = Field(default=None, alias="sizeChartImages")

    model_config = ConfigDict(populate_by_name=True, extra="allow")


class RawProductListItem(BaseModel):
    id: int
    platform: str | None
    title: str
    price: str | None
    platform_sku: str | None
    source_id: str | None
    collector: str | None
    screenshot_url: str | None
    main_image: str | None
    carousel_images: list[str] = Field(default_factory=list)
    sku_images: list[str] = Field(default_factory=list)
    detail_images: list[str] = Field(default_factory=list)
    size_chart_images: list[str] = Field(default_factory=list)
    image_count: int = 0
    sku_count: int = 0
    task_id: int | None = None
    task_created: bool = False
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RawProductDetail(BaseModel):
    id: int
    platform: str | None
    url: str
    title: str
    price: str | None
    original_price: str | None
    currency: str | None
    source_id: str | None
    platform_sku: str | None
    category_path: str | None
    shop_name: str | None
    attributes_text: str | None
    sku_text: str | None
    sku_props: list[dict] = Field(default_factory=list, validation_alias="sku_props_json")
    stock: str | None
    collector: str | None
    main_image: str | None
    screenshot_url: str | None
    video_url: str | None
    main_images: list[str]
    carousel_images: list[str]
    sku_images: list[str]
    detail_images: list[str]
    size_chart_images: list[str]
    task_id: int | None = None
    task_created: bool = False
    debug_payload: dict
    raw_payload: dict
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RawProductListResponse(BaseModel):
    items: list[RawProductListItem]
    total: int
    limit: int
    offset: int


class RawProductBatchCreateTasksIn(BaseModel):
    raw_product_ids: list[int] = Field(default_factory=list)
    split_count: int = Field(default=1, ge=1, le=50)
    generation_mode: GenerationMode = GenerationMode.title_and_4grid
    include_product_info: bool = True


class RawProductBatchDeleteIn(BaseModel):
    raw_product_ids: list[int] = Field(default_factory=list)
