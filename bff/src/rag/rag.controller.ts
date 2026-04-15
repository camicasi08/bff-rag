import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response as ExpressResponse } from 'express';

import { AuthenticatedUser, CurrentUser, JwtGuard } from '../auth';
import { StreamQueryDto } from './dto/stream-query.dto';
import { RagService } from './rag.service';

@Controller('rag')
export class RagController {
  constructor(private readonly ragService: RagService) {}

  @Get('stream')
  @UseGuards(JwtGuard)
  async stream(
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: ExpressResponse,
    @Query() query: StreamQueryDto,
  ): Promise<void> {
    const upstream = await this.ragService.streamQuery(user, query.query, {
      source: query.source,
      category: query.category,
      title_contains: query.title_contains,
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const body = upstream.body;
    if (!body) {
      throw new HttpException('RAG stream body unavailable', HttpStatus.BAD_GATEWAY);
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        res.write(decoder.decode(value, { stream: true }));
      }

      res.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.write(`event: error\ndata: ${JSON.stringify({ detail: message })}\n\n`);
      res.end();
    } finally {
      reader.releaseLock();
    }
  }
}
