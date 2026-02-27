from enum import StrEnum
from pydantic_settings import BaseSettings, SettingsConfigDict


class StorageBackend(StrEnum):
    LOCAL_FS = "local_fs"
    S3 = "s3"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database
    database_url: str

    # Redis / queue
    redis_url: str = "redis://localhost:6379"

    # Storage
    storage_adapter: StorageBackend = StorageBackend.LOCAL_FS
    local_fs_root: str = "./data/knowledge"
    s3_bucket: str = ""
    s3_region: str = "ap-southeast-1"

    # LLM providers (at least one required)
    openai_api_key: str = ""
    anthropic_api_key: str = ""
    default_model: str = "openai/gpt-4o"

    # Auth
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7  # 7 days

    # Notifications
    telegram_bot_token: str = ""
    sendgrid_api_key: str = ""
    email_from: str = "noreply@knotwork.io"

    # Knowledge health thresholds (workspace defaults)
    token_count_min: int = 300
    token_count_max: int = 6000

    # Run defaults
    confidence_threshold_default: float = 0.70
    retry_limit_default: int = 2
    escalation_timeout_hours_default: int = 24


settings = Settings()  # type: ignore[call-arg]
