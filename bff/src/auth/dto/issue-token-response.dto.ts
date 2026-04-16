import { ApiProperty } from '@nestjs/swagger';

export class IssueTokenResponseDto {
  @ApiProperty({
    description: 'JWT bearer token for calling authenticated BFF endpoints.',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  access_token!: string;
}
