import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Transform } from 'class-transformer';

export class UrlResponseDto {
  @ApiProperty({
    description: 'Unique identifier',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @Expose()
  id: string;

  @ApiProperty({
    description: 'Short code for the URL',
    example: 'abc123',
  })
  @Expose()
  code: string;

  @ApiProperty({
    description: 'Original URL',
    example: 'https://example.com/very/long/url',
  })
  @Expose()
  original: string;

  @ApiProperty({
    description: 'Complete short URL',
    example: 'https://short.ly/abc123',
  })
  @Expose()
  shortUrl: string;

  @ApiProperty({
    description: 'Number of times accessed',
    example: 42,
  })
  @Expose()
  @Transform(({ value }) => Number(value))
  hitCount: number;

  @ApiPropertyOptional({
    description: 'Custom alias if provided',
    example: 'my-link',
  })
  @Expose()
  customAlias?: string;

  @ApiPropertyOptional({
    description: 'Expiration timestamp',
    example: '2024-12-31T23:59:59.000Z',
  })
  @Expose()
  expiresAt?: Date;

  @ApiProperty({
    description: 'Creation timestamp',
    example: '2024-01-01T00:00:00.000Z',
  })
  @Expose()
  createdAt: Date;

  @ApiProperty({
    description: 'Last update timestamp',
    example: '2024-01-01T00:00:00.000Z',
  })
  @Expose()
  updatedAt: Date;

  @ApiPropertyOptional({
    description: 'Additional metadata',
    example: { source: 'api', version: '1.0' },
  })
  @Expose()
  metadata?: Record<string, any>;

  @ApiProperty({
    description: 'Whether the URL has expired',
    example: false,
  })
  @Expose()
  @Transform(({ obj }) => obj.expiresAt ? new Date() > new Date(obj.expiresAt) : false)
  isExpired: boolean;
}

export class UrlListResponseDto {
  @ApiProperty({
    description: 'List of URLs',
    type: [UrlResponseDto],
  })
  urls: UrlResponseDto[];

  @ApiProperty({
    description: 'Total number of URLs',
    example: 150,
  })
  total: number;

  @ApiProperty({
    description: 'Current page number',
    example: 1,
  })
  page: number;

  @ApiProperty({
    description: 'Number of items per page',
    example: 20,
  })
  limit: number;

  @ApiProperty({
    description: 'Total number of pages',
    example: 8,
  })
  totalPages: number;

  @ApiProperty({
    description: 'Whether there is a next page',
    example: true,
  })
  hasNext: boolean;

  @ApiProperty({
    description: 'Whether there is a previous page',
    example: false,
  })
  hasPrev: boolean;
}

export class CreateUrlResponseDto {
  @ApiProperty({
    description: 'Short code for the URL',
    example: 'abc123',
  })
  code: string;

  @ApiProperty({
    description: 'Complete short URL',
    example: 'https://short.ly/abc123',
  })
  shortUrl: string;

  @ApiProperty({
    description: 'Original URL',
    example: 'https://example.com/very/long/url',
  })
  original: string;

  @ApiProperty({
    description: 'Creation timestamp',
    example: '2024-01-01T00:00:00.000Z',
  })
  createdAt: Date;

  @ApiPropertyOptional({
    description: 'Expiration timestamp',
    example: '2024-12-31T23:59:59.000Z',
  })
  expiresAt?: Date;

  @ApiProperty({
    description: 'Whether this was a newly created URL or existing one',
    example: true,
  })
  isNew: boolean;
}