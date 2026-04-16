export type AskFilters = {
  source?: string;
  category?: string;
  title_contains?: string;
};

export type AppSession = {
  accessToken: string;
  userId: string;
  tenantId: string;
  roles: string[];
  createdAt: string;
};

export type CacheStats = {
  cached_entries: number;
};

export type MetricsSummary = {
  total_queries: number;
  cache_hits: number;
  cache_misses: number;
  cache_hit_rate: number;
  total_ingest_requests: number;
  total_chunks_ingested: number;
  skipped_duplicates: number;
};

export type Citation = {
  chunk_id: string;
  source: string;
  title: string;
  chunk_index: number;
  excerpt: string;
};

export type ConversationTurn = {
  role: string;
  content: string;
  created_at: string;
};

export type AdminChunk = {
  chunk_id: string;
  source: string;
  title: string;
  category?: string;
  chunk_index: number;
  excerpt: string;
  created_at: string;
  content_hash?: string;
};

export type AdminOverview = {
  metrics: MetricsSummary;
  cached_entries: number;
  total_chunks: number;
  total_conversations: number;
};

export type RagAnswer = {
  answer: string;
  cache_hit: boolean;
  chunks_used: string[];
  history_used: number;
  citations: Citation[];
};

export type IngestJobQueued = {
  job_id: string;
  status: string;
};

export type IngestJobStatus = {
  job_id: string;
  status: string;
  user_id: string;
  tenant_id: string;
  source: string;
  submitted_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  inserted_chunks: number;
  skipped_duplicates: number;
  error?: string | null;
};

export type IssueTokenResponse = {
  access_token: string;
};
