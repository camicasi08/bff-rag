import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';

import { AUTH_ROLES_KEY } from '../auth.constants';
import type { AuthenticatedUser } from '../auth.types';

type RequestWithUser = {
  user?: AuthenticatedUser;
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(AUTH_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = this.getRequest(context);
    const roles = request.user?.roles ?? [];
    if (requiredRoles.some((role) => roles.includes(role))) {
      return true;
    }

    throw new ForbiddenException('Insufficient role for this operation');
  }

  private getRequest(context: ExecutionContext): RequestWithUser {
    if (context.getType<string>() === 'http') {
      return context.switchToHttp().getRequest<RequestWithUser>();
    }

    return GqlExecutionContext.create(context).getContext().req as RequestWithUser;
  }
}
