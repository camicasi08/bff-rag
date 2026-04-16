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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser, JwtGuard } from '../../auth';
import { StreamQueryDto } from '../http/dto/stream-query.dto';
import { RagService } from '../services/rag.service';

@Controller('rag')
@ApiTags('RAG')
export class RagController {
  constructor(private readonly ragService: RagService) {}

  @Get('stream')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Stream a RAG answer over SSE',
    description:
      'Streams answer tokens from the upstream RAG service as a text/event-stream response.',
  })
  @ApiProduces('text/event-stream')
  @ApiQuery({ name: 'query', required: true, type: String })
  @ApiQuery({ name: 'source', required: false, type: String })
  @ApiQuery({ name: 'category', required: false, type: String })
  @ApiQuery({ name: 'title_contains', required: false, type: String })
  @ApiResponse({
    status: 200,
    description: 'SSE stream of answer tokens.',
    schema: {
      type: 'string',
      example:
        'data: {"token":"Invoices "}\n\ndata: {"token":"are due within 30 days."}\n\nevent: done\ndata: {}\n\n',
    },
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token outside development mode.' })
  @ApiResponse({ status: 502, description: 'RAG upstream stream unavailable.' })
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
