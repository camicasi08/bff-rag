import { Module } from '@nestjs/common';

import { AuthModule } from '../auth';
import { RagController } from './controllers/rag.controller';
import { RagResolver } from './graphql/resolvers/rag.resolver';
import { RagConfigService } from './services/rag-config.service';
import { RagRateLimitService } from './services/rag-rate-limit.service';
import { RagService } from './services/rag.service';
import { RagUpstreamService } from './services/rag-upstream.service';

@Module({
  imports: [AuthModule],
  controllers: [RagController],
  providers: [
    RagConfigService,
    RagRateLimitService,
    RagUpstreamService,
    RagService,
    RagResolver,
  ],
})
export class RagModule {}
