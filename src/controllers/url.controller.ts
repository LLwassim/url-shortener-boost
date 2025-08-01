import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpStatus,
  HttpCode,
  Ip,
  Headers,
  UseGuards,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiBearerAuth,
  ApiSecurity,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { UrlService } from '../services/url.service';
import { CreateUrlDto } from '../dto/create-url.dto';
import { CreateUrlResponseDto, UrlListResponseDto } from '../dto/url-response.dto';
import { PaginationQueryDto } from '../dto/query-params.dto';
import { ApiKeyGuard } from '../guards/api-key.guard';
import { LoggerService } from '../services/logger.service';

@ApiTags('URLs')
@Controller('urls')
@UseGuards(ThrottlerGuard)
export class UrlController {
  constructor(
    private readonly urlService: UrlService,
    private readonly logger: LoggerService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a short URL',
    description: 'Creates a new short URL or returns an existing one if the URL was already shortened.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Short URL created successfully',
    type: CreateUrlResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid URL or parameters',
  })
  @ApiResponse({
    status: HttpStatus.TOO_MANY_REQUESTS,
    description: 'Rate limit exceeded',
  })
  async createShortUrl(
    @Body() createUrlDto: CreateUrlDto,
    @Ip() clientIp: string,
    @Headers('user-agent') userAgent: string,
  ): Promise<CreateUrlResponseDto> {
    try {
      const createUrlWithContextDto = {
        ...createUrlDto,
        clientIp,
        userAgent,
      };

      const result = await this.urlService.createShortUrl(createUrlWithContextDto);

      this.logger.log('Short URL created', 'UrlController', {
        code: result.code,
        original: result.original,
        isNew: result.isNew,
        clientIp,
      });

      return result;
    } catch (error) {
      this.logger.error('Failed to create short URL', error.message, 'UrlController', {
        url: createUrlDto.url,
        customAlias: createUrlDto.customAlias,
        clientIp,
        error: error.stack,
      });
      throw error;
    }
  }

  @Get()
  @ApiOperation({
    summary: 'List URLs',
    description: 'Get a paginated list of all URLs with optional filtering and sorting.',
  })
  @ApiQuery({ name: 'page', required: false, description: 'Page number (1-based)', example: 1 })
  @ApiQuery({ name: 'limit', required: false, description: 'Items per page', example: 20 })
  @ApiQuery({ name: 'sort', required: false, description: 'Sort field', example: 'createdAt' })
  @ApiQuery({ name: 'order', required: false, description: 'Sort order', example: 'DESC' })
  @ApiQuery({ name: 'search', required: false, description: 'Search term', example: 'example.com' })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by status', example: 'active' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of URLs retrieved successfully',
    type: UrlListResponseDto,
  })
  async getUrls(@Query() queryParams: PaginationQueryDto): Promise<UrlListResponseDto> {
    try {
      const result = await this.urlService.getUrls(queryParams);

      this.logger.debug('URLs retrieved', 'UrlController', {
        page: queryParams.page,
        limit: queryParams.limit,
        total: result.total,
        search: queryParams.search,
      });

      return result;
    } catch (error) {
      this.logger.error('Failed to get URLs', error.message, 'UrlController', {
        queryParams,
        error: error.stack,
      });
      throw error;
    }
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Get URL statistics',
    description: 'Get overall statistics about URLs in the system.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'URL statistics retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        total: { type: 'number', description: 'Total number of URLs', example: 1500 },
        active: { type: 'number', description: 'Number of active URLs', example: 1350 },
        expired: { type: 'number', description: 'Number of expired URLs', example: 150 },
      },
    },
  })
  async getUrlStats(): Promise<{ total: number; active: number; expired: number }> {
    try {
      const stats = await this.urlService.getUrlStats();

      this.logger.debug('URL stats retrieved', 'UrlController', stats);

      return stats;
    } catch (error) {
      this.logger.error('Failed to get URL stats', error.message, 'UrlController', {
        error: error.stack,
      });
      throw error;
    }
  }

  @Delete(':code')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('ApiKey')
  @ApiOperation({
    summary: 'Delete a URL',
    description: 'Delete a URL by its short code. Requires API key authentication.',
  })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'URL deleted successfully',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'URL not found',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Invalid or missing API key',
  })
  async deleteUrl(
    @Param('code') code: string,
    @Ip() clientIp: string,
  ): Promise<void> {
    try {
      // Validate code format
      if (!code || code.length < 3 || code.length > 50) {
        throw new BadRequestException('Invalid URL code format');
      }

      const deleted = await this.urlService.deleteUrl(code);

      if (!deleted) {
        throw new NotFoundException('URL not found');
      }

      this.logger.logBusiness('url.deleted_by_admin', {
        code,
        clientIp,
      });
    } catch (error) {
      this.logger.error('Failed to delete URL', error.message, 'UrlController', {
        code,
        clientIp,
        error: error.stack,
      });
      throw error;
    }
  }

  @Post('batch')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('ApiKey')
  @ApiOperation({
    summary: 'Create multiple short URLs',
    description: 'Create multiple short URLs in a single request. Requires API key authentication.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Batch URL creation completed',
    schema: {
      type: 'object',
      properties: {
        success: {
          type: 'array',
          items: { $ref: '#/components/schemas/CreateUrlResponseDto' },
        },
        errors: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              url: { type: 'string' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid batch request',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Invalid or missing API key',
  })
  async batchCreateUrls(
    @Body() batchDto: { urls: CreateUrlDto[] },
    @Ip() clientIp: string,
    @Headers('user-agent') userAgent: string,
  ): Promise<{ success: CreateUrlResponseDto[]; errors: Array<{ url: string; error: string }> }> {
    try {
      if (!batchDto.urls || !Array.isArray(batchDto.urls)) {
        throw new BadRequestException('Invalid batch format: urls array is required');
      }

      if (batchDto.urls.length === 0) {
        throw new BadRequestException('At least one URL is required');
      }

      if (batchDto.urls.length > 100) {
        throw new BadRequestException('Maximum 100 URLs allowed per batch');
      }

      const success: CreateUrlResponseDto[] = [];
      const errors: Array<{ url: string; error: string }> = [];

      // Process URLs in parallel with limited concurrency
      const promises = batchDto.urls.map(async (urlDto) => {
        try {
          const createUrlWithContextDto = {
            ...urlDto,
            clientIp,
            userAgent,
          };

          const result = await this.urlService.createShortUrl(createUrlWithContextDto);
          return { success: true, result, url: urlDto.url };
        } catch (error) {
          return { success: false, error: error.message, url: urlDto.url };
        }
      });

      const results = await Promise.allSettled(promises);

      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          if (result.value.success) {
            success.push(result.value.result);
          } else {
            errors.push({
              url: result.value.url,
              error: result.value.error,
            });
          }
        } else {
          errors.push({
            url: 'unknown',
            error: result.reason.message || 'Unknown error',
          });
        }
      });

      this.logger.logBusiness('url.batch_created', {
        totalRequested: batchDto.urls.length,
        successCount: success.length,
        errorCount: errors.length,
        clientIp,
      });

      return { success, errors };
    } catch (error) {
      this.logger.error('Failed to create batch URLs', error.message, 'UrlController', {
        batchSize: batchDto.urls?.length,
        clientIp,
        error: error.stack,
      });
      throw error;
    }
  }
}