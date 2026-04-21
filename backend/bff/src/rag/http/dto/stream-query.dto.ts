import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StreamQueryDto {
  @ApiProperty({
    description: 'The question to send through the RAG streaming endpoint.',
    example: '',
  })
  @IsString()
  @IsNotEmpty()
  query!: string;

  @ApiPropertyOptional({
    description: 'Optional source filter for retrieval.',
    example: '',
  })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({
    description: 'Optional category filter for retrieval.',
    example: '',
  })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({
    description: 'Optional substring match against stored document titles.',
    example: '',
  })
  @IsOptional()
  @IsString()
  title_contains?: string;
}
