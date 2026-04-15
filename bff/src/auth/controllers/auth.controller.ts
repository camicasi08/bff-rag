import { Body, Controller, Post } from '@nestjs/common';

import { IssueTokenDto } from '../dto/issue-token.dto';
import { AuthService } from '../services/auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('token')
  issueToken(@Body() body: IssueTokenDto) {
    return this.authService.issueToken(body);
  }
}
