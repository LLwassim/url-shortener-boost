import { IsUrl, IsOptional, IsString, Length, IsISO8601, IsIP, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUrlDto {
  @ApiProperty({
    description: 'The URL to be shortened',
    example: 'https://example.com/very/long/url/path?param=value',
    maxLength: 2048,
  })
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
    require_valid_protocol: true,
    allow_underscores: false,
    host_whitelist: undefined,
    host_blacklist: undefined,
  }, {
    message: 'URL must be a valid HTTP or HTTPS URL',
  })
  @Length(1, 2048, {
    message: 'URL must be between 1 and 2048 characters long',
  })
  @Transform(({ value }) => value?.trim())
  url: string;

  @ApiPropertyOptional({
    description: 'Custom alias for the short URL (optional)',
    example: 'my-custom-link',
    minLength: 3,
    maxLength: 50,
  })
  @IsOptional()
  @IsString()
  @Length(3, 50, {
    message: 'Custom alias must be between 3 and 50 characters long',
  })
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'Custom alias can only contain letters, numbers, underscores, and hyphens',
  })
  @Transform(({ value }) => value?.trim().toLowerCase())
  customAlias?: string;

  @ApiPropertyOptional({
    description: 'Expiration date in ISO 8601 format (optional)',
    example: '2024-12-31T23:59:59.000Z',
  })
  @IsOptional()
  @IsISO8601({
    strict: true,
  }, {
    message: 'Expiration date must be a valid ISO 8601 date',
  })
  @Transform(({ value }) => {
    if (!value) return undefined;
    const date = new Date(value);
    if (date <= new Date()) {
      throw new Error('Expiration date must be in the future');
    }
    return date.toISOString();
  })
  expiresAt?: string;

  @ApiPropertyOptional({
    description: 'Additional metadata (optional)',
    example: { source: 'mobile-app', campaign: 'summer-2024' },
  })
  @IsOptional()
  metadata?: Record<string, any>;
}

export class CreateUrlWithContextDto extends CreateUrlDto {
  @ApiPropertyOptional({
    description: 'IP address of the client (automatically populated)',
    example: '192.168.1.1',
  })
  @IsOptional()
  @IsIP('4', {
    message: 'IP address must be a valid IPv4 address',
  })
  clientIp?: string;

  @ApiPropertyOptional({
    description: 'User agent of the client (automatically populated)',
    example: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  })
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  userAgent?: string;
}