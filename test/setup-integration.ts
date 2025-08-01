import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { GenericContainer, StartedTestContainer } from 'testcontainers';

let postgresContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;

beforeAll(async () => {
  // Start PostgreSQL container
  postgresContainer = await new GenericContainer('postgres:16-alpine')
    .withEnvironment({
      POSTGRES_USER: 'test',
      POSTGRES_PASSWORD: 'test',
      POSTGRES_DB: 'url_shortener_test',
    })
    .withExposedPorts(5432)
    .withHealthCheck({
      test: ['CMD-SHELL', 'pg_isready -U test -d url_shortener_test'],
      interval: 1000,
      timeout: 3000,
      retries: 30,
      startPeriod: 1000,
    })
    .withWaitStrategy({
      type: 'HEALTH',
    })
    .start();

  // Start Redis container
  redisContainer = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .withHealthCheck({
      test: ['CMD', 'redis-cli', 'ping'],
      interval: 1000,
      timeout: 3000,
      retries: 30,
    })
    .withWaitStrategy({
      type: 'HEALTH',
    })
    .start();

  // Set environment variables for tests
  process.env.DATABASE_HOST = postgresContainer.getHost();
  process.env.DATABASE_PORT = postgresContainer.getMappedPort(5432).toString();
  process.env.DATABASE_USERNAME = 'test';
  process.env.DATABASE_PASSWORD = 'test';
  process.env.DATABASE_NAME = 'url_shortener_test';
  process.env.DATABASE_SSL = 'false';
  process.env.DATABASE_LOGGING = 'false';

  process.env.REDIS_HOST = redisContainer.getHost();
  process.env.REDIS_PORT = redisContainer.getMappedPort(6379).toString();
  process.env.REDIS_PASSWORD = '';
  process.env.REDIS_DB = '0';

  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.ADMIN_API_KEY = 'test-admin-key';
  process.env.BASE_URL = 'http://localhost:3000';
  process.env.ENABLE_URL_SCANNING = 'false';
  process.env.METRICS_ENABLED = 'false';
  process.env.TRACING_ENABLED = 'false';
}, 120000);

afterAll(async () => {
  if (postgresContainer) {
    await postgresContainer.stop();
  }
  if (redisContainer) {
    await redisContainer.stop();
  }
}, 30000);

// Global test utilities
export const createTestingModule = async (imports: any[] = [], providers: any[] = []) => {
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        cache: true,
      }),
      TypeOrmModule.forRoot({
        type: 'postgres',
        host: process.env.DATABASE_HOST,
        port: parseInt(process.env.DATABASE_PORT),
        username: process.env.DATABASE_USERNAME,
        password: process.env.DATABASE_PASSWORD,
        database: process.env.DATABASE_NAME,
        entities: ['src/entities/**/*.entity.ts'],
        synchronize: true,
        dropSchema: true,
        logging: false,
      }),
      ...imports,
    ],
    providers,
  }).compile();
};