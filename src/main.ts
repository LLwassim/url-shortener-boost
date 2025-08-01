import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { setupObservability } from './config/observability.config';
import { LoggerService } from './services/logger.service';

async function bootstrap() {
  // Setup observability before creating the app
  setupObservability();

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const configService = app.get(ConfigService);
  const logger = app.get(LoggerService);
  
  // Set global logger
  app.useLogger(logger);

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  // Compression middleware
  app.use(compression());

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // API prefix
  const apiPrefix = configService.get<string>('API_PREFIX', 'api');
  app.setGlobalPrefix(apiPrefix);

  // CORS configuration
  if (configService.get<boolean>('CORS_ENABLED', true)) {
    app.enableCors({
      origin: configService.get<string>('CORS_ORIGIN', '*'),
      methods: configService.get<string>('CORS_METHODS', 'GET,HEAD,PUT,PATCH,POST,DELETE'),
      credentials: configService.get<boolean>('CORS_CREDENTIALS', true),
    });
  }

  // Swagger documentation
  if (configService.get<boolean>('SWAGGER_ENABLED', true)) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle(configService.get<string>('SWAGGER_TITLE', 'URL Shortener API'))
      .setDescription(configService.get<string>('SWAGGER_DESCRIPTION', 'Production-grade URL shortener microservice'))
      .setVersion(configService.get<string>('SWAGGER_VERSION', '1.0.0'))
      .addBearerAuth()
      .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'ApiKey')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    const swaggerPath = configService.get<string>('SWAGGER_PATH', 'docs');
    SwaggerModule.setup(swaggerPath, app, document, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });
  }

  // Start server
  const port = configService.get<number>('PORT', 3000);
  await app.listen(port);

  logger.log(`🚀 Application is running on: http://localhost:${port}/${apiPrefix}`, 'Bootstrap');
  logger.log(`📚 Swagger documentation: http://localhost:${port}/${configService.get<string>('SWAGGER_PATH', 'docs')}`, 'Bootstrap');
  logger.log(`📊 Metrics endpoint: http://localhost:${port}/${configService.get<string>('METRICS_PATH', 'metrics')}`, 'Bootstrap');
  logger.log(`💚 Health check: http://localhost:${port}/health`, 'Bootstrap');
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});

bootstrap().catch((error) => {
  console.error('Error starting application:', error);
  process.exit(1);
});