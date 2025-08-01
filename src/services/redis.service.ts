import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';
import { LoggerService } from './logger.service';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: RedisClientType;
  private readonly ttl: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.ttl = this.configService.get<number>('REDIS_TTL', 3600);
    
    this.client = createClient({
      socket: {
        host: this.configService.get<string>('REDIS_HOST', 'localhost'),
        port: this.configService.get<number>('REDIS_PORT', 6379),
        connectTimeout: 10000,
        commandTimeout: 5000,
      },
      password: this.configService.get<string>('REDIS_PASSWORD') || undefined,
      database: this.configService.get<number>('REDIS_DB', 0),
      retry: {
        retries: 3,
        delay: (attempt) => Math.min(attempt * 50, 500),
      },
    });

    // Error handling
    this.client.on('error', (error) => {
      this.logger.error('Redis client error', error.message, 'RedisService', { error: error.stack });
    });

    this.client.on('connect', () => {
      this.logger.log('✅ Redis client connected', 'RedisService');
    });

    this.client.on('disconnect', () => {
      this.logger.warn('❌ Redis client disconnected', 'RedisService');
    });

    this.client.on('reconnecting', () => {
      this.logger.log('🔄 Redis client reconnecting', 'RedisService');
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
      this.logger.log('✅ Redis service initialized', 'RedisService');
    } catch (error) {
      this.logger.error('❌ Failed to initialize Redis service', error.message, 'RedisService', { error: error.stack });
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.disconnect();
      this.logger.log('✅ Redis service disconnected', 'RedisService');
    } catch (error) {
      this.logger.error('❌ Error disconnecting Redis service', error.message, 'RedisService');
    }
  }

  /**
   * Set a key-value pair with TTL
   */
  async setex(key: string, ttl: number, value: string): Promise<void> {
    try {
      await this.client.setEx(key, ttl, value);
      this.logger.logCache('SET', key, false, 0);
    } catch (error) {
      this.logger.error('Redis SETEX failed', error.message, 'RedisService', { key, ttl });
      throw error;
    }
  }

  /**
   * Set a key-value pair with default TTL
   */
  async set(key: string, value: string, ttl?: number): Promise<void> {
    try {
      const expiration = ttl || this.ttl;
      await this.client.setEx(key, expiration, value);
      this.logger.logCache('SET', key, false, 0);
    } catch (error) {
      this.logger.error('Redis SET failed', error.message, 'RedisService', { key });
      throw error;
    }
  }

  /**
   * Get a value by key
   */
  async get(key: string): Promise<string | null> {
    try {
      const startTime = Date.now();
      const value = await this.client.get(key);
      const duration = Date.now() - startTime;
      
      this.logger.logCache('GET', key, value !== null, duration);
      return value;
    } catch (error) {
      this.logger.error('Redis GET failed', error.message, 'RedisService', { key });
      return null;
    }
  }

  /**
   * Delete a key
   */
  async del(key: string): Promise<number> {
    try {
      const result = await this.client.del(key);
      this.logger.logCache('DEL', key, false, 0);
      return result;
    } catch (error) {
      this.logger.error('Redis DEL failed', error.message, 'RedisService', { key });
      throw error;
    }
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      this.logger.error('Redis EXISTS failed', error.message, 'RedisService', { key });
      return false;
    }
  }

  /**
   * Set expiration for a key
   */
  async expire(key: string, seconds: number): Promise<boolean> {
    try {
      const result = await this.client.expire(key, seconds);
      return result;
    } catch (error) {
      this.logger.error('Redis EXPIRE failed', error.message, 'RedisService', { key, seconds });
      return false;
    }
  }

  /**
   * Get time to live for a key
   */
  async ttl(key: string): Promise<number> {
    try {
      return await this.client.ttl(key);
    } catch (error) {
      this.logger.error('Redis TTL failed', error.message, 'RedisService', { key });
      return -1;
    }
  }

  /**
   * Increment a numeric value
   */
  async incr(key: string): Promise<number> {
    try {
      return await this.client.incr(key);
    } catch (error) {
      this.logger.error('Redis INCR failed', error.message, 'RedisService', { key });
      throw error;
    }
  }

  /**
   * Increment by a specific amount
   */
  async incrBy(key: string, increment: number): Promise<number> {
    try {
      return await this.client.incrBy(key, increment);
    } catch (error) {
      this.logger.error('Redis INCRBY failed', error.message, 'RedisService', { key, increment });
      throw error;
    }
  }

  /**
   * Decrement a numeric value
   */
  async decr(key: string): Promise<number> {
    try {
      return await this.client.decr(key);
    } catch (error) {
      this.logger.error('Redis DECR failed', error.message, 'RedisService', { key });
      throw error;
    }
  }

  /**
   * Set multiple key-value pairs
   */
  async mset(keyValues: Record<string, string>): Promise<void> {
    try {
      await this.client.mSet(keyValues);
      this.logger.logCache('MSET', Object.keys(keyValues).join(','), false, 0);
    } catch (error) {
      this.logger.error('Redis MSET failed', error.message, 'RedisService', { keys: Object.keys(keyValues) });
      throw error;
    }
  }

  /**
   * Get multiple values by keys
   */
  async mget(keys: string[]): Promise<(string | null)[]> {
    try {
      const startTime = Date.now();
      const values = await this.client.mGet(keys);
      const duration = Date.now() - startTime;
      
      this.logger.logCache('MGET', keys.join(','), true, duration);
      return values;
    } catch (error) {
      this.logger.error('Redis MGET failed', error.message, 'RedisService', { keys });
      throw error;
    }
  }

  /**
   * Add to set
   */
  async sadd(key: string, ...members: string[]): Promise<number> {
    try {
      return await this.client.sAdd(key, members);
    } catch (error) {
      this.logger.error('Redis SADD failed', error.message, 'RedisService', { key, members });
      throw error;
    }
  }

  /**
   * Get all members of set
   */
  async smembers(key: string): Promise<string[]> {
    try {
      return await this.client.sMembers(key);
    } catch (error) {
      this.logger.error('Redis SMEMBERS failed', error.message, 'RedisService', { key });
      throw error;
    }
  }

  /**
   * Check if member exists in set
   */
  async sismember(key: string, member: string): Promise<boolean> {
    try {
      return await this.client.sIsMember(key, member);
    } catch (error) {
      this.logger.error('Redis SISMEMBER failed', error.message, 'RedisService', { key, member });
      return false;
    }
  }

  /**
   * Hash set
   */
  async hset(key: string, field: string, value: string): Promise<number> {
    try {
      return await this.client.hSet(key, field, value);
    } catch (error) {
      this.logger.error('Redis HSET failed', error.message, 'RedisService', { key, field });
      throw error;
    }
  }

  /**
   * Hash get
   */
  async hget(key: string, field: string): Promise<string | undefined> {
    try {
      return await this.client.hGet(key, field);
    } catch (error) {
      this.logger.error('Redis HGET failed', error.message, 'RedisService', { key, field });
      return undefined;
    }
  }

  /**
   * Hash get all
   */
  async hgetall(key: string): Promise<Record<string, string>> {
    try {
      return await this.client.hGetAll(key);
    } catch (error) {
      this.logger.error('Redis HGETALL failed', error.message, 'RedisService', { key });
      throw error;
    }
  }

  /**
   * List push (left)
   */
  async lpush(key: string, ...elements: string[]): Promise<number> {
    try {
      return await this.client.lPush(key, elements);
    } catch (error) {
      this.logger.error('Redis LPUSH failed', error.message, 'RedisService', { key });
      throw error;
    }
  }

  /**
   * List pop (right)
   */
  async rpop(key: string): Promise<string | null> {
    try {
      return await this.client.rPop(key);
    } catch (error) {
      this.logger.error('Redis RPOP failed', error.message, 'RedisService', { key });
      return null;
    }
  }

  /**
   * List length
   */
  async llen(key: string): Promise<number> {
    try {
      return await this.client.lLen(key);
    } catch (error) {
      this.logger.error('Redis LLEN failed', error.message, 'RedisService', { key });
      return 0;
    }
  }

  /**
   * Get keys matching pattern
   */
  async keys(pattern: string): Promise<string[]> {
    try {
      return await this.client.keys(pattern);
    } catch (error) {
      this.logger.error('Redis KEYS failed', error.message, 'RedisService', { pattern });
      return [];
    }
  }

  /**
   * Flush all data
   */
  async flushall(): Promise<void> {
    try {
      await this.client.flushAll();
      this.logger.log('Redis FLUSHALL executed', 'RedisService');
    } catch (error) {
      this.logger.error('Redis FLUSHALL failed', error.message, 'RedisService');
      throw error;
    }
  }

  /**
   * Health check
   */
  async ping(): Promise<string> {
    try {
      return await this.client.ping();
    } catch (error) {
      this.logger.error('Redis PING failed', error.message, 'RedisService');
      throw error;
    }
  }

  /**
   * Get Redis info
   */
  async info(): Promise<string> {
    try {
      return await this.client.info();
    } catch (error) {
      this.logger.error('Redis INFO failed', error.message, 'RedisService');
      throw error;
    }
  }

  /**
   * Execute Redis pipeline
   */
  async pipeline(commands: Array<{ command: string; args: any[] }>): Promise<any[]> {
    try {
      const pipeline = this.client.multi();
      
      commands.forEach(({ command, args }) => {
        (pipeline as any)[command](...args);
      });
      
      return await pipeline.exec();
    } catch (error) {
      this.logger.error('Redis pipeline failed', error.message, 'RedisService', { commandCount: commands.length });
      throw error;
    }
  }

  /**
   * Rate limiting using sliding window
   */
  async checkRateLimit(key: string, limit: number, windowMs: number): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    try {
      const now = Date.now();
      const window = Math.floor(now / windowMs);
      const rateKey = `rate:${key}:${window}`;
      
      const count = await this.incr(rateKey);
      await this.expire(rateKey, Math.ceil(windowMs / 1000));
      
      const allowed = count <= limit;
      const remaining = Math.max(0, limit - count);
      const resetTime = (window + 1) * windowMs;
      
      return { allowed, remaining, resetTime };
    } catch (error) {
      this.logger.error('Rate limit check failed', error.message, 'RedisService', { key, limit, windowMs });
      // Allow request on error to avoid blocking legitimate traffic
      return { allowed: true, remaining: limit, resetTime: Date.now() + windowMs };
    }
  }
}