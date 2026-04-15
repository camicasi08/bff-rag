import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';

import { AuthService } from '../auth.service';
import type { AuthenticatedUser } from '../auth.types';

type RequestWithUser = {
  headers?: {
    authorization?: string;
  };
  user?: AuthenticatedUser;
};

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = this.getRequest(context);
    const token = request?.headers?.authorization?.replace(/^Bearer\s+/i, '');

    if (!token && this.authService.isDevelopment()) {
      request.user = this.authService.getDevelopmentUser();
      return true;
    }

    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    try {
      request.user = this.authService.verifyToken(token);
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid token');
    }
  }

  private getRequest(context: ExecutionContext): RequestWithUser {
    if (context.getType<string>() === 'http') {
      return context.switchToHttp().getRequest<RequestWithUser>();
    }

    return GqlExecutionContext.create(context).getContext().req as RequestWithUser;
  }
}
