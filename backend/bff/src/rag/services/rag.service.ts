import { BadRequestException, Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../auth';
import { AdminIngestInput } from '../graphql/inputs/admin-ingest.input';
import { AskFiltersInput } from '../graphql/inputs/ask-filters.input';
import {
  AdminChunk,
  AdminOverview,
  CacheStats,
  ConversationTurn,
  IngestJobQueued,
  IngestJobStatus,
  MetricsSummary,
  RagAnswer,
} from '../graphql/models/rag.models';
import { RagRateLimitService } from './rag-rate-limit.service';
import { RagUpstreamService } from './rag-upstream.service';

@Injectable()
export class RagService {
  constructor(
    private readonly ragRateLimitService: RagRateLimitService,
    private readonly ragUpstreamService: RagUpstreamService,
  ) {}

  async cacheStats(): Promise<CacheStats> {
    return this.ragUpstreamService.get('cacheStats', '/cache/stats', {
      failureDetail: 'Failed to reach RAG service for cache stats',
    });
  }

  async metricsSummary(): Promise<MetricsSummary> {
    return this.ragUpstreamService.get(
      'metricsSummary',
      '/metrics/summary',
      { failureDetail: 'Failed to reach RAG service for metrics summary' },
    );
  }

  async history(user: AuthenticatedUser, limit = 10): Promise<ConversationTurn[]> {
    this.ragRateLimitService.enforce(user, 'history');
    const search = new URLSearchParams({
      user_id: user.userId,
      tenant_id: user.tenantId,
      limit: String(limit),
    });

    const payload = await this.ragUpstreamService.get<{ turns: ConversationTurn[] }>(
      'history',
      `/history?${search.toString()}`,
      {
        failureDetail: 'Failed to reach RAG service for conversation history',
        user,
      },
    );

    return payload.turns;
  }

  async adminOverview(user: AuthenticatedUser): Promise<AdminOverview> {
    this.ragRateLimitService.enforce(user, 'admin');
    const search = new URLSearchParams({
      user_id: user.userId,
      tenant_id: user.tenantId,
    });

    return this.ragUpstreamService.get(
      'adminOverview',
      `/admin/overview?${search.toString()}`,
      {
        failureDetail: 'Failed to reach RAG service for admin overview',
        user,
      },
    );
  }

  async adminChunks(
    user: AuthenticatedUser,
    limit = 10,
    filters?: AskFiltersInput,
  ): Promise<AdminChunk[]> {
    this.ragRateLimitService.enforce(user, 'admin');
    const search = this.createSearchParams(user, limit, filters);

    return this.ragUpstreamService.get(
      'adminChunks',
      `/admin/chunks?${search.toString()}`,
      {
        failureDetail: 'Failed to reach RAG service for admin chunks',
        user,
      },
    );
  }

  async adminIngest(user: AuthenticatedUser, input: AdminIngestInput): Promise<IngestJobQueued> {
    this.ragRateLimitService.enforce(user, 'admin');

    return this.ragUpstreamService.postJson(
      'adminIngest',
      '/admin/ingest/jobs',
      {
        user_id: user.userId,
        tenant_id: user.tenantId,
        source: input.source ?? 'manual',
        documents: input.documents.map((document) => ({
          title: document.title,
          content: document.content,
          ...(document.category ? { category: document.category } : {}),
          metadata: this.parseMetadataJson(document.metadata_json, 'document'),
        })),
        files: input.files.map((file) => ({
          filename: file.filename,
          content_base64: file.content_base64,
          ...(file.title ? { title: file.title } : {}),
          ...(file.category ? { category: file.category } : {}),
          ...(file.content_type ? { content_type: file.content_type } : {}),
          metadata: this.parseMetadataJson(file.metadata_json, `file '${file.filename}'`),
        })),
      },
      {
        failureDetail: 'Failed to reach RAG service for admin ingest',
        user,
      },
    );
  }

  async adminIngestJobStatus(jobId: string): Promise<IngestJobStatus> {
    return this.ragUpstreamService.get(
      'adminIngestJobStatus',
      `/admin/ingest/jobs/${encodeURIComponent(jobId)}`,
      {
        failureDetail: 'Failed to reach RAG service for ingest job status',
      },
    );
  }

  async query(user: AuthenticatedUser, query: string, filters?: AskFiltersInput): Promise<RagAnswer> {
    this.ragRateLimitService.enforce(user, 'query');

    return this.ragUpstreamService.postJson(
      'query',
      '/query',
      this.createQueryPayload(user, query, false, filters),
      {
        failureDetail: 'Failed to reach RAG service for query execution',
        user,
      },
    );
  }

  async streamQuery(user: AuthenticatedUser, query: string, filters?: AskFiltersInput): Promise<Response> {
    this.ragRateLimitService.enforce(user, 'stream');

    return this.ragUpstreamService.postStream(
      'streamQuery',
      '/query',
      this.createQueryPayload(user, query, true, filters),
      {
        failureDetail: 'Failed to reach RAG service for streaming query execution',
        user,
      },
    );
  }

  private createSearchParams(
    user: AuthenticatedUser,
    limit: number,
    filters?: AskFiltersInput,
  ): URLSearchParams {
    const search = new URLSearchParams({
      user_id: user.userId,
      tenant_id: user.tenantId,
      limit: String(limit),
    });

    if (filters?.source) {
      search.set('source', filters.source);
    }
    if (filters?.category) {
      search.set('category', filters.category);
    }
    if (filters?.title_contains) {
      search.set('title_contains', filters.title_contains);
    }

    return search;
  }

  private createQueryPayload(
    user: AuthenticatedUser,
    query: string,
    stream: boolean,
    filters?: AskFiltersInput,
  ): Record<string, string | boolean> {
    return {
      user_id: user.userId,
      tenant_id: user.tenantId,
      query,
      stream,
      ...(filters?.source ? { source: filters.source } : {}),
      ...(filters?.category ? { category: filters.category } : {}),
      ...(filters?.title_contains ? { title_contains: filters.title_contains } : {}),
    };
  }

  private parseMetadataJson(
    metadataJson: string | undefined,
    label: string,
  ): Record<string, unknown> {
    if (!metadataJson) {
      return {};
    }

    try {
      const parsed = JSON.parse(metadataJson) as unknown;
      if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
        throw new Error('Metadata must be an object');
      }
      return parsed as Record<string, unknown>;
    } catch {
      throw new BadRequestException(`Invalid metadata_json for ${label}`);
    }
  }
}
