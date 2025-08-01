import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsDateString, IsInt, Min, Max, IsIn } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class AnalyticsQueryDto {
  @ApiPropertyOptional({
    description: 'Start date for analytics (ISO 8601)',
    example: '2024-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString({
    strict: true,
  }, {
    message: 'Start date must be a valid ISO 8601 date',
  })
  startDate?: string;

  @ApiPropertyOptional({
    description: 'End date for analytics (ISO 8601)',
    example: '2024-01-31T23:59:59.000Z',
  })
  @IsOptional()
  @IsDateString({
    strict: true,
  }, {
    message: 'End date must be a valid ISO 8601 date',
  })
  endDate?: string;

  @ApiPropertyOptional({
    description: 'Time granularity for aggregation',
    example: 'hour',
    enum: ['minute', 'hour', 'day', 'week', 'month'],
    default: 'hour',
  })
  @IsOptional()
  @IsIn(['minute', 'hour', 'day', 'week', 'month'])
  granularity: 'minute' | 'hour' | 'day' | 'week' | 'month' = 'hour';

  @ApiPropertyOptional({
    description: 'Limit for top referrers',
    example: 10,
    minimum: 1,
    maximum: 100,
    default: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  topLimit: number = 10;
}

export class HitEventDto {
  @ApiProperty({
    description: 'URL code that was accessed',
    example: 'abc123',
  })
  code: string;

  @ApiProperty({
    description: 'Timestamp of the hit',
    example: '2024-01-01T12:00:00.000Z',
  })
  timestamp: Date;

  @ApiProperty({
    description: 'IP address of the visitor',
    example: '192.168.1.1',
  })
  ip: string;

  @ApiProperty({
    description: 'User agent of the visitor',
    example: 'Mozilla/5.0...',
  })
  userAgent: string;

  @ApiPropertyOptional({
    description: 'Referrer URL',
    example: 'https://google.com',
  })
  referrer?: string;

  @ApiPropertyOptional({
    description: 'Country code derived from IP',
    example: 'US',
  })
  country?: string;

  @ApiPropertyOptional({
    description: 'City derived from IP',
    example: 'New York',
  })
  city?: string;

  @ApiPropertyOptional({
    description: 'Device type (mobile, desktop, tablet)',
    example: 'desktop',
  })
  deviceType?: string;

  @ApiPropertyOptional({
    description: 'Browser name',
    example: 'Chrome',
  })
  browser?: string;

  @ApiPropertyOptional({
    description: 'Operating system',
    example: 'Windows',
  })
  os?: string;
}

export class AnalyticsResponseDto {
  @ApiProperty({
    description: 'URL code',
    example: 'abc123',
  })
  code: string;

  @ApiProperty({
    description: 'Total number of hits',
    example: 1547,
  })
  totalHits: number;

  @ApiProperty({
    description: 'Unique visitors count',
    example: 892,
  })
  uniqueVisitors: number;

  @ApiProperty({
    description: 'First access timestamp',
    example: '2024-01-01T10:30:00.000Z',
  })
  firstAccessed?: Date;

  @ApiProperty({
    description: 'Last access timestamp',
    example: '2024-01-15T16:45:00.000Z',
  })
  lastAccessed?: Date;

  @ApiProperty({
    description: 'Hits over time series data',
    example: [
      { timestamp: '2024-01-01T12:00:00.000Z', hits: 25 },
      { timestamp: '2024-01-01T13:00:00.000Z', hits: 18 },
    ],
  })
  timeSeries: TimeSeriesDataPoint[];

  @ApiProperty({
    description: 'Top referrers',
    example: [
      { referrer: 'https://google.com', hits: 450 },
      { referrer: 'https://twitter.com', hits: 230 },
    ],
  })
  topReferrers: ReferrerDataPoint[];

  @ApiProperty({
    description: 'Geographic distribution',
    example: [
      { country: 'US', hits: 650 },
      { country: 'UK', hits: 320 },
    ],
  })
  geographic: GeographicDataPoint[];

  @ApiProperty({
    description: 'Device type distribution',
    example: [
      { deviceType: 'desktop', hits: 890, percentage: 57.5 },
      { deviceType: 'mobile', hits: 520, percentage: 33.6 },
      { deviceType: 'tablet', hits: 137, percentage: 8.9 },
    ],
  })
  devices: DeviceDataPoint[];

  @ApiProperty({
    description: 'Browser distribution',
    example: [
      { browser: 'Chrome', hits: 720, percentage: 46.5 },
      { browser: 'Safari', hits: 380, percentage: 24.6 },
    ],
  })
  browsers: BrowserDataPoint[];
}

export class TimeSeriesDataPoint {
  @ApiProperty({ description: 'Timestamp', example: '2024-01-01T12:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ description: 'Number of hits', example: 25 })
  hits: number;
}

export class ReferrerDataPoint {
  @ApiProperty({ description: 'Referrer URL', example: 'https://google.com' })
  referrer: string;

  @ApiProperty({ description: 'Number of hits from this referrer', example: 450 })
  hits: number;

  @ApiProperty({ description: 'Percentage of total hits', example: 29.1 })
  percentage: number;
}

export class GeographicDataPoint {
  @ApiProperty({ description: 'Country code', example: 'US' })
  country: string;

  @ApiProperty({ description: 'Country name', example: 'United States' })
  countryName?: string;

  @ApiProperty({ description: 'Number of hits from this country', example: 650 })
  hits: number;

  @ApiProperty({ description: 'Percentage of total hits', example: 42.0 })
  percentage: number;
}

export class DeviceDataPoint {
  @ApiProperty({ description: 'Device type', example: 'desktop' })
  deviceType: string;

  @ApiProperty({ description: 'Number of hits from this device type', example: 890 })
  hits: number;

  @ApiProperty({ description: 'Percentage of total hits', example: 57.5 })
  percentage: number;
}

export class BrowserDataPoint {
  @ApiProperty({ description: 'Browser name', example: 'Chrome' })
  browser: string;

  @ApiProperty({ description: 'Number of hits from this browser', example: 720 })
  hits: number;

  @ApiProperty({ description: 'Percentage of total hits', example: 46.5 })
  percentage: number;
}