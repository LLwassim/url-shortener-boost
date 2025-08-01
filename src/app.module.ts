import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ThrottlerModule } from "@nestjs/throttler";
import { BullModule } from "@nestjs/bull";
import * as Joi from "joi";

// Configuration
import { DatabaseConfig } from "./config/database.config";
import { RedisConfig } from "./config/redis.config";
import { validationSchema } from "./config/validation.schema";

// Entities
import { UrlEntity } from "./entities/url.entity";

// Modules
import { UrlModule } from "./modules/url/url.module";
import { AnalyticsModule } from "./modules/analytics/analytics.module";
import { HealthModule } from "./modules/health/health.module";
import { MetricsModule } from "./modules/metrics/metrics.module";
import { KafkaModule } from "./modules/kafka/kafka.module";
import { LoggerModule } from "./modules/logger/logger.module";

// Services
import { LoggerService } from "./services/logger.service";
import { KafkaService } from "./services/kafka.service";
import { CassandraService } from "./services/cassandra.service";
import { MetricsService } from "./services/metrics.service";
import { RedisService } from "./services/redis.service";

// Middleware
import { LoggerMiddleware } from "./middleware/logger.middleware";
import { MetricsMiddleware } from "./middleware/metrics.middleware";

// Guards
import { ApiKeyGuard } from "./guards/api-key.guard";

@Module({
  imports: [
    // Configuration with validation
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema,
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
      ignoreEnvFile: true, // <--- Added to ensure .env is ignored in Docker
    }),

    // Database connection
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: DatabaseConfig,
      inject: [ConfigService],
    }),

    // Add UrlEntity repository for MetricsService
    TypeOrmModule.forFeature([UrlEntity]),

    // Rate limiting
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        throttlers: [
          {
            ttl: configService.get<number>("RATE_LIMIT_TTL", 60) * 1000, // Convert to milliseconds
            limit: configService.get<number>("RATE_LIMIT_LIMIT", 100),
          },
        ],
        skipIf: (context) => {
          const request = context.switchToHttp().getRequest();
          return (
            configService.get<boolean>(
              "RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS",
              false
            ) && request.method === "GET"
          );
        },
      }),
      inject: [ConfigService],
    }),

    // Bull Queue for background jobs
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: RedisConfig,
      inject: [ConfigService],
    }),

    // Feature modules
    UrlModule,
    AnalyticsModule,
    HealthModule,
    //MetricsModule,
    KafkaModule,
    LoggerModule,
  ],
  controllers: [],
  providers: [
    CassandraService,
    ApiKeyGuard,
    // Temporarily provide MetricsService directly to resolve middleware dependency
    MetricsService,
    RedisService, // Required by MetricsService
    {
      provide: "APP_MIDDLEWARE",
      useClass: LoggerMiddleware,
    },
    {
      provide: "METRICS_MIDDLEWARE",
      useClass: MetricsMiddleware,
    },
  ],
  exports: [CassandraService],
})
export class AppModule {
  constructor(private readonly logger: LoggerService) {
    this.logger.log("🎯 AppModule initialized", "AppModule");
  }
}
