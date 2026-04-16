import assert from 'node:assert/strict';
import test from 'node:test';

import { HttpException, HttpStatus } from '@nestjs/common';

import type { AuthenticatedUser } from '../../auth';
import { AdminIngestInput } from '../graphql/inputs/admin-ingest.input';
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

test('RagService queues admin ingest jobs through the upstream service', async () => {
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
        return { job_id: 'job-1', status: 'queued' };
      },
    } as RagUpstreamService,
  );

  const input: AdminIngestInput = {
    source: 'manual-upload',
    documents: [
      {
        title: 'Payment Terms',
        content: 'Invoices are due within 30 days.',
        category: 'billing',
        metadata_json: '{"region":"global"}',
      },
    ],
    files: [
      {
        filename: 'policy.md',
        content_base64: 'cG9saWN5',
        title: 'Policy',
        category: 'billing',
        content_type: 'text/markdown',
        metadata_json: '{"origin":"upload"}',
      },
    ],
  };

  await service.adminIngest(user, input);

  assert.deepEqual(enforceCalls, [[user, 'admin']]);
  assert.deepEqual(postJsonCalls, [[
    'adminIngest',
    '/admin/ingest/jobs',
    {
      user_id: 'user-1',
      tenant_id: 'tenant-1',
      source: 'manual-upload',
      documents: [
        {
          title: 'Payment Terms',
          content: 'Invoices are due within 30 days.',
          category: 'billing',
          metadata: { region: 'global' },
        },
      ],
      files: [
        {
          filename: 'policy.md',
          content_base64: 'cG9saWN5',
          title: 'Policy',
          category: 'billing',
          content_type: 'text/markdown',
          metadata: { origin: 'upload' },
        },
      ],
    },
    {
      failureDetail: 'Failed to reach RAG service for admin ingest',
      user,
    },
  ]]);
});

test('RagService fetches ingest job status through the upstream service', async () => {
  const getCalls: unknown[][] = [];

  const service = new RagService(
    {
      enforce: () => undefined,
    } as unknown as RagRateLimitService,
    {
      get: async (...args: unknown[]) => {
        getCalls.push(args);
        return {
          job_id: 'job-1',
          status: 'running',
          user_id: 'user-1',
          tenant_id: 'tenant-1',
          source: 'manual-upload',
          submitted_at: '2026-04-16T12:00:00Z',
          inserted_chunks: 0,
          skipped_duplicates: 0,
        };
      },
    } as RagUpstreamService,
  );

  await service.adminIngestJobStatus('job-1');

  assert.deepEqual(getCalls, [[
    'adminIngestJobStatus',
    '/admin/ingest/jobs/job-1',
    {
      failureDetail: 'Failed to reach RAG service for ingest job status',
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
