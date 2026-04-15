import { Module } from '@nestjs/common';

import { AuthModule } from '../auth';
import { RagController } from './rag.controller';
import { RagResolver } from './rag.resolver';
import { RagService } from './rag.service';

@Module({
  imports: [AuthModule],
  controllers: [RagController],
  providers: [RagService, RagResolver],
})
export class RagModule {}
