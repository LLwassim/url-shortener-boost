import { Module, MiddlewareConsumer, RequestMethod } from "@nestjs/common";
import { AnalyticsController } from "../../controllers/analytics.controller";
import { CassandraService } from "../../services/cassandra.service";
import { AnalyticsConsumerService } from "../../services/analytics-consumer.service";
import { KafkaService } from "../../services/kafka.service";
import { UrlService } from "../../services/url.service";
import { LoggerService } from "../../services/logger.service";
import { LoggerMiddleware } from "../../middleware/logger.middleware";
import { MetricsMiddleware } from "../../middleware/metrics.middleware";
import { UrlModule } from "../url/url.module";
import { MetricsModule } from "../metrics/metrics.module";

@Module({
  imports: [
    UrlModule, // Import to get UrlService
    MetricsModule, // Import to get MetricsService for MetricsMiddleware
  ],
  controllers: [AnalyticsController],
  providers: [CassandraService, AnalyticsConsumerService, LoggerService],
  exports: [CassandraService, AnalyticsConsumerService],
})
export class AnalyticsModule {
  constructor() {
    console.log("AnalyticsModule constructed");
  }
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(LoggerMiddleware, MetricsMiddleware)
      .forRoutes(
        { path: "api/analytics", method: RequestMethod.ALL },
        { path: "api/analytics/*", method: RequestMethod.ALL }
      );
  }
}
