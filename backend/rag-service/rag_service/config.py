from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    database_url: str = "postgresql+asyncpg://admin:change-me-local-postgres-password@postgres:5432/bff_rag"
    redis_url: str = "redis://redis:6379"
    ollama_url: str = "http://ollama:11434"
    embed_model: str = "nomic-embed-text"
    llm_model: str = "llama3.1:8b"
    embed_dims: int = 768
    cache_threshold: float = 0.92
    cache_ttl: int = 3600
    top_k_retrieve: int = 20
    top_k_rerank: int = 5
    ingest_job_ttl: int = 3600


settings = Settings()
