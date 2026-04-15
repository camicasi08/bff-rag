import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';

import { Logger } from '@nestjs/common';

import { requestLoggingMiddleware } from './request-logging.middleware';

class MockResponse extends EventEmitter {
  public statusCode = 200;
  public headers = new Map<string, string>();

  setHeader(name: string, value: string): void {
    this.headers.set(name, value);
  }
}

test('requestLoggingMiddleware preserves an incoming request id and calls next', () => {
  const req = {
    method: 'GET',
    originalUrl: '/graphql',
    header: (name: string) => (name === 'x-request-id' ? 'request-123' : undefined),
  };
  const res = new MockResponse();
  let nextCalled = false;
  const logs: string[] = [];
  const originalLog = Logger.prototype.log;
  Logger.prototype.log = function log(message: string) {
    logs.push(message);
  };

  try {
    requestLoggingMiddleware(req as never, res as never, () => {
      nextCalled = true;
    });
    res.emit('finish');
  } finally {
    Logger.prototype.log = originalLog;
  }

  assert.equal(nextCalled, true);
  assert.equal(res.headers.get('x-request-id'), 'request-123');
  assert.equal(logs.length, 1);
  assert.match(logs[0], /"event":"request_completed"/);
  assert.match(logs[0], /"requestId":"request-123"/);
});

test('requestLoggingMiddleware generates a request id when missing', () => {
  const req = {
    method: 'POST',
    originalUrl: '/auth/token',
    header: () => undefined,
  };
  const res = new MockResponse();

  requestLoggingMiddleware(req as never, res as never, () => undefined);

  assert.ok(res.headers.get('x-request-id'));
});
