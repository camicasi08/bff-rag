import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

const logger = new Logger('HTTP');

export function requestLoggingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const started = Date.now();
  const requestId = req.header('x-request-id') ?? randomUUID();

  res.setHeader('x-request-id', requestId);
  res.on('finish', () => {
    logger.log(
      JSON.stringify({
        event: 'request_completed',
        requestId,
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        elapsedMs: Date.now() - started,
      }),
    );
  });

  next();
}
