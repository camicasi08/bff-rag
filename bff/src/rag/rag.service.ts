import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AuthenticatedUser } from '../auth';
import type { AskFilters } from './dto/ask-filters.input';
import {
  AdminChunk,
  AdminOverview,
  CacheStats,
  ConversationTurn,
  MetricsSummary,
  RagAnswer,
} from './models/rag.models';

type RateLimitPolicy = {
  limit: number;
  windowMs: number;
};

type RateLimitedOperation = 'query' | 'stream' | 'history' | 'admin';

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);
  private readonly rateLimitBuckets = new Map<string, number[]>();
  private readonly baseUrl: string;
  private readonly rateLimitPolicies: Record<RateLimitedOperation, RateLimitPolicy>;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService.get<string>('RAG_SERVICE_URL') ?? 'http://rag-service:8000';
    this.rateLimitPolicies = {
      query: this.getRateLimitPolicy('QUERY', 30),
      stream: this.getRateLimitPolicy('STREAM', 10),
      history: this.getRateLimitPolicy('HISTORY', 30),
      admin: this.getRateLimitPolicy('ADMIN', 20),
    };
  }

  async cacheStats(): Promise<CacheStats> {
    return this.performRequest('cacheStats', () => fetch(`${this.baseUrl}/cache/stats`), {
      failureDetail: 'Failed to reach RAG service for cache stats',
    });
  }

  async metricsSummary(): Promise<MetricsSummary> {
    return this.performRequest(
      'metricsSummary',
      () => fetch(`${this.baseUrl}/metrics/summary`),
      { failureDetail: 'Failed to reach RAG service for metrics summary' },
    );
  }

  async history(user: AuthenticatedUser, limit = 10): Promise<ConversationTurn[]> {
    this.enforceRateLimit(user, 'history');
    const search = new URLSearchParams({
      user_id: user.userId,
      tenant_id: user.tenantId,
      limit: String(limit),
    });

    const payload = await this.performRequest<{ turns: ConversationTurn[] }>(
      'history',
      () => fetch(`${this.baseUrl}/history?${search.toString()}`),
      {
        failureDetail: 'Failed to reach RAG service for conversation history',
        user,
      },
    );

    return payload.turns;
  }

  async adminOverview(user: AuthenticatedUser): Promise<AdminOverview> {
    this.enforceRateLimit(user, 'admin');
    const search = new URLSearchParams({
      user_id: user.userId,
      tenant_id: user.tenantId,
    });

    return this.performRequest(
      'adminOverview',
      () => fetch(`${this.baseUrl}/admin/overview?${search.toString()}`),
      {
        failureDetail: 'Failed to reach RAG service for admin overview',
        user,
      },
    );
  }

  async adminChunks(
    user: AuthenticatedUser,
    limit = 10,
    filters?: AskFilters,
  ): Promise<AdminChunk[]> {
    this.enforceRateLimit(user, 'admin');
    const search = this.createSearchParams(user, limit, filters);

    return this.performRequest(
      'adminChunks',
      () => fetch(`${this.baseUrl}/admin/chunks?${search.toString()}`),
      {
        failureDetail: 'Failed to reach RAG service for admin chunks',
        user,
      },
    );
  }

  async query(user: AuthenticatedUser, query: string, filters?: AskFilters): Promise<RagAnswer> {
    this.enforceRateLimit(user, 'query');

    return this.performJsonRequest(
      'query',
      `${this.baseUrl}/query`,
      {
        user_id: user.userId,
        tenant_id: user.tenantId,
        query,
        stream: false,
        source: filters?.source,
        category: filters?.category,
        title_contains: filters?.title_contains,
      },
      {
        failureDetail: 'Failed to reach RAG service for query execution',
        user,
      },
    );
  }

  async streamQuery(user: AuthenticatedUser, query: string, filters?: AskFilters): Promise<Response> {
    this.enforceRateLimit(user, 'stream');

    return this.performStreamingRequest(
      'streamQuery',
      `${this.baseUrl}/query`,
      {
        user_id: user.userId,
        tenant_id: user.tenantId,
        query,
        stream: true,
        source: filters?.source,
        category: filters?.category,
        title_contains: filters?.title_contains,
      },
      {
        failureDetail: 'Failed to reach RAG service for streaming query execution',
        user,
      },
    );
  }

  private createSearchParams(
    user: AuthenticatedUser,
    limit: number,
    filters?: AskFilters,
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

  private async performJsonRequest<T>(
    operation: string,
    url: string,
    body: Record<string, unknown>,
    options: { failureDetail: string; user?: AuthenticatedUser },
  ): Promise<T> {
    return this.performRequest(
      operation,
      () =>
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      options,
    );
  }

  private async performStreamingRequest(
    operation: string,
    url: string,
    body: Record<string, unknown>,
    options: { failureDetail: string; user?: AuthenticatedUser },
  ): Promise<Response> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        await this.parseJsonResponse<Record<string, unknown>>(response, operation);
      }
      if (!response.body) {
        throw new HttpException(
          {
            error: 'rag_stream_unavailable',
            detail: 'RAG service returned no streaming body',
            requestId: response.headers.get('x-request-id') ?? 'unknown',
          },
          HttpStatus.BAD_GATEWAY,
        );
      }

      return response;
    } catch (error) {
      throw this.handleRequestError(error, operation, options.failureDetail, options.user);
    }
  }

  private async performRequest<T>(
    operation: string,
    request: () => Promise<Response>,
    options: { failureDetail: string; user?: AuthenticatedUser },
  ): Promise<T> {
    try {
      const response = await request();
      return await this.parseJsonResponse<T>(response, operation);
    } catch (error) {
      throw this.handleRequestError(error, operation, options.failureDetail, options.user);
    }
  }

  private handleRequestError(
    error: unknown,
    operation: string,
    failureDetail: string,
    user?: AuthenticatedUser,
  ): HttpException {
    if (error instanceof HttpException) {
      return error;
    }

    this.logger.error(
      JSON.stringify({
        event: 'rag_fetch_failed',
        operation,
        userId: user?.userId,
        tenantId: user?.tenantId,
        detail: error instanceof Error ? error.message : String(error),
      }),
    );

    return new HttpException(
      {
        error: 'rag_fetch_failed',
        detail: failureDetail,
        requestId: 'unavailable',
      },
      HttpStatus.BAD_GATEWAY,
    );
  }

  private async parseJsonResponse<T>(response: Response, operation: string): Promise<T> {
    const requestId = response.headers.get('x-request-id') ?? 'unknown';
    let payload: unknown = null;

    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const detail =
        typeof payload === 'object' && payload !== null && 'detail' in payload
          ? String((payload as { detail?: unknown }).detail)
          : `${operation} failed with status ${response.status}`;

      this.logger.error(
        JSON.stringify({
          event: 'rag_upstream_error',
          operation,
          statusCode: response.status,
          requestId,
          detail,
        }),
      );

      throw new HttpException(
        {
          error: 'rag_upstream_error',
          detail,
          requestId,
        },
        HttpStatus.BAD_GATEWAY,
      );
    }

    this.logger.log(
      JSON.stringify({
        event: 'rag_upstream_success',
        operation,
        statusCode: response.status,
        requestId,
      }),
    );

    return payload as T;
  }

  private enforceRateLimit(user: AuthenticatedUser, operation: RateLimitedOperation): void {
    const policy = this.rateLimitPolicies[operation];
    const bucketKey = `${operation}:${user.tenantId}:${user.userId}`;
    const now = Date.now();
    const windowStart = now - policy.windowMs;
    const current =
      this.rateLimitBuckets.get(bucketKey)?.filter((timestamp) => timestamp > windowStart) ?? [];

    if (current.length >= policy.limit) {
      this.logger.warn(
        JSON.stringify({
          event: 'rate_limit_exceeded',
          operation,
          userId: user.userId,
          tenantId: user.tenantId,
          limit: policy.limit,
          windowMs: policy.windowMs,
        }),
      );

      throw new HttpException(
        {
          error: 'rate_limit_exceeded',
          detail: `Too many ${operation} requests. Try again later.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    current.push(now);
    this.rateLimitBuckets.set(bucketKey, current);
  }

  private getRateLimitPolicy(prefix: string, limit: number): RateLimitPolicy {
    return {
      limit: Number(this.configService.get<string>(`${prefix}_RATE_LIMIT_MAX`) ?? limit),
      windowMs: Number(this.configService.get<string>(`${prefix}_RATE_LIMIT_WINDOW_MS`) ?? 60_000),
    };
  }
}
