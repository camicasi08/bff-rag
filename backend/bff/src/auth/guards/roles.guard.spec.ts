import assert from 'node:assert/strict';
import test from 'node:test';

import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AuthenticatedUser } from '../auth.types';
import { RolesGuard } from './roles.guard';

function createHttpContext(user?: AuthenticatedUser): ExecutionContext {
  return {
    getType: () => 'http',
    getHandler: () => 'handler',
    getClass: () => RolesGuard,
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

test('RolesGuard allows access when no roles are required', () => {
  const guard = new RolesGuard({
    getAllAndOverride: () => undefined,
  } as unknown as Reflector);

  assert.equal(guard.canActivate(createHttpContext()), true);
});

test('RolesGuard allows access when the user has a required role', () => {
  const guard = new RolesGuard({
    getAllAndOverride: () => ['admin'],
  } as unknown as Reflector);

  const allowed = guard.canActivate(
    createHttpContext({
      userId: 'user-1',
      tenantId: 'tenant-1',
      roles: ['user', 'admin'],
    }),
  );

  assert.equal(allowed, true);
});

test('RolesGuard rejects access when the user lacks required roles', () => {
  const guard = new RolesGuard({
    getAllAndOverride: () => ['admin'],
  } as unknown as Reflector);

  assert.throws(
    () =>
      guard.canActivate(
        createHttpContext({
          userId: 'user-1',
          tenantId: 'tenant-1',
          roles: ['user'],
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof ForbiddenException);
      assert.equal(error.message, 'Insufficient role for this operation');
      return true;
    },
  );
});
