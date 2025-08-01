import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { UrlService } from '../src/services/url.service';
import { RedisService } from '../src/services/redis.service';
import { VirusTotalService } from '../src/services/virus-total.service';
import { LoggerService } from '../src/services/logger.service';
import { UrlEntity } from '../src/entities/url.entity';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createTestingModule } from './setup-integration';

describe('URL Service Integration', () => {
  let module: TestingModule;
  let urlService: UrlService;
  let redisService: RedisService;
  let urlRepository: Repository<UrlEntity>;

  beforeAll(async () => {
    module = await createTestingModule([
      TypeOrmModule.forFeature([UrlEntity]),
    ], [
      UrlService,
      RedisService,
      VirusTotalService,
      LoggerService,
    ]);

    urlService = module.get<UrlService>(UrlService);
    redisService = module.get<RedisService>(RedisService);
    urlRepository = module.get<Repository<UrlEntity>>(getRepositoryToken(UrlEntity));
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    // Clean up database and cache before each test
    await urlRepository.clear();
    await redisService.flushall();
  });

  describe('URL Creation and Retrieval', () => {
    it('should create and retrieve a short URL', async () => {
      const createUrlDto = {
        url: 'https://example.com/test-integration',
        clientIp: '192.168.1.1',
        userAgent: 'Mozilla/5.0 (Test)',
      };

      // Create URL
      const created = await urlService.createShortUrl(createUrlDto);

      expect(created).toMatchObject({
        original: 'https://example.com/test-integration',
        isNew: true,
      });
      expect(created.code).toBeDefined();
      expect(created.shortUrl).toContain(created.code);

      // Retrieve URL
      const retrieved = await urlService.findByCode(created.code);

      expect(retrieved).toBeDefined();
      expect(retrieved.original).toBe('https://example.com/test-integration');
      expect(retrieved.code).toBe(created.code);
    });

    it('should return existing URL for duplicate requests', async () => {
      const createUrlDto = {
        url: 'https://example.com/duplicate-test',
        clientIp: '192.168.1.1',
        userAgent: 'Mozilla/5.0 (Test)',
      };

      // Create URL first time
      const first = await urlService.createShortUrl(createUrlDto);
      expect(first.isNew).toBe(true);

      // Create same URL second time
      const second = await urlService.createShortUrl(createUrlDto);
      expect(second.isNew).toBe(false);
      expect(second.code).toBe(first.code);
    });

    it('should handle custom aliases', async () => {
      const createUrlDto = {
        url: 'https://example.com/custom-alias-test',
        customAlias: 'my-custom-link',
        clientIp: '192.168.1.1',
        userAgent: 'Mozilla/5.0 (Test)',
      };

      const created = await urlService.createShortUrl(createUrlDto);

      expect(created.code).toBe('my-custom-link');
      expect(created.isNew).toBe(true);

      // Verify retrieval works
      const retrieved = await urlService.findByCode('my-custom-link');
      expect(retrieved).toBeDefined();
      expect(retrieved.original).toBe('https://example.com/custom-alias-test');
    });

    it('should reject duplicate custom aliases', async () => {
      const firstDto = {
        url: 'https://example.com/first',
        customAlias: 'duplicate-alias',
        clientIp: '192.168.1.1',
        userAgent: 'Mozilla/5.0 (Test)',
      };

      const secondDto = {
        url: 'https://example.com/second',
        customAlias: 'duplicate-alias',
        clientIp: '192.168.1.1',
        userAgent: 'Mozilla/5.0 (Test)',
      };

      // First creation should succeed
      await urlService.createShortUrl(firstDto);

      // Second creation should fail
      await expect(urlService.createShortUrl(secondDto)).rejects.toThrow('Custom alias already exists');
    });
  });

  describe('URL Caching', () => {
    it('should cache URLs in Redis', async () => {
      const createUrlDto = {
        url: 'https://example.com/cache-test',
        clientIp: '192.168.1.1',
        userAgent: 'Mozilla/5.0 (Test)',
      };

      const created = await urlService.createShortUrl(createUrlDto);

      // Check if URL is cached
      const cached = await redisService.get(`url:${created.code}`);
      expect(cached).toBeDefined();

      const cachedData = JSON.parse(cached);
      expect(cachedData.original).toBe('https://example.com/cache-test');
    });

    it('should retrieve from cache when available', async () => {
      const createUrlDto = {
        url: 'https://example.com/cache-retrieval-test',
        clientIp: '192.168.1.1',
        userAgent: 'Mozilla/5.0 (Test)',
      };

      const created = await urlService.createShortUrl(createUrlDto);

      // First retrieval (should hit database and cache)
      const first = await urlService.findByCode(created.code);
      expect(first).toBeDefined();

      // Clear database but keep cache
      await urlRepository.delete({ code: created.code });

      // Second retrieval (should hit cache, not database)
      const second = await urlService.findByCode(created.code);
      expect(second).toBeDefined();
      expect(second.original).toBe('https://example.com/cache-retrieval-test');
    });
  });

  describe('URL Hit Tracking', () => {
    it('should increment hit count', async () => {
      const createUrlDto = {
        url: 'https://example.com/hit-tracking-test',
        clientIp: '192.168.1.1',
        userAgent: 'Mozilla/5.0 (Test)',
      };

      const created = await urlService.createShortUrl(createUrlDto);

      // Initial hit count should be 0
      let url = await urlRepository.findOne({ where: { code: created.code } });
      expect(Number(url.hitCount)).toBe(0);

      // Increment hit count
      await urlService.incrementHitCount(created.code);

      // Hit count should be 1
      url = await urlRepository.findOne({ where: { code: created.code } });
      expect(Number(url.hitCount)).toBe(1);

      // Increment again
      await urlService.incrementHitCount(created.code);

      // Hit count should be 2
      url = await urlRepository.findOne({ where: { code: created.code } });
      expect(Number(url.hitCount)).toBe(2);
    });
  });

  describe('URL Expiration', () => {
    it('should handle URL expiration', async () => {
      const futureDate = new Date(Date.now() + 60000); // 1 minute from now
      const pastDate = new Date(Date.now() - 60000); // 1 minute ago

      // Create URL with future expiration
      const createUrlDto = {
        url: 'https://example.com/expiration-test',
        expiresAt: futureDate.toISOString(),
        clientIp: '192.168.1.1',
        userAgent: 'Mozilla/5.0 (Test)',
      };

      const created = await urlService.createShortUrl(createUrlDto);
      
      let url = await urlRepository.findOne({ where: { code: created.code } });
      expect(url.isExpired()).toBe(false);

      // Manually set expiration to past
      await urlRepository.update({ code: created.code }, { expiresAt: pastDate });

      url = await urlRepository.findOne({ where: { code: created.code } });
      expect(url.isExpired()).toBe(true);
    });
  });

  describe('URL Deletion', () => {
    it('should delete URL and remove from cache', async () => {
      const createUrlDto = {
        url: 'https://example.com/deletion-test',
        clientIp: '192.168.1.1',
        userAgent: 'Mozilla/5.0 (Test)',
      };

      const created = await urlService.createShortUrl(createUrlDto);

      // Verify URL exists
      let url = await urlRepository.findOne({ where: { code: created.code } });
      expect(url).toBeDefined();

      // Verify cache exists
      let cached = await redisService.get(`url:${created.code}`);
      expect(cached).toBeDefined();

      // Delete URL
      const deleted = await urlService.deleteUrl(created.code);
      expect(deleted).toBe(true);

      // Verify URL is deleted from database
      url = await urlRepository.findOne({ where: { code: created.code } });
      expect(url).toBeNull();

      // Verify cache is cleared
      cached = await redisService.get(`url:${created.code}`);
      expect(cached).toBeNull();
    });

    it('should return false for non-existent URL deletion', async () => {
      const deleted = await urlService.deleteUrl('non-existent-code');
      expect(deleted).toBe(false);
    });
  });

  describe('URL Statistics', () => {
    it('should return correct URL statistics', async () => {
      // Create some URLs
      const createRequests = [
        {
          url: 'https://example1.com',
          clientIp: '192.168.1.1',
          userAgent: 'Mozilla/5.0 (Test)',
        },
        {
          url: 'https://example2.com',
          expiresAt: new Date(Date.now() + 60000).toISOString(), // Future expiration
          clientIp: '192.168.1.1',
          userAgent: 'Mozilla/5.0 (Test)',
        },
        {
          url: 'https://example3.com',
          expiresAt: new Date(Date.now() - 60000).toISOString(), // Past expiration
          clientIp: '192.168.1.1',
          userAgent: 'Mozilla/5.0 (Test)',
        },
      ];

      for (const dto of createRequests) {
        await urlService.createShortUrl(dto);
      }

      const stats = await urlService.getUrlStats();

      expect(stats.total).toBe(3);
      expect(stats.active).toBeGreaterThan(0);
      expect(stats.expired).toBeGreaterThan(0);
    });
  });

  describe('URL Normalization', () => {
    it('should normalize URLs correctly', async () => {
      const urlsToTest = [
        {
          input: 'https://example.com/path?utm_source=test&param=keep',
          expected: 'https://example.com/path?param=keep',
        },
        {
          input: 'http://example.com:80/path',
          expected: 'http://example.com/path',
        },
        {
          input: 'https://example.com:443/path/',
          expected: 'https://example.com/path',
        },
      ];

      for (const testCase of urlsToTest) {
        const createUrlDto = {
          url: testCase.input,
          clientIp: '192.168.1.1',
          userAgent: 'Mozilla/5.0 (Test)',
        };

        const created = await urlService.createShortUrl(createUrlDto);
        const url = await urlRepository.findOne({ where: { code: created.code } });

        expect(url.normalized).toBe(testCase.expected);
      }
    });

    it('should handle URL normalization edge cases', async () => {
      const edgeCases = [
        'https://example.com/path?',
        'https://example.com/path#fragment',
        'https://EXAMPLE.COM/Path', // Case sensitivity
      ];

      for (const testUrl of edgeCases) {
        const createUrlDto = {
          url: testUrl,
          clientIp: '192.168.1.1',
          userAgent: 'Mozilla/5.0 (Test)',
        };

        // Should not throw error
        const created = await urlService.createShortUrl(createUrlDto);
        expect(created).toBeDefined();
      }
    });
  });
});