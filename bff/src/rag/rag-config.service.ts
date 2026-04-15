import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DEFAULT_RAG_SERVICE_URL } from './rag.constants';
import type { RateLimitPolicy, RateLimitedOperation } from './rag.types';

@Injectable()
export class RagConfigService {
  constructor(private readonly configService: ConfigService) {}

  getBaseUrl(): string {
    return this.configService.get<string>('RAG_SERVICE_URL') ?? DEFAULT_RAG_SERVICE_URL;
  }

  getRateLimitPolicy(operation: RateLimitedOperation): RateLimitPolicy {
    const defaults: Record<RateLimitedOperation, { prefix: string; limit: number }> = {
      query: { prefix: 'QUERY', limit: 30 },
      stream: { prefix: 'STREAM', limit: 10 },
      history: { prefix: 'HISTORY', limit: 30 },
      admin: { prefix: 'ADMIN', limit: 20 },
    };

    const policy = defaults[operation];

    return {
      limit: Number(this.configService.get<string>(`${policy.prefix}_RATE_LIMIT_MAX`) ?? policy.limit),
      windowMs: Number(this.configService.get<string>(`${policy.prefix}_RATE_LIMIT_WINDOW_MS`) ?? 60_000),
    };
  }
}
