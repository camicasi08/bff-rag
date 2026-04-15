import { IsArray, IsOptional, IsString } from 'class-validator';

export class IssueTokenDto {
  @IsOptional()
  @IsString()
  user_id?: string;

  @IsOptional()
  @IsString()
  tenant_id?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roles?: string[];
}
