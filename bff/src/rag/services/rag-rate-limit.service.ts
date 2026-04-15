import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';

import type { AuthenticatedUser } from '../../auth';
import { RagConfigService } from './rag-config.service';
import type { RateLimitedOperation } from '../rag.types';

@Injectable()
export class RagRateLimitService {
  private readonly logger = new Logger(RagRateLimitService.name);
  private readonly rateLimitBuckets = new Map<string, number[]>();

  constructor(private readonly ragConfigService: RagConfigService) {}

  enforce(user: AuthenticatedUser, operation: RateLimitedOperation): void {
    const policy = this.ragConfigService.getRateLimitPolicy(operation);
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
}
