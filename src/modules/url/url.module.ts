import { Module, MiddlewareConsumer, RequestMethod } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UrlEntity } from "../../entities/url.entity";
import { UrlController } from "../../controllers/url.controller";
import { RedirectController } from "../../controllers/redirect.controller";
import { UrlService } from "../../services/url.service";
import { RedisService } from "../../services/redis.service";
import { VirusTotalService } from "../../services/virus-total.service";
import { KafkaService } from "../../services/kafka.service";
import { GeoLocationService } from "../../services/geo-location.service";
import { UserAgentParser } from "../../utils/user-agent-parser";
import { LoggerService } from "../../services/logger.service";
import { MetricsService } from "../../services/metrics.service";
import { LoggerMiddleware } from "../../middleware/logger.middleware";
import { MetricsMiddleware } from "../../middleware/metrics.middleware";

@Module({
  imports: [TypeOrmModule.forFeature([UrlEntity])],
  controllers: [UrlController, RedirectController],
  providers: [
    UrlService,
    RedisService,
    VirusTotalService,
    GeoLocationService,
    UserAgentParser,
    LoggerService,
    MetricsService,
  ],
  exports: [
    UrlService,
    RedisService,
    VirusTotalService,
    GeoLocationService,
    UserAgentParser,
  ],
})
export class UrlModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(LoggerMiddleware, MetricsMiddleware)
      .forRoutes(
        { path: "api/urls", method: RequestMethod.ALL },
        { path: "api/urls/*", method: RequestMethod.ALL },
        { path: ":code", method: RequestMethod.GET },
        { path: ":code/preview", method: RequestMethod.GET }
      );
  }
}
