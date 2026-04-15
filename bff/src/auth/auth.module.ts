import { Module } from '@nestjs/common';

import { AuthController } from './controllers/auth.controller';
import { JwtGuard } from './guards/jwt.guard';
import { RolesGuard } from './guards/roles.guard';
import { AuthService } from './services/auth.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, JwtGuard, RolesGuard],
  exports: [AuthService, JwtGuard, RolesGuard],
})
export class AuthModule {}
