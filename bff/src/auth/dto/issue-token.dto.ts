import { IsArray, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class IssueTokenDto {
  @ApiPropertyOptional({
    description: 'Optional user id for the token. Defaults to the local demo user.',
    example: '00000000-0000-0000-0000-000000000001',
  })
  @IsOptional()
  @IsString()
  user_id?: string;

  @ApiPropertyOptional({
    description: 'Optional tenant id for the token. Defaults to the local demo tenant.',
    example: 'default',
  })
  @IsOptional()
  @IsString()
  tenant_id?: string;

  @ApiPropertyOptional({
    description: 'Optional role list to include in the token.',
    example: ['user', 'admin'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roles?: string[];
}
