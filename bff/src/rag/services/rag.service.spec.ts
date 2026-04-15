import assert from 'node:assert/strict';
import test from 'node:test';

import { HttpException, HttpStatus } from '@nestjs/common';

import type { AuthenticatedUser } from '../../auth';
import { RagRateLimitService } from './rag-rate-limit.service';
import { RagService } from './rag.service';
import { RagUpstreamService } from './rag-upstream.service';

const user: AuthenticatedUser = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  roles: ['user'],
};

test('RagService delegates JSON query requests to the upstream service', async () => {
  const enforceCalls: unknown[][] = [];
  const postJsonCalls: unknown[][] = [];

  const service = new RagService(
    {
      enforce: (...args: unknown[]) => {
        enforceCalls.push(args);
      },
    } as RagRateLimitService,
    {
      postJson: async (...args: unknown[]) => {
        postJsonCalls.push(args);
        return { answer: 'ok', cache_hit: false, chunks_used: [], history_used: 0, citations: [] };
      },
    } as RagUpstreamService,
  );

  await service.query(user, 'payment terms', { source: 'seed', category: 'billing', title_contains: 'Payment' });

  assert.deepEqual(enforceCalls, [[user, 'query']]);
  assert.deepEqual(postJsonCalls, [[
      'query',
      '/query',
      {
        user_id: 'user-1',
        tenant_id: 'tenant-1',
        query: 'payment terms',
        stream: false,
        source: 'seed',
        category: 'billing',
        title_contains: 'Payment',
      },
      {
        failureDetail: 'Failed to reach RAG service for query execution',
        user,
      },
    ]]);
});

test('RagService builds admin chunk search params with filters', async () => {
  const enforceCalls: unknown[][] = [];
  const getCalls: unknown[][] = [];

  const service = new RagService(
    {
      enforce: (...args: unknown[]) => {
        enforceCalls.push(args);
      },
    } as RagRateLimitService,
    {
      get: async (...args: unknown[]) => {
        getCalls.push(args);
        return [];
      },
    } as RagUpstreamService,
  );

  await service.adminChunks(user, 5, { source: 'seed', category: 'billing', title_contains: 'Payment Terms' });

  assert.deepEqual(enforceCalls, [[user, 'admin']]);
  assert.deepEqual(getCalls, [[
    'adminChunks',
    '/admin/chunks?user_id=user-1&tenant_id=tenant-1&limit=5&source=seed&category=billing&title_contains=Payment+Terms',
    {
      failureDetail: 'Failed to reach RAG service for admin chunks',
      user,
    },
  ]]);
});

test('RagRateLimitService throws when the policy limit is exceeded', () => {
  const service = new RagRateLimitService({
    getRateLimitPolicy: () => ({ limit: 1, windowMs: 60_000 }),
  } as never);

  service.enforce(user, 'query');

  assert.throws(
    () => service.enforce(user, 'query'),
    new HttpException(
      {
        error: 'rate_limit_exceeded',
        detail: 'Too many query requests. Try again later.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    ),
  );
});
