import { Body, Controller, Post } from '@nestjs/common';

import { AuthService } from './auth.service';
import { IssueTokenDto } from './dto/issue-token.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('token')
  issueToken(@Body() body: IssueTokenDto) {
    return this.authService.issueToken(body);
  }
}
