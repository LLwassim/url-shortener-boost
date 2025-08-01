import * as Joi from 'joi';

export const validationSchema = Joi.object({
  // Application
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(3000),
  API_PREFIX: Joi.string().default('api'),
  APP_NAME: Joi.string().default('URL-Shortener-Boost'),

  // Database
  DATABASE_HOST: Joi.string().required(),
  DATABASE_PORT: Joi.number().port().default(5432),
  DATABASE_USERNAME: Joi.string().required(),
  DATABASE_PASSWORD: Joi.string().required(),
  DATABASE_NAME: Joi.string().required(),
  DATABASE_SSL: Joi.boolean().default(false),
  DATABASE_LOGGING: Joi.boolean().default(false),

  // Redis
  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().port().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),
  REDIS_DB: Joi.number().integer().min(0).max(15).default(0),
  REDIS_TTL: Joi.number().integer().positive().default(3600),

  // Kafka
  KAFKA_BROKERS: Joi.string().required(),
  KAFKA_CLIENT_ID: Joi.string().default('url-shortener'),
  KAFKA_CONSUMER_GROUP_ID: Joi.string().default('url-shortener-analytics'),
  KAFKA_TOPIC_HITS: Joi.string().default('url.hits'),

  // Cassandra
  CASSANDRA_HOSTS: Joi.string().required(),
  CASSANDRA_KEYSPACE: Joi.string().default('url_analytics'),
  CASSANDRA_USERNAME: Joi.string().default('cassandra'),
  CASSANDRA_PASSWORD: Joi.string().default('cassandra'),

  // Security
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('24h'),
  API_KEY_HEADER: Joi.string().default('X-API-Key'),
  ADMIN_API_KEY: Joi.string().required(),

  // Rate Limiting
  RATE_LIMIT_TTL: Joi.number().integer().positive().default(60),
  RATE_LIMIT_LIMIT: Joi.number().integer().positive().default(100),
  RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS: Joi.boolean().default(false),

  // URL Configuration
  BASE_URL: Joi.string().uri().required(),
  MAX_URL_LENGTH: Joi.number().integer().positive().default(2048),
  DEFAULT_CODE_LENGTH: Joi.number().integer().min(4).max(16).default(7),
  CUSTOM_ALIAS_MIN_LENGTH: Joi.number().integer().positive().default(3),
  CUSTOM_ALIAS_MAX_LENGTH: Joi.number().integer().positive().default(50),

  // External Services
  VIRUS_TOTAL_API_KEY: Joi.string().optional(),
  ENABLE_URL_SCANNING: Joi.boolean().default(false),

  // Observability
  METRICS_ENABLED: Joi.boolean().default(true),
  METRICS_PATH: Joi.string().default('/metrics'),
  TRACING_ENABLED: Joi.boolean().default(true),
  JAEGER_ENDPOINT: Joi.string().uri().optional(),
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug', 'verbose').default('info'),

  // Health Check
  HEALTH_CHECK_DATABASE: Joi.boolean().default(true),
  HEALTH_CHECK_REDIS: Joi.boolean().default(true),
  HEALTH_CHECK_KAFKA: Joi.boolean().default(true),

  // CORS
  CORS_ENABLED: Joi.boolean().default(true),
  CORS_ORIGIN: Joi.alternatives().try(
    Joi.string(),
    Joi.array().items(Joi.string())
  ).default('*'),
  CORS_METHODS: Joi.string().default('GET,HEAD,PUT,PATCH,POST,DELETE'),
  CORS_CREDENTIALS: Joi.boolean().default(true),

  // Swagger
  SWAGGER_ENABLED: Joi.boolean().default(true),
  SWAGGER_TITLE: Joi.string().default('URL Shortener API'),
  SWAGGER_DESCRIPTION: Joi.string().default('Production-grade URL shortener microservice'),
  SWAGGER_VERSION: Joi.string().default('1.0.0'),
  SWAGGER_PATH: Joi.string().default('docs'),
});