from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    database_url: str = "postgresql+asyncpg://admin:change-me-local-postgres-password@postgres:5432/bff_rag"
    redis_url: str = "redis://redis:6379"
    ollama_url: str = "http://ollama:11434"
    embed_model: str = "nomic-embed-text"
    llm_model: str = "llama3.1:8b"
    fast_llm_model: str | None = None
    llm_timeout_seconds: float = 120.0
    llm_num_predict: int = 256
    llm_temperature: float = 0.2
    llm_keep_alive: str = "10m"
    embed_dims: int = 768
    cache_threshold: float = 0.92
    cache_ttl: int = 3600
    cache_lookup_max_candidates: int = 25
    top_k_retrieve: int = 8
    top_k_rerank: int = 3
    rerank_direct_hit_threshold: float = 0.85
    query_history_limit: int = 4
    query_max_context_tokens: int = 1024
    query_max_history_tokens: int = 256
    query_max_context_chars: int = 2400
    query_max_history_chars: int = 800
    rerank_min_candidates: int = 5
    embed_batch_size: int = 16
    ingest_job_ttl: int = 3600


settings = Settings()
