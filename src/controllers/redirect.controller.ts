import {
  Controller,
  Get,
  Param,
  Res,
  HttpStatus,
  Ip,
  Headers,
  NotFoundException,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { UrlService } from '../services/url.service';
import { KafkaService } from '../services/kafka.service';
import { LoggerService } from '../services/logger.service';
import { HitEventDto } from '../dto/analytics.dto';
import { UserAgentParser } from '../utils/user-agent-parser';
import { GeoLocationService } from '../services/geo-location.service';

@ApiTags('Redirect')
@Controller()
@UseGuards(ThrottlerGuard)
export class RedirectController {
  constructor(
    private readonly urlService: UrlService,
    private readonly kafkaService: KafkaService,
    private readonly logger: LoggerService,
    private readonly userAgentParser: UserAgentParser,
    private readonly geoLocationService: GeoLocationService,
  ) {}

  @Get(':code')
  @ApiOperation({
    summary: 'Redirect to original URL',
    description: 'Redirects to the original URL associated with the short code.',
  })
  @ApiParam({
    name: 'code',
    description: 'Short URL code',
    example: 'abc123',
  })
  @ApiResponse({
    status: HttpStatus.MOVED_PERMANENTLY,
    description: 'Redirect to original URL',
  })
  @ApiResponse({
    status: HttpStatus.FOUND,
    description: 'Temporary redirect to original URL',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Short URL not found',
  })
  @ApiResponse({
    status: HttpStatus.GONE,
    description: 'Short URL has expired',
  })
  @ApiResponse({
    status: HttpStatus.TOO_MANY_REQUESTS,
    description: 'Rate limit exceeded',
  })
  async redirect(
    @Param('code') code: string,
    @Res() res: Response,
    @Ip() clientIp: string,
    @Headers('user-agent') userAgent: string,
    @Headers('referer') referrer?: string,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // Validate code format
      if (!code || !/^[a-zA-Z0-9_-]+$/.test(code)) {
        throw new BadRequestException('Invalid URL code format');
      }

      // Find URL by code
      const url = await this.urlService.findByCode(code);
      
      if (!url) {
        this.logger.logSecurity('invalid_code_access', {
          code,
          clientIp,
          userAgent,
        }, 'low');
        
        throw new NotFoundException('Short URL not found');
      }

      // Check if URL has expired
      if (url.isExpired()) {
        this.logger.log('Expired URL accessed', 'RedirectController', {
          code,
          expiresAt: url.expiresAt,
          clientIp,
        });

        res.status(HttpStatus.GONE).json({
          statusCode: HttpStatus.GONE,
          message: 'This short URL has expired',
          error: 'Gone',
        });
        return;
      }

      // Validate original URL to prevent open redirects
      if (!this.isValidRedirectUrl(url.original)) {
        this.logger.logSecurity('invalid_redirect_blocked', {
          code,
          original: url.original,
          clientIp,
        }, 'high');
        
        throw new BadRequestException('Invalid redirect URL');
      }

      // Increment hit count asynchronously
      this.urlService.incrementHitCount(code).catch((error) => {
        this.logger.error('Failed to increment hit count', error.message, 'RedirectController', {
          code,
          error: error.stack,
        });
      });

      // Create hit event for analytics
      await this.recordHitEvent(code, clientIp, userAgent, referrer);

      // Perform redirect
      const redirectType = this.getRedirectType(url.original);
      const statusCode = redirectType === 'permanent' ? HttpStatus.MOVED_PERMANENTLY : HttpStatus.FOUND;

      // Add security headers
      res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'X-Robots-Tag': 'noindex, nofollow',
      });

      const duration = Date.now() - startTime;
      this.logger.logBusiness('url.redirected', {
        code,
        original: url.original,
        statusCode,
        duration,
        clientIp,
        referrer,
      });

      res.redirect(statusCode, url.original);
    } catch (error) {
      const duration = Date.now() - startTime;
      
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        this.logger.warn('Redirect failed', 'RedirectController', {
          code,
          error: error.message,
          duration,
          clientIp,
        });
        throw error;
      }

      this.logger.error('Redirect error', error.message, 'RedirectController', {
        code,
        duration,
        clientIp,
        error: error.stack,
      });

      throw error;
    }
  }

  @Get(':code/preview')
  @ApiOperation({
    summary: 'Preview URL information',
    description: 'Get information about a short URL without redirecting.',
  })
  @ApiParam({
    name: 'code',
    description: 'Short URL code',
    example: 'abc123',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'URL preview information',
    schema: {
      type: 'object',
      properties: {
        code: { type: 'string', example: 'abc123' },
        original: { type: 'string', example: 'https://example.com' },
        createdAt: { type: 'string', format: 'date-time' },
        expiresAt: { type: 'string', format: 'date-time', nullable: true },
        hitCount: { type: 'number', example: 42 },
        isExpired: { type: 'boolean', example: false },
        metadata: { type: 'object', nullable: true },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Short URL not found',
  })
  async previewUrl(@Param('code') code: string): Promise<any> {
    try {
      // Validate code format
      if (!code || !/^[a-zA-Z0-9_-]+$/.test(code)) {
        throw new BadRequestException('Invalid URL code format');
      }

      const url = await this.urlService.findByCode(code);
      
      if (!url) {
        throw new NotFoundException('Short URL not found');
      }

      return {
        code: url.code,
        original: url.original,
        createdAt: url.createdAt,
        expiresAt: url.expiresAt,
        hitCount: Number(url.hitCount),
        isExpired: url.isExpired(),
        metadata: url.metadata,
      };
    } catch (error) {
      this.logger.error('Preview failed', error.message, 'RedirectController', {
        code,
        error: error.stack,
      });
      throw error;
    }
  }

  /**
   * Record hit event for analytics
   */
  private async recordHitEvent(
    code: string,
    ip: string,
    userAgent: string,
    referrer?: string,
  ): Promise<void> {
    try {
      // Parse user agent to extract device info
      const deviceInfo = this.userAgentParser.parse(userAgent);
      
      // Get geographic information from IP
      const geoInfo = await this.geoLocationService.getLocationFromIp(ip);

      const hitEvent: HitEventDto = {
        code,
        timestamp: new Date(),
        ip,
        userAgent,
        referrer: referrer || 'direct',
        country: geoInfo?.country,
        city: geoInfo?.city,
        deviceType: deviceInfo.deviceType,
        browser: deviceInfo.browser,
        os: deviceInfo.os,
      };

      // Publish to Kafka for analytics processing
      await this.kafkaService.publishHitEvent(hitEvent);

      this.logger.debug('Hit event recorded', 'RedirectController', {
        code,
        ip,
        deviceType: deviceInfo.deviceType,
        country: geoInfo?.country,
      });
    } catch (error) {
      this.logger.error('Failed to record hit event', error.message, 'RedirectController', {
        code,
        ip,
        error: error.stack,
      });
      // Don't throw error to avoid breaking redirect flow
    }
  }

  /**
   * Validate redirect URL to prevent open redirects
   */
  private isValidRedirectUrl(url: string): boolean {
    try {
      const parsedUrl = new URL(url);
      
      // Only allow HTTP and HTTPS protocols
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return false;
      }

      // Block localhost, private IPs, and suspicious domains
      const hostname = parsedUrl.hostname.toLowerCase();
      
      // Block localhost
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
        return false;
      }

      // Block private IP ranges
      if (this.isPrivateIp(hostname)) {
        return false;
      }

      // Block suspicious TLDs (you can extend this list)
      const suspiciousTlds = ['.tk', '.ml', '.ga', '.cf'];
      if (suspiciousTlds.some(tld => hostname.endsWith(tld))) {
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if hostname is a private IP address
   */
  private isPrivateIp(hostname: string): boolean {
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const match = hostname.match(ipv4Regex);
    
    if (!match) {
      return false;
    }

    const [, a, b, c, d] = match.map(Number);
    
    // Check for private IP ranges
    return (
      (a === 10) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) || // Link-local
      (a === 127) // Loopback
    );
  }

  /**
   * Determine redirect type based on URL
   */
  private getRedirectType(url: string): 'permanent' | 'temporary' {
    try {
      const parsedUrl = new URL(url);
      
      // Use permanent redirect for common social media and well-known sites
      const permanentDomains = [
        'youtube.com', 'youtu.be',
        'github.com', 'gitlab.com',
        'twitter.com', 'x.com',
        'facebook.com', 'instagram.com',
        'linkedin.com',
        'medium.com',
        'stackoverflow.com',
      ];

      const hostname = parsedUrl.hostname.toLowerCase().replace(/^www\./, '');
      
      if (permanentDomains.includes(hostname)) {
        return 'permanent';
      }

      // Use temporary redirect for everything else to allow flexibility
      return 'temporary';
    } catch (error) {
      return 'temporary';
    }
  }
}