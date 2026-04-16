import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';

import { CurrentUser, JwtGuard, Roles, RolesGuard } from '../../../auth';
import type { AuthenticatedUser } from '../../../auth';
import { AdminChunksArgs } from '../args/admin-chunks.args';
import { AdminIngestInput } from '../inputs/admin-ingest.input';
import { AskArgs } from '../args/ask.args';
import { ConversationHistoryArgs } from '../args/conversation-history.args';
import {
  AdminChunk,
  AdminOverview,
  CacheStats,
  ConversationTurn,
  IngestJobQueued,
  IngestJobStatus,
  MetricsSummary,
  RagAnswer,
} from '../models/rag.models';
import { RagService } from '../../services/rag.service';

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

  @Mutation(() => IngestJobQueued)
  @UseGuards(RolesGuard)
  @Roles('admin')
  async adminIngest(
    @CurrentUser() user: AuthenticatedUser,
    @Args('input') input: AdminIngestInput,
  ): Promise<IngestJobQueued> {
    return this.ragService.adminIngest(user, input);
  }

  @Query(() => IngestJobStatus)
  @UseGuards(RolesGuard)
  @Roles('admin')
  async adminIngestJob(
    @Args('job_id') jobId: string,
  ): Promise<IngestJobStatus> {
    return this.ragService.adminIngestJobStatus(jobId);
  }

  @Query(() => RagAnswer)
  async ask(
    @CurrentUser() user: AuthenticatedUser,
    @Args() args: AskArgs,
  ): Promise<RagAnswer> {
    return this.ragService.query(user, args.query, args.filters);
  }
}
