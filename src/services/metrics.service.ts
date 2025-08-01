import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as promClient from 'prom-client';
import { UrlEntity } from '../entities/url.entity';
import { LoggerService } from './logger.service';
import { RedisService } from './redis.service';

@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly register: promClient.Registry;
  
  // HTTP Metrics
  private readonly httpRequestsTotal: promClient.Counter<string>;
  private readonly httpRequestDuration: promClient.Histogram<string>;
  private readonly httpRequestsInFlight: promClient.Gauge<string>;

  // URL Metrics
  private readonly urlsTotal: promClient.Gauge<string>;
  private readonly urlRedirectsTotal: promClient.Counter<string>;
  private readonly urlCreationsTotal: promClient.Counter<string>;

  // Database Metrics
  private readonly dbConnectionsActive: promClient.Gauge;
  private readonly dbQueriesTotal: promClient.Counter<string>;
  private readonly dbQueryDuration: promClient.Histogram<string>;

  // Cache Metrics
  private readonly cacheHitsTotal: promClient.Counter<string>;
  private readonly cacheOperationDuration: promClient.Histogram<string>;

  // System Metrics
  private readonly systemMemoryUsage: promClient.Gauge<string>;
  private readonly systemCpuUsage: promClient.Gauge;

  // Business Metrics
  private readonly activeUrls: promClient.Gauge;
  private readonly expiredUrls: promClient.Gauge;
  private readonly dailyRedirects: promClient.Gauge;

  constructor(
    @InjectRepository(UrlEntity)
    private readonly urlRepository: Repository<UrlEntity>,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly redisService: RedisService,
  ) {
    // Create custom registry
    this.register = new promClient.Registry();

    // Add default metrics (process and Node.js metrics)
    promClient.collectDefaultMetrics({
      register: this.register,
      prefix: 'url_shortener_',
    });

    // HTTP Metrics
    this.httpRequestsTotal = new promClient.Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.register],
    });

    this.httpRequestDuration = new promClient.Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.register],
    });

    this.httpRequestsInFlight = new promClient.Gauge({
      name: 'http_requests_in_flight',
      help: 'Number of HTTP requests currently being processed',
      labelNames: ['method', 'route'],
      registers: [this.register],
    });

    // URL Metrics
    this.urlsTotal = new promClient.Gauge({
      name: 'urls_total',
      help: 'Total number of URLs by status',
      labelNames: ['status'],
      registers: [this.register],
    });

    this.urlRedirectsTotal = new promClient.Counter({
      name: 'url_redirects_total',
      help: 'Total number of URL redirects',
      labelNames: ['code', 'status'],
      registers: [this.register],
    });

    this.urlCreationsTotal = new promClient.Counter({
      name: 'url_creations_total',
      help: 'Total number of URL creations',
      labelNames: ['is_custom', 'has_expiry'],
      registers: [this.register],
    });

    // Database Metrics
    this.dbConnectionsActive = new promClient.Gauge({
      name: 'database_connections_active',
      help: 'Number of active database connections',
      registers: [this.register],
    });

    this.dbQueriesTotal = new promClient.Counter({
      name: 'database_queries_total',
      help: 'Total number of database queries',
      labelNames: ['type', 'status'],
      registers: [this.register],
    });

    this.dbQueryDuration = new promClient.Histogram({
      name: 'database_query_duration_seconds',
      help: 'Duration of database queries in seconds',
      labelNames: ['type'],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
      registers: [this.register],
    });

    // Cache Metrics
    this.cacheHitsTotal = new promClient.Counter({
      name: 'cache_operations_total',
      help: 'Total number of cache operations',
      labelNames: ['operation', 'status'],
      registers: [this.register],
    });

    this.cacheOperationDuration = new promClient.Histogram({
      name: 'cache_operation_duration_seconds',
      help: 'Duration of cache operations in seconds',
      labelNames: ['operation'],
      buckets: [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.025, 0.05, 0.1],
      registers: [this.register],
    });

    // System Metrics
    this.systemMemoryUsage = new promClient.Gauge({
      name: 'system_memory_usage_bytes',
      help: 'System memory usage in bytes',
      labelNames: ['type'],
      registers: [this.register],
    });

    this.systemCpuUsage = new promClient.Gauge({
      name: 'system_cpu_usage_percent',
      help: 'System CPU usage percentage',
      registers: [this.register],
    });

    // Business Metrics
    this.activeUrls = new promClient.Gauge({
      name: 'active_urls_count',
      help: 'Number of active URLs',
      registers: [this.register],
    });

    this.expiredUrls = new promClient.Gauge({
      name: 'expired_urls_count',
      help: 'Number of expired URLs',
      registers: [this.register],
    });

    this.dailyRedirects = new promClient.Gauge({
      name: 'daily_redirects_count',
      help: 'Number of redirects today',
      registers: [this.register],
    });
  }

  async onModuleInit(): Promise<void> {
    // Start collecting business metrics every 30 seconds
    setInterval(() => {
      this.collectBusinessMetrics().catch((error) => {
        this.logger.error('Failed to collect business metrics', error.message, 'MetricsService');
      });
    }, 30000);

    // Start collecting system metrics every 5 seconds
    setInterval(() => {
      this.collectSystemMetrics();
    }, 5000);

    this.logger.log('✅ Metrics service initialized', 'MetricsService');
  }

  /**
   * Get all metrics in Prometheus format
   */
  async getMetrics(): Promise<string> {
    return this.register.metrics();
  }

  /**
   * Get metrics in JSON format for dashboards
   */
  async getMetricsJson(): Promise<any> {
    const metrics = await this.register.getMetricsAsJSON();
    const processedMetrics = this.processMetricsForJson(metrics);

    return {
      timestamp: new Date().toISOString(),
      application: {
        name: this.configService.get<string>('APP_NAME', 'url-shortener-boost'),
        version: process.env.npm_package_version || '1.0.0',
        uptime: process.uptime(),
        environment: this.configService.get<string>('NODE_ENV', 'development'),
      },
      ...processedMetrics,
    };
  }

  /**
   * Record HTTP request metrics
   */
  recordHttpRequest(method: string, route: string, statusCode: number, duration: number): void {
    this.httpRequestsTotal.inc({ method, route, status_code: statusCode.toString() });
    this.httpRequestDuration.observe({ method, route, status_code: statusCode.toString() }, duration / 1000);
  }

  /**
   * Record HTTP request start
   */
  recordHttpRequestStart(method: string, route: string): void {
    this.httpRequestsInFlight.inc({ method, route });
  }

  /**
   * Record HTTP request end
   */
  recordHttpRequestEnd(method: string, route: string): void {
    this.httpRequestsInFlight.dec({ method, route });
  }

  /**
   * Record URL creation
   */
  recordUrlCreation(isCustom: boolean, hasExpiry: boolean): void {
    this.urlCreationsTotal.inc({
      is_custom: isCustom.toString(),
      has_expiry: hasExpiry.toString(),
    });
  }

  /**
   * Record URL redirect
   */
  recordUrlRedirect(code: string, status: 'success' | 'not_found' | 'expired'): void {
    this.urlRedirectsTotal.inc({ code, status });
  }

  /**
   * Record database query
   */
  recordDatabaseQuery(type: string, status: 'success' | 'error', duration: number): void {
    this.dbQueriesTotal.inc({ type, status });
    this.dbQueryDuration.observe({ type }, duration / 1000);
  }

  /**
   * Record cache operation
   */
  recordCacheOperation(operation: string, status: 'hit' | 'miss' | 'error', duration: number): void {
    this.cacheHitsTotal.inc({ operation, status });
    this.cacheOperationDuration.observe({ operation }, duration / 1000);
  }

  /**
   * Collect business metrics from database
   */
  private async collectBusinessMetrics(): Promise<void> {
    try {
      // Get URL counts
      const [totalUrls, expiredUrlsCount] = await Promise.all([
        this.urlRepository.count(),
        this.urlRepository.count({
          where: {
            expiresAt: promClient.register.getSingleMetric('url_shortener_process_start_time_seconds') as any,
          },
        }),
      ]);

      const activeUrlsCount = totalUrls - expiredUrlsCount;

      // Update gauges
      this.urlsTotal.set({ status: 'total' }, totalUrls);
      this.urlsTotal.set({ status: 'active' }, activeUrlsCount);
      this.urlsTotal.set({ status: 'expired' }, expiredUrlsCount);
      
      this.activeUrls.set(activeUrlsCount);
      this.expiredUrls.set(expiredUrlsCount);

      // Get daily redirects (this would come from analytics in a real implementation)
      // For now, we'll use a mock value
      this.dailyRedirects.set(Math.floor(Math.random() * 1000) + 500);

      this.logger.debug('Business metrics collected', 'MetricsService', {
        totalUrls,
        activeUrls: activeUrlsCount,
        expiredUrls: expiredUrlsCount,
      });
    } catch (error) {
      this.logger.error('Failed to collect business metrics', error.message, 'MetricsService');
    }
  }

  /**
   * Collect system metrics
   */
  private collectSystemMetrics(): void {
    try {
      // Memory metrics
      const memUsage = process.memoryUsage();
      this.systemMemoryUsage.set({ type: 'heap_used' }, memUsage.heapUsed);
      this.systemMemoryUsage.set({ type: 'heap_total' }, memUsage.heapTotal);
      this.systemMemoryUsage.set({ type: 'external' }, memUsage.external);
      this.systemMemoryUsage.set({ type: 'rss' }, memUsage.rss);

      // CPU metrics (simplified)
      const cpuUsage = process.cpuUsage();
      const cpuPercent = (cpuUsage.user + cpuUsage.system) / 1000000; // Convert to seconds
      this.systemCpuUsage.set(cpuPercent);
    } catch (error) {
      this.logger.error('Failed to collect system metrics', error.message, 'MetricsService');
    }
  }

  /**
   * Process metrics for JSON format
   */
  private processMetricsForJson(metrics: any[]): any {
    const processed: any = {
      http: {
        requests: { total: 0, success: 0, errors: 0, rate: 0 },
        responses: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 },
        latency: { p50: 0, p90: 0, p95: 0, p99: 0 },
      },
      database: {
        connections: { active: 0, idle: 0, total: 0 },
        queries: { total: 0, success: 0, errors: 0, avgDuration: 0 },
      },
      cache: {
        hits: 0,
        misses: 0,
        hitRate: 0,
        avgResponseTime: 0,
      },
      urls: {
        total: 0,
        active: 0,
        expired: 0,
        redirects: { total: 0, today: 0, rate: 0 },
      },
      system: {
        memory: { used: 0, total: 0, percentage: 0 },
        cpu: { usage: 0, loadAverage: [] },
      },
    };

    // Process metrics and populate the structure
    metrics.forEach((metric) => {
      try {
        switch (metric.name) {
          case 'http_requests_total':
            if (metric.values) {
              metric.values.forEach((value: any) => {
                processed.http.requests.total += value.value;
                const statusCode = parseInt(value.labels.status_code);
                if (statusCode >= 200 && statusCode < 300) {
                  processed.http.requests.success += value.value;
                  processed.http.responses['2xx'] += value.value;
                } else if (statusCode >= 300 && statusCode < 400) {
                  processed.http.responses['3xx'] += value.value;
                } else if (statusCode >= 400 && statusCode < 500) {
                  processed.http.responses['4xx'] += value.value;
                  processed.http.requests.errors += value.value;
                } else if (statusCode >= 500) {
                  processed.http.responses['5xx'] += value.value;
                  processed.http.requests.errors += value.value;
                }
              });
            }
            break;

          case 'urls_total':
            if (metric.values) {
              metric.values.forEach((value: any) => {
                switch (value.labels.status) {
                  case 'total':
                    processed.urls.total = value.value;
                    break;
                  case 'active':
                    processed.urls.active = value.value;
                    break;
                  case 'expired':
                    processed.urls.expired = value.value;
                    break;
                }
              });
            }
            break;

          case 'system_memory_usage_bytes':
            if (metric.values) {
              metric.values.forEach((value: any) => {
                if (value.labels.type === 'heap_used') {
                  processed.system.memory.used = value.value;
                } else if (value.labels.type === 'heap_total') {
                  processed.system.memory.total = value.value;
                }
              });
            }
            break;
        }
      } catch (error) {
        // Skip problematic metrics
      }
    });

    // Calculate derived metrics
    if (processed.system.memory.total > 0) {
      processed.system.memory.percentage = (processed.system.memory.used / processed.system.memory.total) * 100;
    }

    return processed;
  }

  /**
   * Reset all metrics (useful for testing)
   */
  resetMetrics(): void {
    this.register.clear();
  }
}