from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # ========= 必填密钥项 =========
    ZHIPU_API_KEY: str
    LLM_MODEL: str

    # ========= 带默认值配置 =========
    ZHIPU_BASE_URL: str = "https://open.bigmodel.cn/api/paas/v4"
    APP_ENV: str = "development"
    DEBUG: bool = True
    SERVER_PORT: int = 8000
    FRONTEND_URL: str = "http://localhost:5173"

    BUCKET_ROOT: str = "./bucket"
    MAX_UPLOAD_SIZE: int = 10485760

    LLM_TEMPERATURE: float = 0.3
    LLM_MAX_TOKENS: int = 4096
    LOG_LEVEL: str = "INFO"

    # ========= Redis双模式配置 =========
    # 云端优先：REDIS_URL不为空，优先连接Upstash云端
    REDIS_URL: Optional[str] = None
    # 本地兜底默认值
    REDIS_HOST: str = "127.0.0.1"
    REDIS_PORT: int = 6379
    REDIS_PASSWORD: Optional[str] = None
    REDIS_DB: int = 0


settings = Settings()
