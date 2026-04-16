export type AuthenticatedUser = {
  userId: string;
  tenantId: string;
  roles: string[];
};

export type JwtPayload = {
  sub: string;
  tenant_id: string;
  roles?: unknown;
};
