import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from './logger.service';
import { RedisService } from './redis.service';

interface GeoLocation {
  country?: string;
  countryCode?: string;
  city?: string;
  region?: string;
  latitude?: number;
  longitude?: number;
}

@Injectable()
export class GeoLocationService {
  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Get location information from IP address
   */
  async getLocationFromIp(ip: string): Promise<GeoLocation | null> {
    // Skip for private/local IPs
    if (this.isPrivateIp(ip) || ip === '127.0.0.1' || ip === 'localhost') {
      return null;
    }

    try {
      // Try cache first
      const cached = await this.getCachedLocation(ip);
      if (cached) {
        return cached;
      }

      // For demo purposes, we'll use a simple IP-to-country mapping
      // In production, you would integrate with a real GeoIP service like:
      // - MaxMind GeoIP2
      // - IPInfo.io
      // - IP2Location
      // - CloudFlare's IP geolocation
      
      const location = await this.mockGeoLocation(ip);
      
      if (location) {
        // Cache for 24 hours
        await this.cacheLocation(ip, location);
      }

      return location;
    } catch (error) {
      this.logger.error('Failed to get geolocation', error.message, 'GeoLocationService', {
        ip,
        error: error.stack,
      });
      return null;
    }
  }

  /**
   * Mock geolocation for demo purposes
   * In production, replace this with actual GeoIP service integration
   */
  private async mockGeoLocation(ip: string): Promise<GeoLocation | null> {
    // Simple mock based on IP patterns for demo
    const ipParts = ip.split('.');
    const firstOctet = parseInt(ipParts[0], 10);
    
    // Mock location based on first octet (this is not accurate, just for demo)
    const mockLocations: Record<string, GeoLocation> = {
      '1-50': { country: 'United States', countryCode: 'US', city: 'New York', region: 'NY' },
      '51-100': { country: 'United Kingdom', countryCode: 'GB', city: 'London', region: 'England' },
      '101-150': { country: 'Germany', countryCode: 'DE', city: 'Berlin', region: 'Berlin' },
      '151-200': { country: 'France', countryCode: 'FR', city: 'Paris', region: 'Île-de-France' },
      '201-255': { country: 'Japan', countryCode: 'JP', city: 'Tokyo', region: 'Tokyo' },
    };

    if (firstOctet >= 1 && firstOctet <= 50) return mockLocations['1-50'];
    if (firstOctet >= 51 && firstOctet <= 100) return mockLocations['51-100'];
    if (firstOctet >= 101 && firstOctet <= 150) return mockLocations['101-150'];
    if (firstOctet >= 151 && firstOctet <= 200) return mockLocations['151-200'];
    if (firstOctet >= 201 && firstOctet <= 255) return mockLocations['201-255'];

    return { country: 'Unknown', countryCode: 'XX', city: 'Unknown' };
  }

  /**
   * Get cached location
   */
  private async getCachedLocation(ip: string): Promise<GeoLocation | null> {
    try {
      const cached = await this.redisService.get(`geo:${ip}`);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      this.logger.error('Failed to get cached location', error.message, 'GeoLocationService', { ip });
      return null;
    }
  }

  /**
   * Cache location information
   */
  private async cacheLocation(ip: string, location: GeoLocation): Promise<void> {
    try {
      const ttl = 24 * 60 * 60; // 24 hours
      await this.redisService.setex(`geo:${ip}`, ttl, JSON.stringify(location));
    } catch (error) {
      this.logger.error('Failed to cache location', error.message, 'GeoLocationService', { ip });
    }
  }

  /**
   * Check if IP is private
   */
  private isPrivateIp(ip: string): boolean {
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const match = ip.match(ipv4Regex);
    
    if (!match) {
      return false;
    }

    const [, a, b, c, d] = match.map(Number);
    
    return (
      (a === 10) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 127)
    );
  }

  /**
   * Get location statistics
   */
  async getLocationStats(): Promise<{ totalCountries: number; topCountries: Array<{ country: string; count: number }> }> {
    try {
      // This would typically query your analytics database
      // For now, return mock data
      return {
        totalCountries: 50,
        topCountries: [
          { country: 'United States', count: 1500 },
          { country: 'United Kingdom', count: 800 },
          { country: 'Germany', count: 600 },
          { country: 'France', count: 450 },
          { country: 'Japan', count: 300 },
        ],
      };
    } catch (error) {
      this.logger.error('Failed to get location stats', error.message, 'GeoLocationService');
      throw error;
    }
  }
}