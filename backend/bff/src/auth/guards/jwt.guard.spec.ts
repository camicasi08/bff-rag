import assert from 'node:assert/strict';
import test from 'node:test';

import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

import type { AuthenticatedUser } from '../auth.types';
import { JwtGuard } from './jwt.guard';

function createHttpContext(request: { headers?: { authorization?: string }; user?: AuthenticatedUser }): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as ExecutionContext;
}

test('JwtGuard injects the development user when no token is provided in development', () => {
  const request: { headers?: { authorization?: string }; user?: AuthenticatedUser } = {};
  const demoUser: AuthenticatedUser = {
    userId: 'demo-user',
    tenantId: 'demo-tenant',
    roles: ['user'],
  };
  const guard = new JwtGuard({
    isDevelopment: () => true,
    getDevelopmentUser: () => demoUser,
    verifyToken: () => {
      throw new Error('verifyToken should not be called');
    },
  } as never);

  const allowed = guard.canActivate(createHttpContext(request));

  assert.equal(allowed, true);
  assert.deepEqual(request.user, demoUser);
});

test('JwtGuard verifies a bearer token and stores the authenticated user', () => {
  const request: { headers?: { authorization?: string }; user?: AuthenticatedUser } = {
    headers: { authorization: 'Bearer signed-token' },
  };
  const authenticatedUser: AuthenticatedUser = {
    userId: 'user-1',
    tenantId: 'tenant-1',
    roles: ['admin'],
  };
  const guard = new JwtGuard({
    isDevelopment: () => false,
    getDevelopmentUser: () => authenticatedUser,
    verifyToken: (token: string) => {
      assert.equal(token, 'signed-token');
      return authenticatedUser;
    },
  } as never);

  const allowed = guard.canActivate(createHttpContext(request));

  assert.equal(allowed, true);
  assert.deepEqual(request.user, authenticatedUser);
});

test('JwtGuard rejects a missing token outside development mode', () => {
  const guard = new JwtGuard({
    isDevelopment: () => false,
    getDevelopmentUser: () => {
      throw new Error('getDevelopmentUser should not be called');
    },
    verifyToken: () => {
      throw new Error('verifyToken should not be called');
    },
  } as never);

  assert.throws(() => guard.canActivate(createHttpContext({})), (error: unknown) => {
    assert.ok(error instanceof UnauthorizedException);
    assert.equal(error.message, 'Missing bearer token');
    return true;
  });
});

test('JwtGuard normalizes unexpected verify errors into invalid token responses', () => {
  const guard = new JwtGuard({
    isDevelopment: () => false,
    getDevelopmentUser: () => {
      throw new Error('getDevelopmentUser should not be called');
    },
    verifyToken: () => {
      throw new Error('broken signature');
    },
  } as never);

  assert.throws(
    () =>
      guard.canActivate(
        createHttpContext({
          headers: { authorization: 'Bearer invalid-token' },
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof UnauthorizedException);
      assert.equal(error.message, 'Invalid token');
      return true;
    },
  );
});
