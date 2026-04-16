import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { IssueTokenDto } from '../dto/issue-token.dto';
import { IssueTokenResponseDto } from '../dto/issue-token-response.dto';
import { AuthService } from '../services/auth.service';

@Controller('auth')
@ApiTags('Auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('token')
  @ApiOperation({
    summary: 'Issue a local JWT token',
    description: 'Creates a JWT for testing authenticated BFF and GraphQL operations.',
  })
  @ApiResponse({
    status: 201,
    description: 'Token issued successfully.',
    type: IssueTokenResponseDto,
  })
  issueToken(@Body() body: IssueTokenDto): IssueTokenResponseDto {
    return this.authService.issueToken(body);
  }
}
