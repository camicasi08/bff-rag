import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';

import type { AuthenticatedUser } from '../auth';
import { RagConfigService } from './rag-config.service';

@Injectable()
export class RagUpstreamService {
  private readonly logger = new Logger(RagUpstreamService.name);

  constructor(private readonly ragConfigService: RagConfigService) {}

  async get<T>(operation: string, path: string, options: { failureDetail: string; user?: AuthenticatedUser }): Promise<T> {
    return this.performRequest(operation, () => fetch(this.buildUrl(path)), options);
  }

  async postJson<T>(
    operation: string,
    path: string,
    body: Record<string, unknown>,
    options: { failureDetail: string; user?: AuthenticatedUser },
  ): Promise<T> {
    return this.performRequest(
      operation,
      () =>
        fetch(this.buildUrl(path), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      options,
    );
  }

  async postStream(
    operation: string,
    path: string,
    body: Record<string, unknown>,
    options: { failureDetail: string; user?: AuthenticatedUser },
  ): Promise<Response> {
    try {
      const response = await fetch(this.buildUrl(path), {
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

  private buildUrl(path: string): string {
    return `${this.ragConfigService.getBaseUrl()}${path}`;
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
}
