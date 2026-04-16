import { SetMetadata } from '@nestjs/common';

import { AUTH_ROLES_KEY } from '../auth.constants';

export const Roles = (...roles: string[]) => SetMetadata(AUTH_ROLES_KEY, roles);
