import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindManyOptions, Like, IsNull, Not } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { nanoid } from 'nanoid';
import { URL } from 'url';
import { UrlEntity } from '../entities/url.entity';
import { CreateUrlDto, CreateUrlWithContextDto } from '../dto/create-url.dto';
import { CreateUrlResponseDto, UrlResponseDto, UrlListResponseDto } from '../dto/url-response.dto';
import { PaginationQueryDto } from '../dto/query-params.dto';
import { LoggerService } from './logger.service';
import { RedisService } from './redis.service';
import { VirusTotalService } from './virus-total.service';

@Injectable()
export class UrlService {
  private readonly baseUrl: string;
  private readonly defaultCodeLength: number;
  private readonly maxUrlLength: number;
  private readonly customAliasMinLength: number;
  private readonly customAliasMaxLength: number;
  private readonly enableUrlScanning: boolean;

  constructor(
    @InjectRepository(UrlEntity)
    private readonly urlRepository: Repository<UrlEntity>,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly redisService: RedisService,
    private readonly virusTotalService: VirusTotalService,
  ) {
    this.baseUrl = this.configService.get<string>('BASE_URL');
    this.defaultCodeLength = this.configService.get<number>('DEFAULT_CODE_LENGTH', 7);
    this.maxUrlLength = this.configService.get<number>('MAX_URL_LENGTH', 2048);
    this.customAliasMinLength = this.configService.get<number>('CUSTOM_ALIAS_MIN_LENGTH', 3);
    this.customAliasMaxLength = this.configService.get<number>('CUSTOM_ALIAS_MAX_LENGTH', 50);
    this.enableUrlScanning = this.configService.get<boolean>('ENABLE_URL_SCANNING', false);
  }

  /**
   * Create a new short URL or return existing one
   */
  async createShortUrl(createUrlDto: CreateUrlWithContextDto): Promise<CreateUrlResponseDto> {
    try {
      // Validate and normalize URL
      const normalizedUrl = this.normalizeUrl(createUrlDto.url);
      
      // Check for malicious URLs if scanning is enabled
      if (this.enableUrlScanning) {
        await this.checkUrlSafety(normalizedUrl);
      }

      // Check if URL already exists
      const existingUrl = await this.findByNormalizedUrl(normalizedUrl);
      if (existingUrl && !existingUrl.isExpired()) {
        this.logger.logBusiness('url.found_existing', {
          code: existingUrl.code,
          original: existingUrl.original,
          clientIp: createUrlDto.clientIp,
        });

        return {
          code: existingUrl.code,
          shortUrl: existingUrl.getShortUrl(this.baseUrl),
          original: existingUrl.original,
          createdAt: existingUrl.createdAt,
          expiresAt: existingUrl.expiresAt,
          isNew: false,
        };
      }

      // Generate or validate custom code
      const code = createUrlDto.customAlias 
        ? await this.validateCustomAlias(createUrlDto.customAlias)
        : await this.generateUniqueCode();

      // Create new URL entity
      const urlEntity = this.urlRepository.create({
        code,
        original: createUrlDto.url,
        normalized: normalizedUrl,
        customAlias: createUrlDto.customAlias,
        expiresAt: createUrlDto.expiresAt ? new Date(createUrlDto.expiresAt) : undefined,
        creatorIp: createUrlDto.clientIp,
        creatorUserAgent: createUrlDto.userAgent,
        metadata: createUrlDto.metadata,
      });

      // Save to database
      const savedUrl = await this.urlRepository.save(urlEntity);

      // Cache the URL for faster redirects
      await this.cacheUrl(savedUrl);

      this.logger.logBusiness('url.created', {
        code: savedUrl.code,
        original: savedUrl.original,
        customAlias: savedUrl.customAlias,
        expiresAt: savedUrl.expiresAt,
        clientIp: createUrlDto.clientIp,
      });

      return {
        code: savedUrl.code,
        shortUrl: savedUrl.getShortUrl(this.baseUrl),
        original: savedUrl.original,
        createdAt: savedUrl.createdAt,
        expiresAt: savedUrl.expiresAt,
        isNew: true,
      };
    } catch (error) {
      this.logger.error('Failed to create short URL', error.message, 'UrlService', {
        url: createUrlDto.url,
        customAlias: createUrlDto.customAlias,
        clientIp: createUrlDto.clientIp,
        error: error.stack,
      });
      throw error;
    }
  }

  /**
   * Find URL by code for redirect
   */
  async findByCode(code: string): Promise<UrlEntity | null> {
    try {
      // Try cache first
      const cachedUrl = await this.getCachedUrl(code);
      if (cachedUrl) {
        return cachedUrl;
      }

      // Fallback to database
      const url = await this.urlRepository.findOne({ where: { code } });
      
      if (url) {
        // Cache for future requests
        await this.cacheUrl(url);
      }

      return url;
    } catch (error) {
      this.logger.error('Failed to find URL by code', error.message, 'UrlService', {
        code,
        error: error.stack,
      });
      return null;
    }
  }

  /**
   * Get paginated list of URLs
   */
  async getUrls(queryParams: PaginationQueryDto): Promise<UrlListResponseDto> {
    try {
      const { page, limit, sort, order, search, status } = queryParams.normalize();
      
      const queryBuilder = this.urlRepository.createQueryBuilder('url');

      // Apply search filter
      if (search) {
        queryBuilder.where(
          'url.original ILIKE :search OR url.code ILIKE :search',
          { search: `%${search}%` }
        );
      }

      // Apply status filter
      if (status === 'active') {
        queryBuilder.andWhere('(url.expiresAt IS NULL OR url.expiresAt > :now)', { now: new Date() });
      } else if (status === 'expired') {
        queryBuilder.andWhere('url.expiresAt IS NOT NULL AND url.expiresAt <= :now', { now: new Date() });
      }

      // Apply sorting
      queryBuilder.orderBy(`url.${sort}`, order);

      // Apply pagination
      queryBuilder.skip(queryParams.offset).take(limit);

      // Execute query
      const [urls, total] = await queryBuilder.getManyAndCount();

      const totalPages = Math.ceil(total / limit);
      const hasNext = page < totalPages;
      const hasPrev = page > 1;

      const urlResponses: UrlResponseDto[] = urls.map(url => ({
        id: url.id,
        code: url.code,
        original: url.original,
        shortUrl: url.getShortUrl(this.baseUrl),
        hitCount: Number(url.hitCount),
        customAlias: url.customAlias,
        expiresAt: url.expiresAt,
        createdAt: url.createdAt,
        updatedAt: url.updatedAt,
        metadata: url.metadata,
        isExpired: url.isExpired(),
      }));

      this.logger.debug('Retrieved URL list', 'UrlService', {
        page,
        limit,
        total,
        search,
        status,
      });

      return {
        urls: urlResponses,
        total,
        page,
        limit,
        totalPages,
        hasNext,
        hasPrev,
      };
    } catch (error) {
      this.logger.error('Failed to get URLs', error.message, 'UrlService', {
        queryParams,
        error: error.stack,
      });
      throw error;
    }
  }

  /**
   * Delete URL by code
   */
  async deleteUrl(code: string): Promise<boolean> {
    try {
      const result = await this.urlRepository.delete({ code });
      
      if (result.affected > 0) {
        // Remove from cache
        await this.removeCachedUrl(code);
        
        this.logger.logBusiness('url.deleted', { code });
        return true;
      }
      
      return false;
    } catch (error) {
      this.logger.error('Failed to delete URL', error.message, 'UrlService', {
        code,
        error: error.stack,
      });
      throw error;
    }
  }

  /**
   * Increment hit count for a URL
   */
  async incrementHitCount(code: string): Promise<void> {
    try {
      await this.urlRepository.increment({ code }, 'hitCount', 1);
      
      // Update cache with new hit count
      const url = await this.findByCode(code);
      if (url) {
        await this.cacheUrl(url);
      }
    } catch (error) {
      this.logger.error('Failed to increment hit count', error.message, 'UrlService', {
        code,
        error: error.stack,
      });
      // Don't throw error to avoid breaking redirect flow
    }
  }

  /**
   * Normalize URL for deduplication
   */
  private normalizeUrl(url: string): string {
    try {
      const parsedUrl = new URL(url);
      
      // Remove common tracking parameters
      const trackingParams = [
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
        'gclid', 'fbclid', 'msclkid', 'dclid', 'source', 'medium', 'campaign',
      ];
      
      trackingParams.forEach(param => {
        parsedUrl.searchParams.delete(param);
      });

      // Normalize protocol
      if (parsedUrl.protocol === 'http:' && parsedUrl.port === '80') {
        parsedUrl.port = '';
      }
      if (parsedUrl.protocol === 'https:' && parsedUrl.port === '443') {
        parsedUrl.port = '';
      }

      // Remove trailing slash
      if (parsedUrl.pathname.endsWith('/') && parsedUrl.pathname.length > 1) {
        parsedUrl.pathname = parsedUrl.pathname.slice(0, -1);
      }

      // Convert to lowercase for hostname
      parsedUrl.hostname = parsedUrl.hostname.toLowerCase();

      return parsedUrl.toString();
    } catch (error) {
      // If URL parsing fails, return original URL
      return url;
    }
  }

  /**
   * Generate a unique short code
   */
  private async generateUniqueCode(): Promise<string> {
    const maxAttempts = 10;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const code = nanoid(this.defaultCodeLength);
      
      // Check if code already exists
      const existing = await this.urlRepository.findOne({ where: { code } });
      if (!existing) {
        return code;
      }
    }
    
    // If we can't find a unique code, increase length
    return nanoid(this.defaultCodeLength + 2);
  }

  /**
   * Validate custom alias
   */
  private async validateCustomAlias(alias: string): Promise<string> {
    // Check length
    if (alias.length < this.customAliasMinLength || alias.length > this.customAliasMaxLength) {
      throw new BadRequestException(
        `Custom alias must be between ${this.customAliasMinLength} and ${this.customAliasMaxLength} characters`
      );
    }

    // Check if alias already exists
    const existing = await this.urlRepository.findOne({ where: { code: alias } });
    if (existing) {
      throw new BadRequestException('Custom alias already exists');
    }

    return alias;
  }

  /**
   * Find URL by normalized URL
   */
  private async findByNormalizedUrl(normalizedUrl: string): Promise<UrlEntity | null> {
    return this.urlRepository.findOne({ where: { normalized: normalizedUrl } });
  }

  /**
   * Cache URL in Redis
   */
  private async cacheUrl(url: UrlEntity): Promise<void> {
    try {
      const cacheKey = `url:${url.code}`;
      const cacheValue = {
        original: url.original,
        expiresAt: url.expiresAt?.toISOString(),
        hitCount: Number(url.hitCount),
      };

      const ttl = this.configService.get<number>('REDIS_TTL', 3600);
      await this.redisService.setex(cacheKey, ttl, JSON.stringify(cacheValue));
    } catch (error) {
      this.logger.error('Failed to cache URL', error.message, 'UrlService', {
        code: url.code,
        error: error.stack,
      });
      // Don't throw error as caching is not critical
    }
  }

  /**
   * Get cached URL from Redis
   */
  private async getCachedUrl(code: string): Promise<UrlEntity | null> {
    try {
      const cacheKey = `url:${code}`;
      const cached = await this.redisService.get(cacheKey);
      
      if (!cached) {
        return null;
      }

      const data = JSON.parse(cached);
      
      // Create a partial URL entity for redirect purposes
      const url = new UrlEntity();
      url.code = code;
      url.original = data.original;
      url.expiresAt = data.expiresAt ? new Date(data.expiresAt) : undefined;
      url.hitCount = data.hitCount || 0;
      
      return url;
    } catch (error) {
      this.logger.error('Failed to get cached URL', error.message, 'UrlService', {
        code,
        error: error.stack,
      });
      return null;
    }
  }

  /**
   * Remove cached URL from Redis
   */
  private async removeCachedUrl(code: string): Promise<void> {
    try {
      const cacheKey = `url:${code}`;
      await this.redisService.del(cacheKey);
    } catch (error) {
      this.logger.error('Failed to remove cached URL', error.message, 'UrlService', {
        code,
        error: error.stack,
      });
      // Don't throw error as this is not critical
    }
  }

  /**
   * Check URL safety using VirusTotal
   */
  private async checkUrlSafety(url: string): Promise<void> {
    try {
      const isSafe = await this.virusTotalService.checkUrl(url);
      if (!isSafe) {
        this.logger.logSecurity('malicious_url_blocked', {
          url,
          service: 'virustotal',
        }, 'high');
        
        throw new BadRequestException('URL appears to be malicious and cannot be shortened');
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      
      // If scanning fails, log warning but don't block URL creation
      this.logger.warn('URL safety check failed', 'UrlService', {
        url,
        error: error.message,
      });
    }
  }

  /**
   * Get URL statistics
   */
  async getUrlStats(): Promise<{ total: number, active: number, expired: number }> {
    try {
      const [total, expired] = await Promise.all([
        this.urlRepository.count(),
        this.urlRepository.count({
          where: {
            expiresAt: Not(IsNull()) && Not(undefined),
          },
        }),
      ]);

      return {
        total,
        active: total - expired,
        expired,
      };
    } catch (error) {
      this.logger.error('Failed to get URL stats', error.message, 'UrlService');
      throw error;
    }
  }
}