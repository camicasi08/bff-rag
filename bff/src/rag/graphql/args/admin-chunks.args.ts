import { ArgsType, Field, Int } from '@nestjs/graphql';
import { IsInt, IsOptional, Min } from 'class-validator';

import { AskFiltersInput } from '../inputs/ask-filters.input';

@ArgsType()
export class AdminChunksArgs {
  @Field(() => Int, { nullable: true, defaultValue: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  limit = 10;

  @Field(() => AskFiltersInput, { nullable: true })
  filters?: AskFiltersInput;
}
