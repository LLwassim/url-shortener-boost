import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { join } from 'path';

export const DatabaseConfig = (configService: ConfigService): TypeOrmModuleOptions => {
  return {
    type: 'postgres',
    host: configService.get<string>('DATABASE_HOST'),
    port: configService.get<number>('DATABASE_PORT'),
    username: configService.get<string>('DATABASE_USERNAME'),
    password: configService.get<string>('DATABASE_PASSWORD'),
    database: configService.get<string>('DATABASE_NAME'),
    ssl: configService.get<boolean>('DATABASE_SSL', false),
    entities: [join(__dirname, '../entities/**/*.entity{.ts,.js}')],
    migrations: [join(__dirname, '../migrations/**/*{.ts,.js}')],
    subscribers: [join(__dirname, '../subscribers/**/*{.ts,.js}')],
    synchronize: configService.get<string>('NODE_ENV') === 'development',
    logging: configService.get<boolean>('DATABASE_LOGGING', false),
    logger: 'advanced-console',
    maxQueryExecutionTime: 1000,
    extra: {
      connectionLimit: 10,
      acquireTimeout: 60000,
      timeout: 60000,
    },
    // Connection pool settings
    cache: {
      duration: 30000, // 30 seconds
    },
    // Retry configuration
    retryAttempts: 3,
    retryDelay: 3000,
  };
};