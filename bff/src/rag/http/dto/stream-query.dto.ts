import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StreamQueryDto {
  @ApiProperty({
    description: 'The question to send through the RAG streaming endpoint.',
    example: 'What are the payment terms?',
  })
  @IsString()
  @IsNotEmpty()
  query!: string;

  @ApiPropertyOptional({
    description: 'Optional source filter for retrieval.',
    example: 'manual-upload',
  })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({
    description: 'Optional category filter for retrieval.',
    example: 'billing',
  })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({
    description: 'Optional substring match against stored document titles.',
    example: 'Payment Terms',
  })
  @IsOptional()
  @IsString()
  title_contains?: string;
}
