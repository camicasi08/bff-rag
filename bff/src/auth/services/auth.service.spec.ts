import assert from 'node:assert/strict';
import test from 'node:test';

import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

import {
  DEFAULT_DEMO_TENANT_ID,
  DEFAULT_DEMO_USER_ID,
  DEFAULT_JWT_SECRET,
  DEFAULT_USER_ROLE,
} from '../auth.constants';
import { AuthService } from './auth.service';

function createConfigService(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as ConfigService;
}

test('AuthService issues and verifies a token with explicit values', () => {
  const service = new AuthService(
    createConfigService({ JWT_SECRET: 'test-secret', NODE_ENV: 'development' }),
  );

  const issued = service.issueToken({
    user_id: 'user-123',
    tenant_id: 'tenant-123',
    roles: ['user', 'admin'],
  });
  const verified = service.verifyToken(issued.access_token);

  assert.deepEqual(verified, {
    userId: 'user-123',
    tenantId: 'tenant-123',
    roles: ['user', 'admin'],
  });
});

test('AuthService falls back to default demo values when issuing a token', () => {
  const service = new AuthService(createConfigService({}));

  const issued = service.issueToken({});
  const payload = jwt.verify(issued.access_token, DEFAULT_JWT_SECRET) as jwt.JwtPayload;

  assert.equal(payload.sub, DEFAULT_DEMO_USER_ID);
  assert.equal(payload.tenant_id, DEFAULT_DEMO_TENANT_ID);
  assert.deepEqual(payload.roles, [DEFAULT_USER_ROLE]);
});

test('AuthService rejects a token with an invalid payload', () => {
  const brokenToken = jwt.sign({ tenant_id: 'tenant-only' }, DEFAULT_JWT_SECRET, {
    expiresIn: '1h',
  });
  const service = new AuthService(createConfigService({}));

  assert.throws(() => service.verifyToken(brokenToken), UnauthorizedException);
});

test('AuthService exposes development mode and demo user defaults', () => {
  const service = new AuthService(createConfigService({ NODE_ENV: 'development' }));

  assert.equal(service.isDevelopment(), true);
  assert.deepEqual(service.getDevelopmentUser(), {
    userId: DEFAULT_DEMO_USER_ID,
    tenantId: DEFAULT_DEMO_TENANT_ID,
    roles: [DEFAULT_USER_ROLE, 'admin'],
  });
});

test('AuthService disables development fallback outside development mode', () => {
  const service = new AuthService(createConfigService({ NODE_ENV: 'production' }));

  assert.equal(service.isDevelopment(), false);
});
