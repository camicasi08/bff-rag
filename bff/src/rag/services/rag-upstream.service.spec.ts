import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

import { HttpException, HttpStatus, Logger } from '@nestjs/common';

import type { AuthenticatedUser } from '../../auth';
import { RagUpstreamService } from './rag-upstream.service';

const user: AuthenticatedUser = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  roles: ['user'],
};

test('RagUpstreamService builds the upstream URL and returns parsed JSON', async () => {
  const restore = mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    assert.equal(String(url), 'http://rag-service:8000/cache/stats');
    return new Response(JSON.stringify({ cached_entries: 4 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'x-request-id': 'req-1' },
    });
  });

  try {
    const service = new RagUpstreamService({
      getBaseUrl: () => 'http://rag-service:8000',
    } as never);

    const payload = await service.get<{ cached_entries: number }>('cacheStats', '/cache/stats', {
      failureDetail: 'Failed',
    });

    assert.deepEqual(payload, { cached_entries: 4 });
  } finally {
    restore.mock.restore();
  }
});

test('RagUpstreamService maps non-OK upstream responses into HttpException', async () => {
  const errorLogs: string[] = [];
  const restoreFetch = mock.method(globalThis, 'fetch', async () =>
    new Response(JSON.stringify({ detail: 'upstream exploded' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'x-request-id': 'req-502' },
    }),
  );
  const restoreLogger = mock.method(Logger.prototype, 'error', (message: string) => {
    errorLogs.push(message);
  });

  try {
    const service = new RagUpstreamService({
      getBaseUrl: () => 'http://rag-service:8000',
    } as never);

    await assert.rejects(
      service.get('cacheStats', '/cache/stats', {
        failureDetail: 'Failed',
        user,
      }),
      (error: unknown) => {
        assert.ok(error instanceof HttpException);
        assert.equal(error.getStatus(), HttpStatus.BAD_GATEWAY);
        assert.deepEqual(error.getResponse(), {
          error: 'rag_upstream_error',
          detail: 'upstream exploded',
          requestId: 'req-502',
        });
        return true;
      },
    );

    assert.equal(errorLogs.length, 1);
    assert.match(errorLogs[0], /"event":"rag_upstream_error"/);
  } finally {
    restoreLogger.mock.restore();
    restoreFetch.mock.restore();
  }
});

test('RagUpstreamService maps fetch failures into a bad gateway error', async () => {
  const restoreFetch = mock.method(globalThis, 'fetch', async () => {
    throw new Error('connection refused');
  });

  try {
    const service = new RagUpstreamService({
      getBaseUrl: () => 'http://rag-service:8000',
    } as never);

    await assert.rejects(
      service.postJson(
        'query',
        '/query',
        { query: 'payment terms' },
        {
          failureDetail: 'Failed to reach RAG service for query execution',
          user,
        },
      ),
      (error: unknown) => {
        assert.ok(error instanceof HttpException);
        assert.equal(error.getStatus(), HttpStatus.BAD_GATEWAY);
        assert.deepEqual(error.getResponse(), {
          error: 'rag_fetch_failed',
          detail: 'Failed to reach RAG service for query execution',
          requestId: 'unavailable',
        });
        return true;
      },
    );
  } finally {
    restoreFetch.mock.restore();
  }
});

test('RagUpstreamService rejects stream responses without a body', async () => {
  const restoreFetch = mock.method(globalThis, 'fetch', async () =>
    new Response(null, {
      status: 200,
      headers: { 'x-request-id': 'req-stream' },
    }),
  );

  try {
    const service = new RagUpstreamService({
      getBaseUrl: () => 'http://rag-service:8000',
    } as never);

    await assert.rejects(
      service.postStream(
        'streamQuery',
        '/query',
        { query: 'payment terms', stream: true },
        {
          failureDetail: 'Failed to reach RAG service for streaming query execution',
          user,
        },
      ),
      (error: unknown) => {
        assert.ok(error instanceof HttpException);
        assert.equal(error.getStatus(), HttpStatus.BAD_GATEWAY);
        assert.deepEqual(error.getResponse(), {
          error: 'rag_stream_unavailable',
          detail: 'RAG service returned no streaming body',
          requestId: 'req-stream',
        });
        return true;
      },
    );
  } finally {
    restoreFetch.mock.restore();
  }
});

test('RagUpstreamService sends JSON payloads for admin ingest requests', async () => {
  const restore = mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(url), 'http://rag-service:8000/admin/ingest/jobs');
    assert.equal(init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(init?.body)), {
      source: 'manual-upload',
      documents: [{ title: 'Policy', content: 'hello' }],
      files: [{ filename: 'policy.md', content_base64: 'cG9saWN5' }],
    });

    return new Response(JSON.stringify({ job_id: 'job-1', status: 'queued' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'x-request-id': 'req-ingest' },
    });
  });

  try {
    const service = new RagUpstreamService({
      getBaseUrl: () => 'http://rag-service:8000',
    } as never);

    const payload = await service.postJson<{ job_id: string; status: string }>(
      'adminIngest',
      '/admin/ingest/jobs',
      {
        source: 'manual-upload',
        documents: [{ title: 'Policy', content: 'hello' }],
        files: [{ filename: 'policy.md', content_base64: 'cG9saWN5' }],
      },
      {
        failureDetail: 'Failed',
      },
    );

    assert.deepEqual(payload, { job_id: 'job-1', status: 'queued' });
  } finally {
    restore.mock.restore();
  }
});
