import { ArgsType, Field } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';

import { AskFiltersInput } from '../inputs/ask-filters.input';

@ArgsType()
export class AskArgs {
  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  query!: string;

  @Field(() => AskFiltersInput, { nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => AskFiltersInput)
  filters?: AskFiltersInput;
}
