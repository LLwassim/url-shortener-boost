import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../services/logger.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly adminApiKey: string;
  private readonly apiKeyHeader: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.adminApiKey = this.configService.get<string>('ADMIN_API_KEY');
    this.apiKeyHeader = this.configService.get<string>('API_KEY_HEADER', 'X-API-Key');
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const providedApiKey = request.headers[this.apiKeyHeader.toLowerCase()];

    if (!providedApiKey) {
      this.logger.logSecurity('api_key_missing', {
        path: request.url,
        method: request.method,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      }, 'medium');

      throw new UnauthorizedException('API key is required');
    }

    if (providedApiKey !== this.adminApiKey) {
      this.logger.logSecurity('api_key_invalid', {
        path: request.url,
        method: request.method,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
        providedKey: providedApiKey.substring(0, 8) + '...',
      }, 'high');

      throw new UnauthorizedException('Invalid API key');
    }

    this.logger.debug('API key authentication successful', 'ApiKeyGuard', {
      path: request.url,
      method: request.method,
      ip: request.ip,
    });

    return true;
  }
}