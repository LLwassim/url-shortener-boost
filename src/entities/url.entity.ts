import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

@Entity('urls')
@Index(['normalized'], { unique: true })
@Index(['code'], { unique: true })
@Index(['createdAt'])
@Index(['expiresAt'])
export class UrlEntity {
  @ApiProperty({ description: 'Unique identifier' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Short code for the URL', example: 'abc123' })
  @Column({ type: 'varchar', length: 16, unique: true })
  code: string;

  @ApiProperty({ description: 'Original URL', example: 'https://example.com/very/long/url' })
  @Column({ type: 'text' })
  original: string;

  @ApiProperty({ description: 'Normalized URL for deduplication' })
  @Column({ type: 'text', unique: true })
  normalized: string;

  @ApiProperty({ description: 'Number of times the URL has been accessed' })
  @Column({ type: 'bigint', default: 0 })
  hitCount: number;

  @ApiProperty({ description: 'Custom alias if provided', required: false })
  @Column({ type: 'varchar', length: 50, nullable: true })
  customAlias?: string;

  @ApiProperty({ description: 'Expiration timestamp', required: false })
  @Column({ type: 'timestamp with time zone', nullable: true })
  expiresAt?: Date;

  @ApiProperty({ description: 'Creation timestamp' })
  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAt: Date;

  @ApiProperty({ description: 'IP address of the creator', required: false })
  @Column({ type: 'inet', nullable: true })
  creatorIp?: string;

  @ApiProperty({ description: 'User agent of the creator', required: false })
  @Column({ type: 'text', nullable: true })
  creatorUserAgent?: string;

  @ApiProperty({ description: 'Additional metadata', required: false })
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  /**
   * Check if the URL has expired
   */
  isExpired(): boolean {
    return this.expiresAt ? new Date() > this.expiresAt : false;
  }

  /**
   * Get the full short URL
   */
  getShortUrl(baseUrl: string): string {
    return `${baseUrl}/${this.code}`;
  }

  /**
   * Increment hit count (for local tracking)
   */
  incrementHitCount(): void {
    this.hitCount = Number(this.hitCount) + 1;
  }
}