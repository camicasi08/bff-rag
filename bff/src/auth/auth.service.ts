import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

import {
  DEFAULT_DEMO_TENANT_ID,
  DEFAULT_DEMO_USER_ID,
  DEFAULT_JWT_SECRET,
  DEFAULT_USER_ROLE,
} from './auth.constants';
import type { AuthenticatedUser, JwtPayload } from './auth.types';
import { IssueTokenDto } from './dto/issue-token.dto';

@Injectable()
export class AuthService {
  constructor(private readonly configService: ConfigService) {}

  getJwtSecret(): string {
    return this.configService.get<string>('JWT_SECRET') ?? DEFAULT_JWT_SECRET;
  }

  isDevelopment(): boolean {
    return (this.configService.get<string>('NODE_ENV') ?? 'development') === 'development';
  }

  getDevelopmentUser(): AuthenticatedUser {
    return {
      userId: DEFAULT_DEMO_USER_ID,
      tenantId: DEFAULT_DEMO_TENANT_ID,
      roles: [DEFAULT_USER_ROLE, 'admin'],
    };
  }

  verifyToken(token: string): AuthenticatedUser {
    const payload = jwt.verify(token, this.getJwtSecret()) as JwtPayload;
    if (!payload?.sub || !payload?.tenant_id) {
      throw new Error('Invalid token payload');
    }

    return {
      userId: payload.sub,
      tenantId: payload.tenant_id,
      roles: this.normalizeRoles(payload.roles),
    };
  }

  issueToken(body: IssueTokenDto): { access_token: string } {
    const token = jwt.sign(
      {
        sub: body.user_id ?? DEFAULT_DEMO_USER_ID,
        tenant_id: body.tenant_id ?? DEFAULT_DEMO_TENANT_ID,
        roles: this.normalizeRoles(body.roles),
      },
      this.getJwtSecret(),
      { expiresIn: '1h' },
    );

    return { access_token: token };
  }

  private normalizeRoles(roles: unknown): string[] {
    if (Array.isArray(roles)) {
      const values = roles.filter((value): value is string => typeof value === 'string');
      if (values.length > 0) {
        return values;
      }
    }

    return [DEFAULT_USER_ROLE];
  }
}
