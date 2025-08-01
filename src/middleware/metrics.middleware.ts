import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { MetricsService } from '../services/metrics.service';

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metricsService: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const startTime = Date.now();
    
    // Extract route pattern for consistent metrics labeling
    const route = this.extractRoutePattern(req);
    const method = req.method;

    // Record request start
    this.metricsService.recordHttpRequestStart(method, route);

    // Override res.end to record metrics
    const originalEnd = res.end;
    res.end = (...args: any[]) => {
      const duration = Date.now() - startTime;
      const statusCode = res.statusCode;

      // Record HTTP metrics
      this.metricsService.recordHttpRequest(method, route, statusCode, duration);
      this.metricsService.recordHttpRequestEnd(method, route);

      // Call original end method
      originalEnd.apply(res, args);
    };

    next();
  }

  /**
   * Extract route pattern from request for consistent labeling
   */
  private extractRoutePattern(req: Request): string {
    // For redirect endpoints
    if (req.path.match(/^\/[a-zA-Z0-9_-]+$/)) {
      return '/:code';
    }

    // For API endpoints
    if (req.path.startsWith('/api/')) {
      const pathParts = req.path.split('/');
      
      // Replace dynamic segments with patterns
      const pattern = pathParts.map(part => {
        // Replace UUIDs
        if (part.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
          return ':id';
        }
        
        // Replace short codes
        if (part.match(/^[a-zA-Z0-9_-]{3,50}$/)) {
          return ':code';
        }
        
        return part;
      }).join('/');

      return pattern;
    }

    // For health and metrics endpoints
    if (req.path.startsWith('/health')) {
      return '/health';
    }

    if (req.path === '/metrics') {
      return '/metrics';
    }

    // For preview endpoints
    if (req.path.match(/^\/[a-zA-Z0-9_-]+\/preview$/)) {
      return '/:code/preview';
    }

    // For analytics endpoints
    if (req.path.startsWith('/analytics/')) {
      return req.path.replace(/\/[a-zA-Z0-9_-]+/, '/:code');
    }

    // Default to the actual path
    return req.path;
  }
}