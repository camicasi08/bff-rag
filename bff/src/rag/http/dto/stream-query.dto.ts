import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class StreamQueryDto {
  @IsString()
  @IsNotEmpty()
  query!: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  title_contains?: string;
}
