import { Controller, Get, Header, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiExcludeEndpoint } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../services/metrics.service';

@ApiTags('Monitoring')
@Controller()
export class MetricsController {
  constructor(
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService,
  ) {}

  @Get('metrics')
  @Header('Content-Type', 'text/plain')
  @ApiExcludeEndpoint() // Exclude from Swagger as it's for Prometheus
  @ApiOperation({
    summary: 'Prometheus metrics',
    description: 'Endpoint for Prometheus to scrape application metrics.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Prometheus metrics in text format',
    content: {
      'text/plain': {
        schema: {
          type: 'string',
          example: '# HELP http_requests_total Total number of HTTP requests\n# TYPE http_requests_total counter\nhttp_requests_total{method="GET",route="/api/urls",status_code="200"} 1547',
        },
      },
    },
  })
  async getMetrics(): Promise<string> {
    const isMetricsEnabled = this.configService.get<boolean>('METRICS_ENABLED', true);
    
    if (!isMetricsEnabled) {
      return '# Metrics are disabled\n';
    }

    return this.metricsService.getMetrics();
  }

  @Get('metrics/json')
  @ApiOperation({
    summary: 'Application metrics in JSON format',
    description: 'Get application metrics in a human-readable JSON format for dashboards.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Metrics in JSON format',
    schema: {
      type: 'object',
      properties: {
        timestamp: {
          type: 'string',
          format: 'date-time',
          example: '2024-01-01T12:00:00.000Z',
        },
        application: {
          type: 'object',
          properties: {
            name: { type: 'string', example: 'url-shortener-boost' },
            version: { type: 'string', example: '1.0.0' },
            uptime: { type: 'number', example: 3600 },
            environment: { type: 'string', example: 'production' },
          },
        },
        http: {
          type: 'object',
          properties: {
            requests: {
              type: 'object',
              properties: {
                total: { type: 'number', example: 15000 },
                success: { type: 'number', example: 14500 },
                errors: { type: 'number', example: 500 },
                rate: { type: 'number', example: 25.5 },
              },
            },
            responses: {
              type: 'object',
              properties: {
                '2xx': { type: 'number', example: 14500 },
                '3xx': { type: 'number', example: 8000 },
                '4xx': { type: 'number', example: 400 },
                '5xx': { type: 'number', example: 100 },
              },
            },
            latency: {
              type: 'object',
              properties: {
                p50: { type: 'number', example: 12.5 },
                p90: { type: 'number', example: 25.8 },
                p95: { type: 'number', example: 45.2 },
                p99: { type: 'number', example: 125.7 },
              },
            },
          },
        },
        database: {
          type: 'object',
          properties: {
            connections: {
              type: 'object',
              properties: {
                active: { type: 'number', example: 5 },
                idle: { type: 'number', example: 3 },
                total: { type: 'number', example: 8 },
              },
            },
            queries: {
              type: 'object',
              properties: {
                total: { type: 'number', example: 25000 },
                success: { type: 'number', example: 24950 },
                errors: { type: 'number', example: 50 },
                avgDuration: { type: 'number', example: 8.5 },
              },
            },
          },
        },
        cache: {
          type: 'object',
          properties: {
            hits: { type: 'number', example: 18000 },
            misses: { type: 'number', example: 2000 },
            hitRate: { type: 'number', example: 90.0 },
            avgResponseTime: { type: 'number', example: 1.2 },
          },
        },
        urls: {
          type: 'object',
          properties: {
            total: { type: 'number', example: 15000 },
            active: { type: 'number', example: 14200 },
            expired: { type: 'number', example: 800 },
            redirects: {
              type: 'object',
              properties: {
                total: { type: 'number', example: 75000 },
                today: { type: 'number', example: 2500 },
                rate: { type: 'number', example: 45.8 },
              },
            },
          },
        },
        system: {
          type: 'object',
          properties: {
            memory: {
              type: 'object',
              properties: {
                used: { type: 'number', example: 256000000 },
                total: { type: 'number', example: 1000000000 },
                percentage: { type: 'number', example: 25.6 },
              },
            },
            cpu: {
              type: 'object',
              properties: {
                usage: { type: 'number', example: 15.5 },
                loadAverage: {
                  type: 'array',
                  items: { type: 'number' },
                  example: [0.5, 0.7, 0.8],
                },
              },
            },
          },
        },
      },
    },
  })
  async getMetricsJson(): Promise<any> {
    const isMetricsEnabled = this.configService.get<boolean>('METRICS_ENABLED', true);
    
    if (!isMetricsEnabled) {
      return {
        error: 'Metrics are disabled',
        timestamp: new Date().toISOString(),
      };
    }

    return this.metricsService.getMetricsJson();
  }
}