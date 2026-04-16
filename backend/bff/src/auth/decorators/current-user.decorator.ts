import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';

import type { AuthenticatedUser } from '../auth.types';

type RequestWithUser = {
  user?: AuthenticatedUser;
};

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser | undefined => {
    if (context.getType<string>() === 'http') {
      return context.switchToHttp().getRequest<RequestWithUser>().user;
    }

    return GqlExecutionContext.create(context).getContext<{ req?: RequestWithUser }>().req?.user;
  },
);
