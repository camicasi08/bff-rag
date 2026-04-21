import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class CacheStats {
  @Field()
  cached_entries!: number;
}

@ObjectType()
export class MetricsSummary {
  @Field()
  total_queries!: number;

  @Field()
  cache_hits!: number;

  @Field()
  cache_misses!: number;

  @Field()
  cache_hit_rate!: number;

  @Field()
  total_ingest_requests!: number;

  @Field()
  total_chunks_ingested!: number;

  @Field()
  skipped_duplicates!: number;
}

@ObjectType()
export class Citation {
  @Field()
  chunk_id!: string;

  @Field()
  source!: string;

  @Field()
  title!: string;

  @Field()
  chunk_index!: number;

  @Field()
  excerpt!: string;
}

@ObjectType()
export class ConversationTurn {
  @Field()
  role!: string;

  @Field()
  content!: string;

  @Field()
  created_at!: string;
}

@ObjectType()
export class AdminChunk {
  @Field()
  chunk_id!: string;

  @Field()
  source!: string;

  @Field()
  title!: string;

  @Field({ nullable: true })
  category?: string;

  @Field()
  chunk_index!: number;

  @Field()
  excerpt!: string;

  @Field()
  created_at!: string;

  @Field({ nullable: true })
  content_hash?: string;
}

@ObjectType()
export class AdminOverview {
  @Field(() => MetricsSummary)
  metrics!: MetricsSummary;

  @Field()
  cached_entries!: number;

  @Field()
  total_chunks!: number;

  @Field()
  total_conversations!: number;
}

@ObjectType()
export class RagAnswer {
  @Field()
  answer!: string;

  @Field()
  cache_hit!: boolean;

  @Field(() => [String])
  chunks_used!: string[];

  @Field()
  history_used!: number;

  @Field({ nullable: true })
  latency_ms?: number;

  @Field(() => [Citation])
  citations!: Citation[];
}

@ObjectType()
export class IngestJobQueued {
  @Field()
  job_id!: string;

  @Field()
  status!: string;
}

@ObjectType()
export class IngestJobStatus {
  @Field()
  job_id!: string;

  @Field()
  status!: string;

  @Field()
  user_id!: string;

  @Field()
  tenant_id!: string;

  @Field()
  source!: string;

  @Field()
  submitted_at!: string;

  @Field({ nullable: true })
  started_at?: string;

  @Field({ nullable: true })
  finished_at?: string;

  @Field()
  inserted_chunks!: number;

  @Field()
  skipped_duplicates!: number;

  @Field({ nullable: true })
  error?: string;
}
