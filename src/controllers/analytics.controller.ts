import {
  Controller,
  Get,
  Param,
  Query,
  HttpStatus,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { CassandraService } from '../services/cassandra.service';
import { UrlService } from '../services/url.service';
import { LoggerService } from '../services/logger.service';
import { AnalyticsQueryDto, AnalyticsResponseDto } from '../dto/analytics.dto';

@ApiTags('Analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly cassandraService: CassandraService,
    private readonly urlService: UrlService,
    private readonly logger: LoggerService,
  ) {}

  @Get(':code')
  @ApiOperation({
    summary: 'Get URL analytics',
    description: 'Retrieve detailed analytics for a specific short URL including hits, geographic data, devices, and more.',
  })
  @ApiParam({
    name: 'code',
    description: 'Short URL code',
    example: 'abc123',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: 'Start date for analytics (ISO 8601)',
    example: '2024-01-01T00:00:00.000Z',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'End date for analytics (ISO 8601)',
    example: '2024-01-31T23:59:59.000Z',
  })
  @ApiQuery({
    name: 'granularity',
    required: false,
    description: 'Time granularity for data aggregation',
    enum: ['minute', 'hour', 'day', 'week', 'month'],
    example: 'hour',
  })
  @ApiQuery({
    name: 'topLimit',
    required: false,
    description: 'Limit for top referrers',
    example: 10,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Analytics data retrieved successfully',
    type: AnalyticsResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Short URL not found',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid query parameters',
  })
  async getUrlAnalytics(
    @Param('code') code: string,
    @Query() queryDto: AnalyticsQueryDto,
  ): Promise<AnalyticsResponseDto> {
    try {
      // Validate code format
      if (!code || !/^[a-zA-Z0-9_-]+$/.test(code)) {
        throw new BadRequestException('Invalid URL code format');
      }

      // Verify URL exists
      const url = await this.urlService.findByCode(code);
      if (!url) {
        throw new NotFoundException('Short URL not found');
      }

      // Validate date range
      let startDate: Date | undefined;
      let endDate: Date | undefined;

      if (queryDto.startDate) {
        startDate = new Date(queryDto.startDate);
        if (isNaN(startDate.getTime())) {
          throw new BadRequestException('Invalid start date format');
        }
      }

      if (queryDto.endDate) {
        endDate = new Date(queryDto.endDate);
        if (isNaN(endDate.getTime())) {
          throw new BadRequestException('Invalid end date format');
        }
      }

      if (startDate && endDate && startDate > endDate) {
        throw new BadRequestException('Start date must be before end date');
      }

      // Get analytics data from Cassandra
      const analytics = await this.cassandraService.getAnalytics(
        code,
        startDate,
        endDate,
        queryDto.granularity,
      );

      this.logger.debug('Analytics retrieved', 'AnalyticsController', {
        code,
        totalHits: analytics.totalHits,
        uniqueVisitors: analytics.uniqueVisitors,
        timeSeriesPoints: analytics.timeSeries.length,
        startDate: queryDto.startDate,
        endDate: queryDto.endDate,
        granularity: queryDto.granularity,
      });

      return analytics;
    } catch (error) {
      this.logger.error('Failed to get analytics', error.message, 'AnalyticsController', {
        code,
        queryDto,
        error: error.stack,
      });
      throw error;
    }
  }

  @Get(':code/summary')
  @ApiOperation({
    summary: 'Get URL analytics summary',
    description: 'Get a quick summary of URL analytics including total hits and basic stats.',
  })
  @ApiParam({
    name: 'code',
    description: 'Short URL code',
    example: 'abc123',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Analytics summary retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        code: { type: 'string', example: 'abc123' },
        totalHits: { type: 'number', example: 1547 },
        uniqueVisitors: { type: 'number', example: 892 },
        firstAccessed: { type: 'string', format: 'date-time', nullable: true },
        lastAccessed: { type: 'string', format: 'date-time', nullable: true },
        topCountry: { type: 'string', example: 'United States' },
        topReferrer: { type: 'string', example: 'https://google.com' },
        topDevice: { type: 'string', example: 'desktop' },
        topBrowser: { type: 'string', example: 'Chrome' },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Short URL not found',
  })
  async getAnalyticsSummary(@Param('code') code: string): Promise<any> {
    try {
      // Validate code format
      if (!code || !/^[a-zA-Z0-9_-]+$/.test(code)) {
        throw new BadRequestException('Invalid URL code format');
      }

      // Verify URL exists
      const url = await this.urlService.findByCode(code);
      if (!url) {
        throw new NotFoundException('Short URL not found');
      }

      // Get full analytics data
      const analytics = await this.cassandraService.getAnalytics(code);

      // Extract summary information
      const summary = {
        code,
        totalHits: analytics.totalHits,
        uniqueVisitors: analytics.uniqueVisitors,
        firstAccessed: analytics.firstAccessed,
        lastAccessed: analytics.lastAccessed,
        topCountry: analytics.geographic[0]?.country || null,
        topReferrer: analytics.topReferrers[0]?.referrer || null,
        topDevice: analytics.devices[0]?.deviceType || null,
        topBrowser: analytics.browsers[0]?.browser || null,
      };

      this.logger.debug('Analytics summary retrieved', 'AnalyticsController', {
        code,
        totalHits: summary.totalHits,
      });

      return summary;
    } catch (error) {
      this.logger.error('Failed to get analytics summary', error.message, 'AnalyticsController', {
        code,
        error: error.stack,
      });
      throw error;
    }
  }

  @Get()
  @ApiOperation({
    summary: 'Get global analytics',
    description: 'Get global analytics across all URLs including total hits, top URLs, and system metrics.',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: 'Start date for analytics (ISO 8601)',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'End date for analytics (ISO 8601)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Limit for top URLs',
    example: 10,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Global analytics retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        totalUrls: { type: 'number', example: 15000 },
        totalHits: { type: 'number', example: 250000 },
        totalUniqueVisitors: { type: 'number', example: 180000 },
        topUrls: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              original: { type: 'string' },
              hits: { type: 'number' },
            },
          },
        },
        topCountries: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              country: { type: 'string' },
              hits: { type: 'number' },
            },
          },
        },
        deviceDistribution: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              deviceType: { type: 'string' },
              percentage: { type: 'number' },
            },
          },
        },
      },
    },
  })
  async getGlobalAnalytics(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit: number = 10,
  ): Promise<any> {
    try {
      // Validate date parameters
      let start: Date | undefined;
      let end: Date | undefined;

      if (startDate) {
        start = new Date(startDate);
        if (isNaN(start.getTime())) {
          throw new BadRequestException('Invalid start date format');
        }
      }

      if (endDate) {
        end = new Date(endDate);
        if (isNaN(end.getTime())) {
          throw new BadRequestException('Invalid end date format');
        }
      }

      if (start && end && start > end) {
        throw new BadRequestException('Start date must be before end date');
      }

      // Validate limit
      if (limit < 1 || limit > 100) {
        throw new BadRequestException('Limit must be between 1 and 100');
      }

      // Get URL statistics
      const urlStats = await this.urlService.getUrlStats();

      // For now, return mock global analytics
      // In a real implementation, you would aggregate data from Cassandra
      const globalAnalytics = {
        totalUrls: urlStats.total,
        totalHits: 250000, // This would come from aggregating Cassandra data
        totalUniqueVisitors: 180000,
        topUrls: [
          { code: 'popular1', original: 'https://example.com/popular-page', hits: 15000 },
          { code: 'trending2', original: 'https://github.com/awesome-project', hits: 12500 },
          { code: 'viral3', original: 'https://youtube.com/watch?v=awesome', hits: 10000 },
        ].slice(0, limit),
        topCountries: [
          { country: 'United States', hits: 75000 },
          { country: 'United Kingdom', hits: 45000 },
          { country: 'Germany', hits: 35000 },
          { country: 'France', hits: 25000 },
          { country: 'Japan', hits: 20000 },
        ].slice(0, limit),
        deviceDistribution: [
          { deviceType: 'desktop', percentage: 65.5 },
          { deviceType: 'mobile', percentage: 28.2 },
          { deviceType: 'tablet', percentage: 6.3 },
        ],
        timeRange: {
          startDate: start?.toISOString(),
          endDate: end?.toISOString(),
        },
      };

      this.logger.debug('Global analytics retrieved', 'AnalyticsController', {
        totalUrls: globalAnalytics.totalUrls,
        totalHits: globalAnalytics.totalHits,
        timeRange: globalAnalytics.timeRange,
      });

      return globalAnalytics;
    } catch (error) {
      this.logger.error('Failed to get global analytics', error.message, 'AnalyticsController', {
        startDate,
        endDate,
        limit,
        error: error.stack,
      });
      throw error;
    }
  }

  @Get(':code/export')
  @ApiOperation({
    summary: 'Export URL analytics',
    description: 'Export detailed analytics data for a URL in CSV format.',
  })
  @ApiParam({
    name: 'code',
    description: 'Short URL code',
    example: 'abc123',
  })
  @ApiQuery({
    name: 'format',
    required: false,
    description: 'Export format',
    enum: ['csv', 'json'],
    example: 'csv',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: 'Start date for export (ISO 8601)',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'End date for export (ISO 8601)',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Analytics data exported successfully',
    content: {
      'text/csv': {
        schema: {
          type: 'string',
        },
      },
      'application/json': {
        schema: {
          type: 'object',
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Short URL not found',
  })
  async exportAnalytics(
    @Param('code') code: string,
    @Query('format') format: 'csv' | 'json' = 'csv',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<any> {
    try {
      // Validate code format
      if (!code || !/^[a-zA-Z0-9_-]+$/.test(code)) {
        throw new BadRequestException('Invalid URL code format');
      }

      // Verify URL exists
      const url = await this.urlService.findByCode(code);
      if (!url) {
        throw new NotFoundException('Short URL not found');
      }

      // Validate dates
      let start: Date | undefined;
      let end: Date | undefined;

      if (startDate) {
        start = new Date(startDate);
        if (isNaN(start.getTime())) {
          throw new BadRequestException('Invalid start date format');
        }
      }

      if (endDate) {
        end = new Date(endDate);
        if (isNaN(end.getTime())) {
          throw new BadRequestException('Invalid end date format');
        }
      }

      // Get analytics data
      const analytics = await this.cassandraService.getAnalytics(code, start, end, 'hour');

      if (format === 'csv') {
        // Convert to CSV format
        let csv = 'timestamp,hits\n';
        analytics.timeSeries.forEach(point => {
          csv += `${point.timestamp},${point.hits}\n`;
        });

        this.logger.debug('Analytics exported as CSV', 'AnalyticsController', {
          code,
          dataPoints: analytics.timeSeries.length,
        });

        return csv;
      } else {
        // Return JSON format
        this.logger.debug('Analytics exported as JSON', 'AnalyticsController', {
          code,
          totalHits: analytics.totalHits,
        });

        return {
          code,
          exportedAt: new Date().toISOString(),
          timeRange: {
            startDate: start?.toISOString(),
            endDate: end?.toISOString(),
          },
          data: analytics,
        };
      }
    } catch (error) {
      this.logger.error('Failed to export analytics', error.message, 'AnalyticsController', {
        code,
        format,
        startDate,
        endDate,
        error: error.stack,
      });
      throw error;
    }
  }
}