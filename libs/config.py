from enum import StrEnum
from urllib.parse import urlparse
from pydantic_settings import BaseSettings, SettingsConfigDict


class StorageBackend(StrEnum):
    LOCAL_FS = "local_fs"
    S3 = "s3"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=[".env", "../.env"], extra="ignore")

    # Database
    database_url: str
    # Sync connection string for LangGraph AsyncPostgresSaver (strip +asyncpg).
    # If unset, engine falls back to MemorySaver.
    database_url_sync: str = ""

    # Redis / queue
    redis_url: str = "redis://localhost:6379"

    # Storage
    storage_adapter: StorageBackend = StorageBackend.LOCAL_FS
    local_fs_root: str = "./data/knowledge"
    s3_bucket: str = ""
    s3_region: str = "ap-southeast-1"

    # Workflow defaults
    default_model: str = "human"

    # Auth
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7  # 7 days

    # Notifications
    telegram_bot_token: str = ""
    resend_api: str = ""              # env var: RESEND_API
    email_from: str = "noreply@knotwork.io"

    # Frontend URL used in magic link / invite emails and public pages.
    frontend_url: str = "http://localhost:3000"
    # Canonical externally reachable backend URL for backend-only absolute URLs
    # such as attachment downloads.
    backend_url: str = "http://localhost:8000"
    # Dev-only: if set, all requests authenticate as this user UUID without JWT.
    # Leave empty in production.
    auth_dev_bypass_user_id: str = ""

    # Knowledge health thresholds (workspace defaults)
    token_count_min: int = 300
    token_count_max: int = 6000

    # Run defaults
    confidence_threshold_default: float = 0.70
    retry_limit_default: int = 2
    escalation_timeout_hours_default: int = 24

    @property
    def is_local_app(self) -> bool:
        host = (urlparse(self.frontend_url).hostname or "").lower()
        return host in {"localhost", "127.0.0.1", "::1"}

    @property
    def email_delivery_enabled(self) -> bool:
        return bool(self.resend_api.strip()) and bool(self.email_from.strip())

    @property
    def invitations_enabled(self) -> bool:
        return self.email_delivery_enabled

    @property
    def normalized_frontend_url(self) -> str:
        return self.frontend_url.rstrip("/")

    @property
    def normalized_backend_url(self) -> str:
        return self.backend_url.rstrip("/")


settings = Settings()  # type: ignore[call-arg]
