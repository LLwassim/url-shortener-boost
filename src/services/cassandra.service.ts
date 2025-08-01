import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, auth, mapping } from 'cassandra-driver';
import { LoggerService } from './logger.service';
import { HitEventDto, AnalyticsResponseDto, TimeSeriesDataPoint } from '../dto/analytics.dto';

interface HitRecord {
  code: string;
  date: Date;
  hour: number;
  minute: number;
  count: bigint;
  unique_visitors: bigint;
}

interface ReferrerRecord {
  code: string;
  referrer: string;
  count: bigint;
}

interface GeographicRecord {
  code: string;
  country: string;
  count: bigint;
}

interface DeviceRecord {
  code: string;
  device_type: string;
  browser: string;
  os: string;
  count: bigint;
}

@Injectable()
export class CassandraService implements OnModuleInit, OnModuleDestroy {
  private client: Client;
  private readonly keyspace: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.keyspace = this.configService.get<string>('CASSANDRA_KEYSPACE', 'url_analytics');
    
    const hosts = this.configService.get<string>('CASSANDRA_HOSTS', 'localhost:9042').split(',');
    
    this.client = new Client({
      contactPoints: hosts,
      localDataCenter: 'datacenter1',
      keyspace: this.keyspace,
      credentials: {
        username: this.configService.get<string>('CASSANDRA_USERNAME', 'cassandra'),
        password: this.configService.get<string>('CASSANDRA_PASSWORD', 'cassandra'),
      },
      pooling: {
        coreConnectionsPerHost: {
          '0': 2,
          '1': 1,
          '2': 0,
        },
        maxConnectionsPerHost: {
          '0': 8,
          '1': 2,
          '2': 0,
        },
      },
      socketOptions: {
        connectTimeout: 10000,
        readTimeout: 30000,
      },
      requestTimeout: 30000,
      protocolOptions: {
        port: 9042,
      },
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
      await this.createKeyspaceAndTables();
      this.logger.log('✅ Cassandra service initialized', 'CassandraService');
    } catch (error) {
      this.logger.error('❌ Failed to initialize Cassandra service', error.message, 'CassandraService', { error: error.stack });
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.shutdown();
      this.logger.log('✅ Cassandra service disconnected', 'CassandraService');
    } catch (error) {
      this.logger.error('❌ Error disconnecting Cassandra service', error.message, 'CassandraService');
    }
  }

  /**
   * Create keyspace and tables
   */
  private async createKeyspaceAndTables(): Promise<void> {
    try {
      // Create keyspace if it doesn't exist
      const createKeyspaceQuery = `
        CREATE KEYSPACE IF NOT EXISTS ${this.keyspace}
        WITH replication = {
          'class': 'SimpleStrategy',
          'replication_factor': 1
        }
      `;
      await this.client.execute(createKeyspaceQuery);

      // Use the keyspace
      await this.client.execute(`USE ${this.keyspace}`);

      // Create tables
      await this.createTables();

      this.logger.log('✅ Cassandra keyspace and tables created', 'CassandraService');
    } catch (error) {
      this.logger.error('❌ Failed to create Cassandra keyspace and tables', error.message, 'CassandraService');
      throw error;
    }
  }

  /**
   * Create all necessary tables
   */
  private async createTables(): Promise<void> {
    const tables = [
      // Hits by hour for time series analytics
      `
        CREATE TABLE IF NOT EXISTS hits_by_hour (
          code text,
          date date,
          hour int,
          count counter,
          unique_visitors counter,
          PRIMARY KEY ((code), date, hour)
        ) WITH CLUSTERING ORDER BY (date DESC, hour DESC)
      `,
      
      // Hits by minute for detailed analytics
      `
        CREATE TABLE IF NOT EXISTS hits_by_minute (
          code text,
          date date,
          hour int,
          minute int,
          count counter,
          unique_visitors counter,
          PRIMARY KEY ((code), date, hour, minute)
        ) WITH CLUSTERING ORDER BY (date DESC, hour DESC, minute DESC)
      `,

      // Top referrers
      `
        CREATE TABLE IF NOT EXISTS referrers (
          code text,
          referrer text,
          count counter,
          PRIMARY KEY (code, referrer)
        )
      `,

      // Geographic distribution
      `
        CREATE TABLE IF NOT EXISTS geographic (
          code text,
          country text,
          count counter,
          PRIMARY KEY (code, country)
        )
      `,

      // Device and browser analytics
      `
        CREATE TABLE IF NOT EXISTS devices (
          code text,
          device_type text,
          browser text,
          os text,
          count counter,
          PRIMARY KEY (code, device_type, browser, os)
        )
      `,

      // First and last access times
      `
        CREATE TABLE IF NOT EXISTS access_times (
          code text PRIMARY KEY,
          first_accessed timestamp,
          last_accessed timestamp
        )
      `,

      // Unique visitors tracking (using HyperLogLog approximation)
      `
        CREATE TABLE IF NOT EXISTS unique_visitors (
          code text,
          date date,
          visitor_hash text,
          PRIMARY KEY ((code, date), visitor_hash)
        )
      `,
    ];

    for (const table of tables) {
      await this.client.execute(table);
    }

    this.logger.log('✅ All Cassandra tables created', 'CassandraService');
  }

  /**
   * Record a hit event
   */
  async recordHitEvent(hitEvent: HitEventDto): Promise<void> {
    try {
      const date = new Date(hitEvent.timestamp.getFullYear(), hitEvent.timestamp.getMonth(), hitEvent.timestamp.getDate());
      const hour = hitEvent.timestamp.getHours();
      const minute = hitEvent.timestamp.getMinutes();
      
      // Create a hash for unique visitor tracking
      const visitorHash = this.createVisitorHash(hitEvent.ip, hitEvent.userAgent);

      const queries = [
        // Update hourly stats
        {
          query: `
            UPDATE hits_by_hour 
            SET count = count + 1, unique_visitors = unique_visitors + 1 
            WHERE code = ? AND date = ? AND hour = ?
          `,
          params: [hitEvent.code, date, hour],
        },
        
        // Update minute stats
        {
          query: `
            UPDATE hits_by_minute 
            SET count = count + 1, unique_visitors = unique_visitors + 1 
            WHERE code = ? AND date = ? AND hour = ? AND minute = ?
          `,
          params: [hitEvent.code, date, hour, minute],
        },

        // Update access times
        {
          query: `
            UPDATE access_times 
            SET first_accessed = ?, last_accessed = ? 
            WHERE code = ?
          `,
          params: [hitEvent.timestamp, hitEvent.timestamp, hitEvent.code],
        },

        // Track unique visitor
        {
          query: `
            INSERT INTO unique_visitors (code, date, visitor_hash) 
            VALUES (?, ?, ?) IF NOT EXISTS
          `,
          params: [hitEvent.code, date, visitorHash],
        },
      ];

      // Add referrer tracking if available
      if (hitEvent.referrer && hitEvent.referrer !== 'direct') {
        queries.push({
          query: `
            UPDATE referrers 
            SET count = count + 1 
            WHERE code = ? AND referrer = ?
          `,
          params: [hitEvent.code, hitEvent.referrer],
        });
      }

      // Add geographic tracking if available
      if (hitEvent.country) {
        queries.push({
          query: `
            UPDATE geographic 
            SET count = count + 1 
            WHERE code = ? AND country = ?
          `,
          params: [hitEvent.code, hitEvent.country],
        });
      }

      // Add device tracking
      if (hitEvent.deviceType || hitEvent.browser || hitEvent.os) {
        queries.push({
          query: `
            UPDATE devices 
            SET count = count + 1 
            WHERE code = ? AND device_type = ? AND browser = ? AND os = ?
          `,
          params: [
            hitEvent.code,
            hitEvent.deviceType || 'unknown',
            hitEvent.browser || 'unknown',
            hitEvent.os || 'unknown',
          ],
        });
      }

      // Execute all queries in batch
      await this.client.batch(queries, { prepare: true });

      this.logger.debug('📊 Recorded hit event in Cassandra', 'CassandraService', {
        code: hitEvent.code,
        timestamp: hitEvent.timestamp,
      });
    } catch (error) {
      this.logger.error('❌ Failed to record hit event', error.message, 'CassandraService', {
        code: hitEvent.code,
        error: error.stack,
      });
      throw error;
    }
  }

  /**
   * Get analytics for a URL code
   */
  async getAnalytics(
    code: string,
    startDate?: Date,
    endDate?: Date,
    granularity: 'minute' | 'hour' | 'day' = 'hour'
  ): Promise<AnalyticsResponseDto> {
    try {
      const [
        timeSeries,
        referrers,
        geographic,
        devices,
        accessTimes,
        totalStats,
      ] = await Promise.all([
        this.getTimeSeries(code, startDate, endDate, granularity),
        this.getTopReferrers(code, 10),
        this.getGeographicDistribution(code),
        this.getDeviceDistribution(code),
        this.getAccessTimes(code),
        this.getTotalStats(code, startDate, endDate),
      ]);

      const analytics: AnalyticsResponseDto = {
        code,
        totalHits: totalStats.totalHits,
        uniqueVisitors: totalStats.uniqueVisitors,
        firstAccessed: accessTimes.firstAccessed,
        lastAccessed: accessTimes.lastAccessed,
        timeSeries,
        topReferrers: referrers,
        geographic,
        devices: devices.devices,
        browsers: devices.browsers,
      };

      this.logger.debug('📊 Retrieved analytics from Cassandra', 'CassandraService', {
        code,
        totalHits: analytics.totalHits,
      });

      return analytics;
    } catch (error) {
      this.logger.error('❌ Failed to get analytics', error.message, 'CassandraService', {
        code,
        error: error.stack,
      });
      throw error;
    }
  }

  /**
   * Get time series data
   */
  private async getTimeSeries(
    code: string,
    startDate?: Date,
    endDate?: Date,
    granularity: 'minute' | 'hour' | 'day' = 'hour'
  ): Promise<TimeSeriesDataPoint[]> {
    const table = granularity === 'minute' ? 'hits_by_minute' : 'hits_by_hour';
    let query = `SELECT date, hour, ${granularity === 'minute' ? 'minute,' : ''} count FROM ${table} WHERE code = ?`;
    const params = [code];

    if (startDate && endDate) {
      query += ' AND date >= ? AND date <= ?';
      params.push(startDate, endDate);
    }

    const result = await this.client.execute(query, params, { prepare: true });
    
    return result.rows.map(row => {
      let timestamp: Date;
      if (granularity === 'minute') {
        timestamp = new Date(row.date.getFullYear(), row.date.getMonth(), row.date.getDate(), row.hour, row.minute);
      } else {
        timestamp = new Date(row.date.getFullYear(), row.date.getMonth(), row.date.getDate(), row.hour);
      }

      return {
        timestamp: timestamp.toISOString(),
        hits: Number(row.count),
      };
    }).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  /**
   * Get top referrers
   */
  private async getTopReferrers(code: string, limit: number = 10): Promise<any[]> {
    const query = 'SELECT referrer, count FROM referrers WHERE code = ?';
    const result = await this.client.execute(query, [code], { prepare: true });
    
    const referrers = result.rows
      .map(row => ({
        referrer: row.referrer,
        hits: Number(row.count),
      }))
      .sort((a, b) => b.hits - a.hits)
      .slice(0, limit);

    const totalHits = referrers.reduce((sum, ref) => sum + ref.hits, 0);
    
    return referrers.map(ref => ({
      ...ref,
      percentage: totalHits > 0 ? (ref.hits / totalHits) * 100 : 0,
    }));
  }

  /**
   * Get geographic distribution
   */
  private async getGeographicDistribution(code: string): Promise<any[]> {
    const query = 'SELECT country, count FROM geographic WHERE code = ?';
    const result = await this.client.execute(query, [code], { prepare: true });
    
    const countries = result.rows.map(row => ({
      country: row.country,
      hits: Number(row.count),
    }));

    const totalHits = countries.reduce((sum, country) => sum + country.hits, 0);
    
    return countries.map(country => ({
      ...country,
      percentage: totalHits > 0 ? (country.hits / totalHits) * 100 : 0,
    }));
  }

  /**
   * Get device and browser distribution
   */
  private async getDeviceDistribution(code: string): Promise<{ devices: any[], browsers: any[] }> {
    const query = 'SELECT device_type, browser, os, count FROM devices WHERE code = ?';
    const result = await this.client.execute(query, [code], { prepare: true });
    
    const deviceMap = new Map<string, number>();
    const browserMap = new Map<string, number>();
    
    result.rows.forEach(row => {
      const deviceType = row.device_type;
      const browser = row.browser;
      const count = Number(row.count);
      
      deviceMap.set(deviceType, (deviceMap.get(deviceType) || 0) + count);
      browserMap.set(browser, (browserMap.get(browser) || 0) + count);
    });

    const totalDeviceHits = Array.from(deviceMap.values()).reduce((sum, count) => sum + count, 0);
    const totalBrowserHits = Array.from(browserMap.values()).reduce((sum, count) => sum + count, 0);

    const devices = Array.from(deviceMap.entries()).map(([deviceType, hits]) => ({
      deviceType,
      hits,
      percentage: totalDeviceHits > 0 ? (hits / totalDeviceHits) * 100 : 0,
    }));

    const browsers = Array.from(browserMap.entries()).map(([browser, hits]) => ({
      browser,
      hits,
      percentage: totalBrowserHits > 0 ? (hits / totalBrowserHits) * 100 : 0,
    }));

    return { devices, browsers };
  }

  /**
   * Get access times
   */
  private async getAccessTimes(code: string): Promise<{ firstAccessed?: Date, lastAccessed?: Date }> {
    const query = 'SELECT first_accessed, last_accessed FROM access_times WHERE code = ?';
    const result = await this.client.execute(query, [code], { prepare: true });
    
    if (result.rows.length === 0) {
      return {};
    }

    const row = result.rows[0];
    return {
      firstAccessed: row.first_accessed,
      lastAccessed: row.last_accessed,
    };
  }

  /**
   * Get total statistics
   */
  private async getTotalStats(code: string, startDate?: Date, endDate?: Date): Promise<{ totalHits: number, uniqueVisitors: number }> {
    let query = 'SELECT SUM(count) as total_hits, SUM(unique_visitors) as unique_visitors FROM hits_by_hour WHERE code = ?';
    const params = [code];

    if (startDate && endDate) {
      query += ' AND date >= ? AND date <= ?';
      params.push(startDate, endDate);
    }

    const result = await this.client.execute(query, params, { prepare: true });
    
    if (result.rows.length === 0) {
      return { totalHits: 0, uniqueVisitors: 0 };
    }

    const row = result.rows[0];
    return {
      totalHits: Number(row.total_hits) || 0,
      uniqueVisitors: Number(row.unique_visitors) || 0,
    };
  }

  /**
   * Create a hash for unique visitor tracking
   */
  private createVisitorHash(ip: string, userAgent: string): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(`${ip}:${userAgent}`).digest('hex').substring(0, 16);
  }

  /**
   * Health check
   */
  async getHealth(): Promise<boolean> {
    try {
      await this.client.execute('SELECT now() FROM system.local');
      return true;
    } catch (error) {
      this.logger.error('❌ Cassandra health check failed', error.message, 'CassandraService');
      return false;
    }
  }
}