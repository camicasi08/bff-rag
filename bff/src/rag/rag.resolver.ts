import { Args, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';

import { CurrentUser, JwtGuard, Roles, RolesGuard } from '../auth';
import type { AuthenticatedUser } from '../auth';
import { AdminChunksArgs } from './dto/admin-chunks.args';
import { AskArgs } from './dto/ask.args';
import { ConversationHistoryArgs } from './dto/conversation-history.args';
import {
  AdminChunk,
  AdminOverview,
  CacheStats,
  ConversationTurn,
  MetricsSummary,
  RagAnswer,
} from './models/rag.models';
import { RagService } from './rag.service';

@Resolver()
@UseGuards(JwtGuard)
export class RagResolver {
  constructor(private readonly ragService: RagService) {}

  @Query(() => CacheStats)
  async cacheStats(): Promise<CacheStats> {
    return this.ragService.cacheStats();
  }

  @Query(() => MetricsSummary)
  async metricsSummary(): Promise<MetricsSummary> {
    return this.ragService.metricsSummary();
  }

  @Query(() => [ConversationTurn])
  async conversationHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Args() args: ConversationHistoryArgs,
  ): Promise<ConversationTurn[]> {
    return this.ragService.history(user, args.limit);
  }

  @Query(() => AdminOverview)
  @UseGuards(RolesGuard)
  @Roles('admin')
  async adminOverview(@CurrentUser() user: AuthenticatedUser): Promise<AdminOverview> {
    return this.ragService.adminOverview(user);
  }

  @Query(() => [AdminChunk])
  @UseGuards(RolesGuard)
  @Roles('admin')
  async adminChunks(
    @CurrentUser() user: AuthenticatedUser,
    @Args() args: AdminChunksArgs,
  ): Promise<AdminChunk[]> {
    return this.ragService.adminChunks(user, args.limit, args.filters);
  }

  @Query(() => RagAnswer)
  async ask(
    @CurrentUser() user: AuthenticatedUser,
    @Args() args: AskArgs,
  ): Promise<RagAnswer> {
    return this.ragService.query(user, args.query, args.filters);
  }
}
