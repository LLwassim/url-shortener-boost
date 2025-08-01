import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { LoggerService } from '../services/logger.service';

// Extend Request interface to include requestId
declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  constructor(private readonly logger: LoggerService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const startTime = Date.now();
    
    // Generate unique request ID
    req.requestId = uuidv4();
    
    // Add request ID to response headers for debugging
    res.setHeader('X-Request-ID', req.requestId);

    // Log incoming request
    this.logger.logRequest(req, req.requestId, startTime);

    // Override res.end to log response
    const originalEnd = res.end;
    res.end = function(...args: any[]) {
      const duration = Date.now() - startTime;
      
      // Don't log health check and metrics endpoints to reduce noise
      const skipLogging = ['/health', '/metrics', '/health/liveness', '/health/readiness'].includes(req.path);
      
      if (!skipLogging) {
        // Log response with additional metadata
        const responseMetadata = {
          contentLength: res.getHeader('content-length'),
          userAgent: req.headers['user-agent'],
          referer: req.headers.referer,
        };

        // Log different levels based on status code
        if (res.statusCode >= 500) {
          this.logger.error(
            `${req.method} ${req.url} ${res.statusCode} - ${duration}ms`,
            undefined,
            'HTTP',
            {
              requestId: req.requestId,
              method: req.method,
              url: req.url,
              statusCode: res.statusCode,
              duration,
              ...responseMetadata,
            }
          );
        } else if (res.statusCode >= 400) {
          this.logger.warn(
            `${req.method} ${req.url} ${res.statusCode} - ${duration}ms`,
            'HTTP',
            {
              requestId: req.requestId,
              method: req.method,
              url: req.url,
              statusCode: res.statusCode,
              duration,
              ...responseMetadata,
            }
          );
        } else {
          this.logger.logResponse(req, res.statusCode, req.requestId, startTime, responseMetadata);
        }
      }

      // Call original end method
      originalEnd.apply(res, args);
    };

    next();
  }
}