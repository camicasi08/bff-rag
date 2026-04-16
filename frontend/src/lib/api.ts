import { getBffBaseUrl } from './config';
import type {
  AppSession,
  AskFilters,
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
