from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "AI Listing Workbench API"
    app_version: str = "0.1.0"
    current_phase: str = "phase-5"
    database_url: str = "postgresql+psycopg:///ai_caiji"
    public_base_url: str = "http://127.0.0.1:8000"
    storage_root: str = str(Path(__file__).resolve().parents[4] / "storage")
    screenshot_dir_name: str = "screenshots"
    exports_dir_name: str = "exports"
    default_export_template_path: str = str(
        Path(__file__).resolve().parents[4] / "妙手Temu导入模板-非服饰类模板 .xlsx"
    )
    openai_api_key: str | None = None
    openai_model: str = "gpt-4o-2024-08-06"
    openai_vision_model: str = "gpt-4.1-mini"
    settings_secret_key: str | None = None
    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://127.0.0.1:3000",
            "http://localhost:3000",
        ]
    )

    model_config = SettingsConfigDict(
        env_prefix="AI_CAIJI_",
        env_file=".env",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
