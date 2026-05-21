from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from fastapi import APIRouter

from app.core.config import get_settings
from app.db.session import engine


router = APIRouter(tags=["health"])


@router.get("/health")
def health_check() -> dict[str, object]:
    settings = get_settings()
    database_ok = False

    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        database_ok = True
    except SQLAlchemyError:
        database_ok = False

    return {
        "ok": True,
        "service": settings.app_name,
        "phase": settings.current_phase,
        "database": database_ok,
    }
