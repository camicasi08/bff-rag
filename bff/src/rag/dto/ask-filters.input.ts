import { Field, InputType } from '@nestjs/graphql';

@InputType()
export class AskFiltersInput {
  @Field({ nullable: true })
  source?: string;

  @Field({ nullable: true })
  category?: string;

  @Field({ nullable: true })
  title_contains?: string;
}

export type AskFilters = {
  source?: string;
  category?: string;
  title_contains?: string;
};
