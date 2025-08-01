import { IsOptional, IsInt, Min, Max, IsIn, IsString, Length } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Page number (1-based)',
    example: 1,
    minimum: 1,
    maximum: 1000,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Page must be an integer' })
  @Min(1, { message: 'Page must be at least 1' })
  @Max(1000, { message: 'Page cannot exceed 1000' })
  page: number = 1;

  @ApiPropertyOptional({
    description: 'Number of items per page',
    example: 20,
    minimum: 1,
    maximum: 100,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Limit must be an integer' })
  @Min(1, { message: 'Limit must be at least 1' })
  @Max(100, { message: 'Limit cannot exceed 100' })
  limit: number = 20;

  @ApiPropertyOptional({
    description: 'Sort field',
    example: 'createdAt',
    enum: ['createdAt', 'updatedAt', 'hitCount', 'original', 'code'],
    default: 'createdAt',
  })
  @IsOptional()
  @IsString()
  @IsIn(['createdAt', 'updatedAt', 'hitCount', 'original', 'code'], {
    message: 'Sort field must be one of: createdAt, updatedAt, hitCount, original, code',
  })
  sort: string = 'createdAt';

  @ApiPropertyOptional({
    description: 'Sort order',
    example: 'DESC',
    enum: ['ASC', 'DESC'],
    default: 'DESC',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => value?.toUpperCase())
  @IsIn(['ASC', 'DESC'], {
    message: 'Order must be either ASC or DESC',
  })
  order: 'ASC' | 'DESC' = 'DESC';

  @ApiPropertyOptional({
    description: 'Search term to filter URLs',
    example: 'example.com',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @Length(1, 100, {
    message: 'Search term must be between 1 and 100 characters',
  })
  @Transform(({ value }) => value?.trim())
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by expiration status',
    example: 'active',
    enum: ['all', 'active', 'expired'],
    default: 'all',
  })
  @IsOptional()
  @IsString()
  @IsIn(['all', 'active', 'expired'], {
    message: 'Status must be one of: all, active, expired',
  })
  status: 'all' | 'active' | 'expired' = 'all';

  /**
   * Calculate offset for database query
   */
  get offset(): number {
    return (this.page - 1) * this.limit;
  }

  /**
   * Get sort configuration for TypeORM
   */
  getSortConfig(): Record<string, 'ASC' | 'DESC'> {
    return { [this.sort]: this.order };
  }

  /**
   * Validate and normalize the DTO
   */
  normalize(): this {
    this.page = Math.max(1, Math.min(1000, this.page));
    this.limit = Math.max(1, Math.min(100, this.limit));
    return this;
  }
}