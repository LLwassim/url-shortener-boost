import { ConfigService } from "@nestjs/config";
import { BullModuleOptions } from "@nestjs/bull";

export const RedisConfig = (
  configService: ConfigService
): BullModuleOptions => {
  return {
    redis: {
      host: configService.get<string>("REDIS_HOST"),
      port: configService.get<number>("REDIS_PORT"),
      password: configService.get<string>("REDIS_PASSWORD"),
      db: configService.get<number>("REDIS_DB", 0),
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      lazyConnect: true,
      // Connection pool settings
      family: 4,
      keepAlive: 30000,
      // Performance optimizations
      connectTimeout: 10000,
      commandTimeout: 5000,
    },
    defaultJobOptions: {
      removeOnComplete: 100,
      removeOnFail: 50,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 2000,
      },
    },
  };
};
