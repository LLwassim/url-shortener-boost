import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MetricsController } from '../../controllers/metrics.controller';
import { MetricsService } from '../../services/metrics.service';
import { UrlEntity } from '../../entities/url.entity';
import { RedisService } from '../../services/redis.service';
import { LoggerService } from '../../services/logger.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([UrlEntity]),
  ],
  controllers: [
    MetricsController,
  ],
  providers: [
    MetricsService,
    RedisService,
    LoggerService,
  ],
  exports: [
    MetricsService,
  ],
})
export class MetricsModule {}