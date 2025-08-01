import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ConfigService } from "@nestjs/config";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { UrlService } from "./url.service";
import { UrlEntity } from "../entities/url.entity";
import { RedisService } from "./redis.service";
import { VirusTotalService } from "./virus-total.service";
import { LoggerService } from "./logger.service";
import { CreateUrlWithContextDto } from "../dto/create-url.dto";

describe("UrlService", () => {
  let service: UrlService;
  let repository: Repository<UrlEntity>;
  let redisService: RedisService;
  let virusTotalService: VirusTotalService;
  let loggerService: LoggerService;
  let configService: ConfigService;

  const mockRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    count: jest.fn(),
    delete: jest.fn(),
    increment: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const mockRedisService = {
    get: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
  };

  const mockVirusTotalService = {
    checkUrl: jest.fn(),
  };

  const mockLoggerService = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    logBusiness: jest.fn(),
    logSecurity: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UrlService,
        {
          provide: getRepositoryToken(UrlEntity),
          useValue: mockRepository,
        },
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
        {
          provide: VirusTotalService,
          useValue: mockVirusTotalService,
        },
        {
          provide: LoggerService,
          useValue: mockLoggerService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<UrlService>(UrlService);
    repository = module.get<Repository<UrlEntity>>(
      getRepositoryToken(UrlEntity)
    );
    redisService = module.get<RedisService>(RedisService);
    virusTotalService = module.get<VirusTotalService>(VirusTotalService);
    loggerService = module.get<LoggerService>(LoggerService);
    configService = module.get<ConfigService>(ConfigService);

    // Default config values
    mockConfigService.get.mockImplementation(
      (key: string, defaultValue?: any) => {
        const config = {
          BASE_URL: "http://localhost:3000",
          DEFAULT_CODE_LENGTH: 7,
          MAX_URL_LENGTH: 2048,
          CUSTOM_ALIAS_MIN_LENGTH: 3,
          CUSTOM_ALIAS_MAX_LENGTH: 50,
          ENABLE_URL_SCANNING: false,
          REDIS_TTL: 3600,
        };
        return config[key] || defaultValue;
      }
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("createShortUrl", () => {
    const createUrlDto: CreateUrlWithContextDto = {
      url: "https://example.com/test",
      clientIp: "192.168.1.1",
      userAgent: "Mozilla/5.0...",
    };

    it("should create a new short URL", async () => {
      const mockUrl = {
        id: "123",
        code: "abc123",
        original: "https://example.com/test",
        normalized: "https://example.com/test",
        createdAt: new Date(),
        getShortUrl: jest.fn().mockReturnValue("http://localhost:3000/abc123"),
      };

      mockRepository.findOne.mockResolvedValue(null); // No existing URL
      mockRepository.create.mockReturnValue(mockUrl);
      mockRepository.save.mockResolvedValue(mockUrl);
      mockRedisService.setex.mockResolvedValue(undefined);

      const result = await service.createShortUrl(createUrlDto);

      expect(result).toEqual({
        code: "abc123",
        shortUrl: "http://localhost:3000/abc123",
        original: "https://example.com/test",
        createdAt: mockUrl.createdAt,
        expiresAt: undefined,
        isNew: true,
      });

      expect(mockRepository.create).toHaveBeenCalled();
      expect(mockRepository.save).toHaveBeenCalled();
      expect(mockRedisService.setex).toHaveBeenCalled();
    });

    it("should return existing URL if already shortened", async () => {
      const existingUrl = {
        id: "123",
        code: "existing",
        original: "https://example.com/test",
        normalized: "https://example.com/test",
        createdAt: new Date(),
        isExpired: jest.fn().mockReturnValue(false),
        getShortUrl: jest
          .fn()
          .mockReturnValue("http://localhost:3000/existing"),
      };

      mockRepository.findOne.mockResolvedValue(existingUrl);

      const result = await service.createShortUrl(createUrlDto);

      expect(result).toEqual({
        code: "existing",
        shortUrl: "http://localhost:3000/existing",
        original: "https://example.com/test",
        createdAt: existingUrl.createdAt,
        expiresAt: undefined,
        isNew: false,
      });

      expect(mockRepository.create).not.toHaveBeenCalled();
      expect(mockRepository.save).not.toHaveBeenCalled();
    });

    it("should validate custom alias", async () => {
      const customAliasDto = {
        ...createUrlDto,
        customAlias: "my-link",
      };

      mockRepository.findOne
        .mockResolvedValueOnce(null) // No existing URL by normalized URL
        .mockResolvedValueOnce(null); // No existing URL by custom alias

      const mockUrl = {
        id: "123",
        code: "my-link",
        original: "https://example.com/test",
        normalized: "https://example.com/test",
        createdAt: new Date(),
        getShortUrl: jest.fn().mockReturnValue("http://localhost:3000/my-link"),
      };

      mockRepository.create.mockReturnValue(mockUrl);
      mockRepository.save.mockResolvedValue(mockUrl);
      mockRedisService.setex.mockResolvedValue(undefined);

      const result = await service.createShortUrl(customAliasDto);

      expect(result.code).toBe("my-link");
      expect(result.isNew).toBe(true);
    });

    it("should throw error for existing custom alias", async () => {
      const customAliasDto = {
        ...createUrlDto,
        customAlias: "existing-alias",
      };

      mockRepository.findOne
        .mockResolvedValueOnce(null) // No existing URL by normalized URL
        .mockResolvedValueOnce({ code: "existing-alias" }); // Existing custom alias

      await expect(service.createShortUrl(customAliasDto)).rejects.toThrow(
        BadRequestException
      );
    });

    it("should check URL safety when scanning is enabled", async () => {
      mockConfigService.get.mockImplementation(
        (key: string, defaultValue?: any) => {
          if (key === "ENABLE_URL_SCANNING") return true;
          const config = {
            BASE_URL: "http://localhost:3000",
            DEFAULT_CODE_LENGTH: 7,
            MAX_URL_LENGTH: 2048,
            CUSTOM_ALIAS_MIN_LENGTH: 3,
            CUSTOM_ALIAS_MAX_LENGTH: 50,
            REDIS_TTL: 3600,
          };
          return config[key] || defaultValue;
        }
      );

      mockVirusTotalService.checkUrl.mockResolvedValue(false); // Malicious URL
      mockRepository.findOne.mockResolvedValue(null);

      await expect(service.createShortUrl(createUrlDto)).rejects.toThrow(
        BadRequestException
      );
      expect(mockVirusTotalService.checkUrl).toHaveBeenCalledWith(
        "https://example.com/test"
      );
    });
  });

  describe("findByCode", () => {
    it("should return URL from cache", async () => {
      const cachedData = JSON.stringify({
        original: "https://example.com/test",
        expiresAt: null,
        hitCount: 5,
      });

      mockRedisService.get.mockResolvedValue(cachedData);

      const result = await service.findByCode("abc123");

      expect(result).toBeDefined();
      expect(result.code).toBe("abc123");
      expect(result.original).toBe("https://example.com/test");
      expect(mockRedisService.get).toHaveBeenCalledWith("url:abc123");
      expect(mockRepository.findOne).not.toHaveBeenCalled();
    });

    it("should return URL from database when not in cache", async () => {
      const dbUrl = {
        id: "123",
        code: "abc123",
        original: "https://example.com/test",
        hitCount: 10,
        createdAt: new Date(),
      };

      mockRedisService.get.mockResolvedValue(null);
      mockRepository.findOne.mockResolvedValue(dbUrl);
      mockRedisService.setex.mockResolvedValue(undefined);

      const result = await service.findByCode("abc123");

      expect(result).toEqual(dbUrl);
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { code: "abc123" },
      });
      expect(mockRedisService.setex).toHaveBeenCalled(); // Should cache the result
    });

    it("should return null for non-existent code", async () => {
      mockRedisService.get.mockResolvedValue(null);
      mockRepository.findOne.mockResolvedValue(null);

      const result = await service.findByCode("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("deleteUrl", () => {
    it("should delete URL and remove from cache", async () => {
      mockRepository.delete.mockResolvedValue({ affected: 1 });
      mockRedisService.del.mockResolvedValue(1);

      const result = await service.deleteUrl("abc123");

      expect(result).toBe(true);
      expect(mockRepository.delete).toHaveBeenCalledWith({ code: "abc123" });
      expect(mockRedisService.del).toHaveBeenCalledWith("url:abc123");
    });

    it("should return false for non-existent URL", async () => {
      mockRepository.delete.mockResolvedValue({ affected: 0 });

      const result = await service.deleteUrl("nonexistent");

      expect(result).toBe(false);
    });
  });

  describe("incrementHitCount", () => {
    it("should increment hit count and update cache", async () => {
      const mockUrl = {
        id: "123",
        code: "abc123",
        original: "https://example.com/test",
        hitCount: 11,
      };

      mockRepository.increment.mockResolvedValue(undefined);
      mockRepository.findOne.mockResolvedValue(mockUrl);
      mockRedisService.setex.mockResolvedValue(undefined);

      await service.incrementHitCount("abc123");

      expect(mockRepository.increment).toHaveBeenCalledWith(
        { code: "abc123" },
        "hitCount",
        1
      );
      expect(mockRedisService.setex).toHaveBeenCalled();
    });

    it("should not throw on database error", async () => {
      mockRepository.increment.mockRejectedValue(new Error("Database error"));

      // Should not throw
      await expect(
        service.incrementHitCount("abc123")
      ).resolves.toBeUndefined();

      expect(mockLoggerService.error).toHaveBeenCalled();
    });
  });

  describe("getUrls", () => {
    it("should return paginated URL list", async () => {
      const mockUrls = [
        {
          id: "1",
          code: "abc123",
          original: "https://example1.com",
          hitCount: 5,
          createdAt: new Date(),
          isExpired: jest.fn().mockReturnValue(false),
          getShortUrl: jest
            .fn()
            .mockReturnValue("http://localhost:3000/abc123"),
        },
        {
          id: "2",
          code: "def456",
          original: "https://example2.com",
          hitCount: 10,
          createdAt: new Date(),
          isExpired: jest.fn().mockReturnValue(false),
          getShortUrl: jest
            .fn()
            .mockReturnValue("http://localhost:3000/def456"),
        },
      ];

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([mockUrls, 2]),
      };

      mockRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const queryParams = {
        page: 1,
        limit: 20,
        sort: "createdAt",
        order: "DESC" as const,
        status: "all" as const,
        normalize: jest.fn().mockReturnThis(),
        offset: 0,
        getSortConfig: jest.fn().mockReturnValue({ createdAt: "DESC" }),
      };

      const result = await service.getUrls(queryParams);

      expect(result).toEqual({
        urls: expect.arrayContaining([
          expect.objectContaining({
            code: "abc123",
            original: "https://example1.com",
          }),
          expect.objectContaining({
            code: "def456",
            original: "https://example2.com",
          }),
        ]),
        total: 2,
        page: 1,
        limit: 20,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      });
    });
  });

  describe("URL normalization", () => {
    it("should normalize URL by removing tracking parameters", async () => {
      const urlWithTracking =
        "https://example.com/page?utm_source=test&utm_medium=email&param=keep";
      const createUrlDto: CreateUrlWithContextDto = {
        url: urlWithTracking,
        clientIp: "192.168.1.1",
        userAgent: "Mozilla/5.0...",
      };

      mockRepository.findOne.mockResolvedValue(null);

      const mockUrl = {
        id: "123",
        code: "abc123",
        original: urlWithTracking,
        normalized: "https://example.com/page?param=keep", // Tracking params removed
        createdAt: new Date(),
        getShortUrl: jest.fn().mockReturnValue("http://localhost:3000/abc123"),
      };

      mockRepository.create.mockImplementation((data) => ({
        ...mockUrl,
        normalized: data.normalized,
      }));
      mockRepository.save.mockResolvedValue(mockUrl);
      mockRedisService.setex.mockResolvedValue(undefined);

      await service.createShortUrl(createUrlDto);

      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          normalized: expect.not.stringContaining("utm_"),
        })
      );
    });
  });
});
