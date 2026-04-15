import { Args, Context, Int, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';

import { AuthenticatedUser, JwtGuard, Roles, RolesGuard } from '../auth';
import { AskFiltersInput } from './dto/ask-filters.input';
import {
  AdminChunk,
  AdminOverview,
  CacheStats,
  ConversationTurn,
  MetricsSummary,
  RagAnswer,
} from './models/rag.models';
import { RagService } from './rag.service';

type GraphqlRequestContext = {
  req: {
    user: AuthenticatedUser;
  };
};

@Resolver()
export class RagResolver {
  constructor(private readonly ragService: RagService) {}

  @Query(() => CacheStats)
  @UseGuards(JwtGuard)
  async cacheStats(): Promise<CacheStats> {
    return this.ragService.cacheStats();
  }

  @Query(() => MetricsSummary)
  @UseGuards(JwtGuard)
  async metricsSummary(): Promise<MetricsSummary> {
    return this.ragService.metricsSummary();
  }

  @Query(() => [ConversationTurn])
  @UseGuards(JwtGuard)
  async conversationHistory(
    @Context() context: GraphqlRequestContext,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
  ): Promise<ConversationTurn[]> {
    return this.ragService.history(context.req.user, limit ?? 10);
  }

  @Query(() => AdminOverview)
  @UseGuards(JwtGuard, RolesGuard)
  @Roles('admin')
  async adminOverview(@Context() context: GraphqlRequestContext): Promise<AdminOverview> {
    return this.ragService.adminOverview(context.req.user);
  }

  @Query(() => [AdminChunk])
  @UseGuards(JwtGuard, RolesGuard)
  @Roles('admin')
  async adminChunks(
    @Context() context: GraphqlRequestContext,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
    @Args('filters', { type: () => AskFiltersInput, nullable: true }) filters?: AskFiltersInput,
  ): Promise<AdminChunk[]> {
    return this.ragService.adminChunks(context.req.user, limit ?? 10, filters);
  }

  @Query(() => RagAnswer)
  @UseGuards(JwtGuard)
  async ask(
    @Args('query', { type: () => String }) query: string,
    @Args('filters', { type: () => AskFiltersInput, nullable: true }) filters: AskFiltersInput | undefined,
    @Context() context: GraphqlRequestContext,
  ): Promise<RagAnswer> {
    return this.ragService.query(context.req.user, query, filters);
  }
}
