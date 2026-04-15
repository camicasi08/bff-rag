import { Module } from '@nestjs/common';

import { AuthModule } from '../auth';
import { RagController } from './rag.controller';
import { RagConfigService } from './rag-config.service';
import { RagRateLimitService } from './rag-rate-limit.service';
import { RagResolver } from './rag.resolver';
import { RagService } from './rag.service';
import { RagUpstreamService } from './rag-upstream.service';

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
