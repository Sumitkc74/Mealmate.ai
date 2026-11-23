"""Application configuration loaded from environment variables."""

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Strongly-typed settings sourced from `.env` and process env."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    env: str = Field(default="development")
    host: str = Field(default="0.0.0.0")
    port: int = Field(default=8000)
    log_level: str = Field(default="INFO")

    model_path: Path = Field(default=Path("./models/recommender.pkl"))
    data_path: Path = Field(default=Path("./data/recipes.csv"))

    allowed_origins: str = Field(default="http://localhost:3000,http://localhost:5000")

    # Shared secret the Express server sends as X-AI-Service-Key. When set,
    # every route except /health (and docs) requires it; when unset (local
    # dev only) requests are allowed with a warning. Production must set it.
    ai_service_key: str = Field(default="")

    @property
    def origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
