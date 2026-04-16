import { getBffBaseUrl } from './config';
import type {
  AdminChunk,
  AdminOverview,
  AppSession,
  AskFilters,
  CacheStats,
  ConversationTurn,
  IngestJobQueued,
  IngestJobStatus,
  IssueTokenResponse,
  RagAnswer,
} from './types';
import { graphqlRequest } from './graphql';

export async function issueToken(input: {
  user_id: string;
  tenant_id: string;
  roles: string[];
}): Promise<IssueTokenResponse> {
  const response = await fetch(`${getBffBaseUrl()}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  const payload = (await response.json()) as IssueTokenResponse | { message?: string };
  if (!response.ok || !('access_token' in payload)) {
    throw new Error(('message' in payload && payload.message) || 'Failed to issue token');
  }

  return payload;
}

export async function fetchConversationHistory(session: AppSession, limit = 8): Promise<ConversationTurn[]> {
  const data = await graphqlRequest<{ conversationHistory: ConversationTurn[] }>(
    `query ConversationHistory($limit: Int!) {
      conversationHistory(limit: $limit) {
        role
        content
        created_at
      }
    }`,
    { limit },
    session.accessToken,
  );

  return data.conversationHistory;
}

export async function askQuestion(
  session: AppSession,
  query: string,
  filters?: AskFilters,
): Promise<RagAnswer> {
  const data = await graphqlRequest<{ ask: RagAnswer }>(
    `query Ask($query: String!, $filters: AskFiltersInput) {
      ask(query: $query, filters: $filters) {
        answer
        cache_hit
        chunks_used
        history_used
        citations {
          chunk_id
          source
          title
          chunk_index
          excerpt
        }
      }
    }`,
    { query, filters: normalizeOptionalFilters(filters) },
    session.accessToken,
  );

  return data.ask;
}

export async function fetchOverview(session: AppSession): Promise<AdminOverview> {
  const data = await graphqlRequest<{ adminOverview: AdminOverview }>(
    `query AdminOverview {
      adminOverview {
        cached_entries
        total_chunks
        total_conversations
        metrics {
          total_queries
          cache_hits
          cache_misses
          cache_hit_rate
          total_ingest_requests
          total_chunks_ingested
          skipped_duplicates
        }
      }
    }`,
    {},
    session.accessToken,
  );

  return data.adminOverview;
}

export async function fetchCacheStats(session: AppSession): Promise<CacheStats> {
  const data = await graphqlRequest<{ cacheStats: CacheStats }>(
    `query CacheStats {
      cacheStats {
        cached_entries
      }
    }`,
    {},
    session.accessToken,
  );

  return data.cacheStats;
}

export async function fetchAdminChunks(
  session: AppSession,
  limit = 8,
  filters?: AskFilters,
): Promise<AdminChunk[]> {
  const data = await graphqlRequest<{ adminChunks: AdminChunk[] }>(
    `query AdminChunks($limit: Int!, $filters: AskFiltersInput) {
      adminChunks(limit: $limit, filters: $filters) {
        chunk_id
        source
        title
        category
        chunk_index
        excerpt
        created_at
        content_hash
      }
    }`,
    { limit, filters: normalizeOptionalFilters(filters) },
    session.accessToken,
  );

  return data.adminChunks;
}

export async function queueIngest(
  session: AppSession,
  input: {
    source?: string;
    documents: Array<{
      title: string;
      content: string;
      category?: string;
      metadata_json?: string;
    }>;
    files: Array<{
      filename: string;
      content_base64: string;
      title?: string;
      category?: string;
      content_type?: string;
      metadata_json?: string;
    }>;
  },
): Promise<IngestJobQueued> {
  const data = await graphqlRequest<{ adminIngest: IngestJobQueued }>(
    `mutation AdminIngest($input: AdminIngestInput!) {
      adminIngest(input: $input) {
        job_id
        status
      }
    }`,
    { input },
    session.accessToken,
  );

  return data.adminIngest;
}

export async function fetchIngestJob(
  session: AppSession,
  jobId: string,
): Promise<IngestJobStatus> {
  const data = await graphqlRequest<{ adminIngestJob: IngestJobStatus }>(
    `query AdminIngestJob($jobId: String!) {
      adminIngestJob(job_id: $jobId) {
        job_id
        status
        user_id
        tenant_id
        source
        submitted_at
        started_at
        finished_at
        inserted_chunks
        skipped_duplicates
        error
      }
    }`,
    { jobId },
    session.accessToken,
  );

  return data.adminIngestJob;
}

export async function streamAnswer(
  session: AppSession,
  query: string,
  filters: AskFilters | undefined,
  handlers: {
    onToken: (token: string) => void;
    onDone: () => void;
  },
): Promise<void> {
  const search = new URLSearchParams({ query });
  if (filters?.source) {
    search.set('source', filters.source);
  }
  if (filters?.category) {
    search.set('category', filters.category);
  }
  if (filters?.title_contains) {
    search.set('title_contains', filters.title_contains);
  }

  const response = await fetch(`${getBffBaseUrl()}/rag/stream?${search.toString()}`, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Stream failed with status ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let streamDone = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    while (buffer.includes('\n\n')) {
      const boundary = buffer.indexOf('\n\n');
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      streamDone = consumeSseChunk(rawEvent, handlers) || streamDone;
    }
  }

  if (!streamDone) {
    handlers.onDone();
  }
}

function consumeSseChunk(
  rawEvent: string,
  handlers: {
    onToken: (token: string) => void;
    onDone: () => void;
  },
): boolean {
  if (!rawEvent.trim()) {
    return false;
  }

  const lines = rawEvent.split('\n');
  let eventName = 'message';
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trim());
    }
  }

  if (eventName === 'done') {
    handlers.onDone();
    return true;
  }

  if (eventName === 'error') {
    const detail = dataLines.join('\n') || 'Unknown stream error';
    throw new Error(detail);
  }

  const rawData = dataLines.join('\n');
  if (!rawData) {
    return false;
  }

  try {
    const payload = JSON.parse(rawData) as { token?: string };
    if (payload.token) {
      handlers.onToken(payload.token);
    }
  } catch {
    handlers.onToken(rawData);
  }

  return false;
}

function normalizeOptionalFilters(filters?: AskFilters): AskFilters | undefined {
  if (!filters) {
    return undefined;
  }

  const nextFilters: AskFilters = {};
  if (filters.source?.trim()) {
    nextFilters.source = filters.source.trim();
  }
  if (filters.category?.trim()) {
    nextFilters.category = filters.category.trim();
  }
  if (filters.title_contains?.trim()) {
    nextFilters.title_contains = filters.title_contains.trim();
  }

  return Object.keys(nextFilters).length > 0 ? nextFilters : undefined;
}
