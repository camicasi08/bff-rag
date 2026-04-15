import { ArgsType, Field } from '@nestjs/graphql';
import { IsNotEmpty, IsString } from 'class-validator';

import { AskFiltersInput } from '../inputs/ask-filters.input';

@ArgsType()
export class AskArgs {
  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  query!: string;

  @Field(() => AskFiltersInput, { nullable: true })
  filters?: AskFiltersInput;
}
