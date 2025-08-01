import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from '../../controllers/health.controller';
import { UrlEntity } from '../../entities/url.entity';
import { RedisService } from '../../services/redis.service';
import { KafkaService } from '../../services/kafka.service';
import { CassandraService } from '../../services/cassandra.service';
import { LoggerService } from '../../services/logger.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([UrlEntity]),
  ],
  controllers: [
    HealthController,
  ],
  providers: [
    RedisService,
    KafkaService,
    CassandraService,
    LoggerService,
  ],
})
export class HealthModule {}