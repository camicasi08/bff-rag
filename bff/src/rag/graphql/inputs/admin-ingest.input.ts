import { Field, InputType } from '@nestjs/graphql';
import {
  IsArray,
  IsBase64,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

@InputType()
export class AdminIngestDocumentInput {
  @Field()
  @IsString()
  title!: string;

  @Field()
  @IsString()
  content!: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  category?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  metadata_json?: string;
}

@InputType()
export class AdminIngestFileInput {
  @Field()
  @IsString()
  filename!: string;

  @Field()
  @IsBase64()
  content_base64!: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  title?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  category?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  content_type?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  metadata_json?: string;
}

@InputType()
export class AdminIngestInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  source?: string;

  @Field(() => [AdminIngestDocumentInput], { defaultValue: [] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AdminIngestDocumentInput)
  documents: AdminIngestDocumentInput[] = [];

  @Field(() => [AdminIngestFileInput], { defaultValue: [] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AdminIngestFileInput)
  files: AdminIngestFileInput[] = [];
}
