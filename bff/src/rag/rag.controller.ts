import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response as ExpressResponse } from 'express';

import { AuthenticatedUser, JwtGuard } from '../auth';
import { RagService } from './rag.service';

type RequestWithUser = Request & {
  user: AuthenticatedUser;
};

@Controller('rag')
export class RagController {
  constructor(private readonly ragService: RagService) {}

  @Get('stream')
  @UseGuards(JwtGuard)
  async stream(
    @Req() req: RequestWithUser,
    @Res() res: ExpressResponse,
    @Query('query') query: string,
    @Query('source') source?: string,
    @Query('category') category?: string,
    @Query('title_contains') title_contains?: string,
  ): Promise<void> {
    if (!query?.trim()) {
      throw new HttpException('Missing query parameter', HttpStatus.BAD_REQUEST);
    }

    const upstream = await this.ragService.streamQuery(req.user, query, {
      source,
      category,
      title_contains,
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
