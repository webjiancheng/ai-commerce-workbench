from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet

from app.core.config import get_settings


def _derive_fernet_key(secret: str) -> bytes:
    """
    Derive a stable Fernet key from a human-provided secret string.
    Fernet requires a 32-byte urlsafe base64 key.
    """
    digest = hashlib.sha256(secret.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


def get_fernet() -> Fernet:
    settings = get_settings()
    if not settings.settings_secret_key:
        raise RuntimeError("Missing AI_CAIJI_SETTINGS_SECRET_KEY for encrypting secrets")
    return Fernet(_derive_fernet_key(settings.settings_secret_key))


def has_settings_secret_key() -> bool:
    settings = get_settings()
    return bool((settings.settings_secret_key or "").strip())


def encrypt_secret(plaintext: str) -> str:
    f = get_fernet()
    return f.encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt_secret(ciphertext: str) -> str:
    f = get_fernet()
    return f.decrypt(ciphertext.encode("utf-8")).decode("utf-8")


def mask_secret(value: str, *, keep_last: int = 4) -> str:
    v = value or ""
    tail = v[-keep_last:] if len(v) >= keep_last else v
    return f"****{tail}" if tail else "****"
