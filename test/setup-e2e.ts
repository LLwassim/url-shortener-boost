import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { GenericContainer, StartedTestContainer } from 'testcontainers';

let app: INestApplication;
let postgresContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;

export let testApp: INestApplication;

beforeAll(async () => {
  // Start test containers
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

  // Set test environment variables
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
  process.env.KAFKA_BROKERS = 'localhost:9092';
  process.env.CASSANDRA_HOSTS = 'localhost:9042';

  // Create test application
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleFixture.createNestApplication();
  await app.init();
  
  testApp = app;
}, 180000);

afterAll(async () => {
  if (app) {
    await app.close();
  }
  if (postgresContainer) {
    await postgresContainer.stop();
  }
  if (redisContainer) {
    await redisContainer.stop();
  }
}, 60000);