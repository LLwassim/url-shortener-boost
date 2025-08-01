import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UrlEntity } from '../entities/url.entity';
import { RedisService } from '../services/redis.service';
import { KafkaService } from '../services/kafka.service';
import { CassandraService } from '../services/cassandra.service';
import { LoggerService } from '../services/logger.service';

interface HealthCheck {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
  checks: {
    database: HealthCheckResult;
    redis: HealthCheckResult;
    kafka: HealthCheckResult;
    cassandra: HealthCheckResult;
  };
  system: {
    memory: {
      used: number;
      total: number;
      percentage: number;
    };
    cpu: {
      loadAverage: number[];
    };
  };
}

interface HealthCheckResult {
  status: 'healthy' | 'unhealthy';
  responseTime: number;
  error?: string;
  details?: any;
}

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    @InjectRepository(UrlEntity)
    private readonly urlRepository: Repository<UrlEntity>,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly kafkaService: KafkaService,
    private readonly cassandraService: CassandraService,
    private readonly logger: LoggerService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Health check',
    description: 'Get the overall health status of the application and its dependencies.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Application is healthy',
    schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['healthy', 'unhealthy', 'degraded'],
          example: 'healthy',
        },
        timestamp: {
          type: 'string',
          format: 'date-time',
          example: '2024-01-01T12:00:00.000Z',
        },
        uptime: {
          type: 'number',
          description: 'Application uptime in seconds',
          example: 3600,
        },
        version: {
          type: 'string',
          example: '1.0.0',
        },
        environment: {
          type: 'string',
          example: 'production',
        },
        checks: {
          type: 'object',
          properties: {
            database: { $ref: '#/components/schemas/HealthCheckResult' },
            redis: { $ref: '#/components/schemas/HealthCheckResult' },
            kafka: { $ref: '#/components/schemas/HealthCheckResult' },
            cassandra: { $ref: '#/components/schemas/HealthCheckResult' },
          },
        },
        system: {
          type: 'object',
          properties: {
            memory: {
              type: 'object',
              properties: {
                used: { type: 'number' },
                total: { type: 'number' },
                percentage: { type: 'number' },
              },
            },
            cpu: {
              type: 'object',
              properties: {
                loadAverage: {
                  type: 'array',
                  items: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description: 'Application is unhealthy',
  })
  async getHealth(): Promise<HealthCheck> {
    const startTime = Date.now();

    try {
      // Run all health checks in parallel
      const [databaseCheck, redisCheck, kafkaCheck, cassandraCheck] = await Promise.allSettled([
        this.checkDatabase(),
        this.checkRedis(),
        this.checkKafka(),
        this.checkCassandra(),
      ]);

      const checks = {
        database: this.getCheckResult(databaseCheck),
        redis: this.getCheckResult(redisCheck),
        kafka: this.getCheckResult(kafkaCheck),
        cassandra: this.getCheckResult(cassandraCheck),
      };

      // Determine overall status
      const unhealthyChecks = Object.values(checks).filter(check => check.status === 'unhealthy');
      let overallStatus: 'healthy' | 'unhealthy' | 'degraded';

      if (unhealthyChecks.length === 0) {
        overallStatus = 'healthy';
      } else if (checks.database.status === 'unhealthy') {
        // Database is critical
        overallStatus = 'unhealthy';
      } else {
        // Some non-critical services are down
        overallStatus = 'degraded';
      }

      const healthCheck: HealthCheck = {
        status: overallStatus,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0',
        environment: this.configService.get<string>('NODE_ENV', 'development'),
        checks,
        system: this.getSystemInfo(),
      };

      const duration = Date.now() - startTime;
      this.logger.debug('Health check completed', 'HealthController', {
        status: overallStatus,
        duration,
        unhealthyCount: unhealthyChecks.length,
      });

      return healthCheck;
    } catch (error) {
      this.logger.error('Health check failed', error.message, 'HealthController', {
        error: error.stack,
      });

      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0',
        environment: this.configService.get<string>('NODE_ENV', 'development'),
        checks: {
          database: { status: 'unhealthy', responseTime: 0, error: 'Health check failed' },
          redis: { status: 'unhealthy', responseTime: 0, error: 'Health check failed' },
          kafka: { status: 'unhealthy', responseTime: 0, error: 'Health check failed' },
          cassandra: { status: 'unhealthy', responseTime: 0, error: 'Health check failed' },
        },
        system: this.getSystemInfo(),
      };
    }
  }

  @Get('liveness')
  @ApiOperation({
    summary: 'Liveness probe',
    description: 'Kubernetes liveness probe endpoint. Returns 200 if the application is running.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Application is alive',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'alive' },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  })
  async getLiveness(): Promise<{ status: string; timestamp: string }> {
    return {
      status: 'alive',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('readiness')
  @ApiOperation({
    summary: 'Readiness probe',
    description: 'Kubernetes readiness probe endpoint. Returns 200 if the application is ready to serve traffic.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Application is ready',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ready' },
        timestamp: { type: 'string', format: 'date-time' },
        checks: {
          type: 'object',
          properties: {
            database: { type: 'boolean' },
            redis: { type: 'boolean' },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description: 'Application is not ready',
  })
  async getReadiness(): Promise<{ status: string; timestamp: string; checks: any }> {
    try {
      // Check critical services for readiness
      const [databaseReady, redisReady] = await Promise.allSettled([
        this.checkDatabase(),
        this.checkRedis(),
      ]);

      const checks = {
        database: databaseReady.status === 'fulfilled' && databaseReady.value.status === 'healthy',
        redis: redisReady.status === 'fulfilled' && redisReady.value.status === 'healthy',
      };

      const isReady = checks.database && checks.redis;

      return {
        status: isReady ? 'ready' : 'not_ready',
        timestamp: new Date().toISOString(),
        checks,
      };
    } catch (error) {
      this.logger.error('Readiness check failed', error.message, 'HealthController');
      throw error;
    }
  }

  /**
   * Check database connectivity
   */
  private async checkDatabase(): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      await this.urlRepository.query('SELECT 1');
      
      return {
        status: 'healthy',
        responseTime: Date.now() - startTime,
        details: {
          driver: 'postgresql',
          connected: true,
        },
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        error: error.message,
        details: {
          driver: 'postgresql',
          connected: false,
        },
      };
    }
  }

  /**
   * Check Redis connectivity
   */
  private async checkRedis(): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      const pong = await this.redisService.ping();
      
      return {
        status: pong === 'PONG' ? 'healthy' : 'unhealthy',
        responseTime: Date.now() - startTime,
        details: {
          connected: pong === 'PONG',
          response: pong,
        },
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        error: error.message,
        details: {
          connected: false,
        },
      };
    }
  }

  /**
   * Check Kafka connectivity
   */
  private async checkKafka(): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      const [producerHealthy, consumerHealthy] = await Promise.all([
        this.kafkaService.getProducerHealth(),
        this.kafkaService.getConsumerHealth(),
      ]);

      const isHealthy = producerHealthy && consumerHealthy;

      return {
        status: isHealthy ? 'healthy' : 'unhealthy',
        responseTime: Date.now() - startTime,
        details: {
          producer: producerHealthy,
          consumer: consumerHealthy,
        },
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        error: error.message,
        details: {
          producer: false,
          consumer: false,
        },
      };
    }
  }

  /**
   * Check Cassandra connectivity
   */
  private async checkCassandra(): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      const isHealthy = await this.cassandraService.getHealth();
      
      return {
        status: isHealthy ? 'healthy' : 'unhealthy',
        responseTime: Date.now() - startTime,
        details: {
          connected: isHealthy,
        },
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        error: error.message,
        details: {
          connected: false,
        },
      };
    }
  }

  /**
   * Extract result from Promise.allSettled
   */
  private getCheckResult(settledResult: PromiseSettledResult<HealthCheckResult>): HealthCheckResult {
    if (settledResult.status === 'fulfilled') {
      return settledResult.value;
    } else {
      return {
        status: 'unhealthy',
        responseTime: 0,
        error: settledResult.reason?.message || 'Unknown error',
      };
    }
  }

  /**
   * Get system information
   */
  private getSystemInfo() {
    const memUsage = process.memoryUsage();
    const totalMemory = require('os').totalmem();
    const loadAverage = require('os').loadavg();

    return {
      memory: {
        used: memUsage.heapUsed,
        total: totalMemory,
        percentage: (memUsage.heapUsed / totalMemory) * 100,
      },
      cpu: {
        loadAverage,
      },
    };
  }
}