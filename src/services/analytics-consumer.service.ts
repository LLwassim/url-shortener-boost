import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KafkaService } from './kafka.service';
import { CassandraService } from './cassandra.service';
import { LoggerService } from './logger.service';
import { HitEventDto } from '../dto/analytics.dto';

@Injectable()
export class AnalyticsConsumerService implements OnModuleInit, OnModuleDestroy {
  private isRunning = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly kafkaService: KafkaService,
    private readonly cassandraService: CassandraService,
    private readonly logger: LoggerService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.startConsumer();
      this.logger.log('✅ Analytics consumer service initialized', 'AnalyticsConsumerService');
    } catch (error) {
      this.logger.error('❌ Failed to initialize analytics consumer service', error.message, 'AnalyticsConsumerService', {
        error: error.stack,
      });
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.isRunning = false;
    this.logger.log('✅ Analytics consumer service stopped', 'AnalyticsConsumerService');
  }

  /**
   * Start consuming hit events from Kafka
   */
  private async startConsumer(): Promise<void> {
    this.isRunning = true;

    try {
      await this.kafkaService.startConsumer(async (hitEvent: HitEventDto) => {
        await this.processHitEvent(hitEvent);
      });

      this.logger.log('📥 Analytics consumer started successfully', 'AnalyticsConsumerService');
    } catch (error) {
      this.logger.error('❌ Failed to start analytics consumer', error.message, 'AnalyticsConsumerService', {
        error: error.stack,
      });
      throw error;
    }
  }

  /**
   * Process a single hit event
   */
  private async processHitEvent(hitEvent: HitEventDto): Promise<void> {
    const startTime = Date.now();

    try {
      // Validate hit event
      if (!this.isValidHitEvent(hitEvent)) {
        this.logger.warn('Invalid hit event received', 'AnalyticsConsumerService', {
          code: hitEvent.code,
          timestamp: hitEvent.timestamp,
        });
        return;
      }

      // Store analytics data in Cassandra
      await this.cassandraService.recordHitEvent(hitEvent);

      const duration = Date.now() - startTime;
      this.logger.debug('Hit event processed successfully', 'AnalyticsConsumerService', {
        code: hitEvent.code,
        timestamp: hitEvent.timestamp,
        duration,
      });

      // Update processing metrics
      this.recordProcessingMetrics('success', duration);
    } catch (error) {
      const duration = Date.now() - startTime;
      
      this.logger.error('Failed to process hit event', error.message, 'AnalyticsConsumerService', {
        code: hitEvent.code,
        timestamp: hitEvent.timestamp,
        duration,
        error: error.stack,
      });

      // Update processing metrics
      this.recordProcessingMetrics('error', duration);

      // In production, you might want to send failed events to a dead letter queue
      await this.handleFailedEvent(hitEvent, error);
    }
  }

  /**
   * Validate hit event data
   */
  private isValidHitEvent(hitEvent: HitEventDto): boolean {
    if (!hitEvent.code || !hitEvent.timestamp || !hitEvent.ip || !hitEvent.userAgent) {
      return false;
    }

    // Check if timestamp is reasonable (not too old or in the future)
    const now = Date.now();
    const eventTime = hitEvent.timestamp.getTime();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    const maxFuture = 5 * 60 * 1000; // 5 minutes

    if (eventTime < now - maxAge || eventTime > now + maxFuture) {
      return false;
    }

    // Validate IP address format
    const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$|^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
    if (!ipRegex.test(hitEvent.ip)) {
      return false;
    }

    return true;
  }

  /**
   * Handle failed events
   */
  private async handleFailedEvent(hitEvent: HitEventDto, error: Error): Promise<void> {
    try {
      // In a production system, you would:
      // 1. Send to a dead letter queue for manual inspection
      // 2. Store in a separate error table for debugging
      // 3. Trigger alerts for high error rates
      // 4. Implement retry logic with exponential backoff

      this.logger.error('Hit event processing failed - would send to DLQ in production', error.message, 'AnalyticsConsumerService', {
        code: hitEvent.code,
        timestamp: hitEvent.timestamp,
        ip: hitEvent.ip,
        error: error.stack,
      });

      // For now, just log the failure
      // TODO: Implement dead letter queue logic
    } catch (dlqError) {
      this.logger.error('Failed to handle failed event', dlqError.message, 'AnalyticsConsumerService', {
        originalError: error.message,
        dlqError: dlqError.stack,
      });
    }
  }

  /**
   * Record processing metrics
   */
  private recordProcessingMetrics(status: 'success' | 'error', duration: number): void {
    try {
      // In a production system, you would send these metrics to your monitoring system
      this.logger.logMetric('analytics_events_processed', 1, { status });
      this.logger.logMetric('analytics_processing_duration_ms', duration, { status });
    } catch (error) {
      // Don't let metrics recording failures break event processing
      this.logger.error('Failed to record processing metrics', error.message, 'AnalyticsConsumerService');
    }
  }

  /**
   * Get consumer health status
   */
  async getHealth(): Promise<{ running: boolean; lastProcessed?: Date; errorRate?: number }> {
    return {
      running: this.isRunning,
      // In production, you would track these metrics
      lastProcessed: new Date(),
      errorRate: 0.01, // 1% error rate
    };
  }

  /**
   * Get processing statistics
   */
  async getStats(): Promise<{
    totalProcessed: number;
    successCount: number;
    errorCount: number;
    avgProcessingTime: number;
    lastHour: {
      processed: number;
      errors: number;
    };
  }> {
    // In production, these would come from actual metrics
    return {
      totalProcessed: 25000,
      successCount: 24750,
      errorCount: 250,
      avgProcessingTime: 15.5,
      lastHour: {
        processed: 1200,
        errors: 12,
      },
    };
  }

  /**
   * Process events in batches for better performance
   */
  private async processBatchEvents(events: HitEventDto[]): Promise<void> {
    const batchSize = 100;
    const batches = [];

    // Split events into batches
    for (let i = 0; i < events.length; i += batchSize) {
      batches.push(events.slice(i, i + batchSize));
    }

    // Process batches in parallel with limited concurrency
    const concurrency = 5;
    for (let i = 0; i < batches.length; i += concurrency) {
      const batchGroup = batches.slice(i, i + concurrency);
      
      await Promise.allSettled(
        batchGroup.map(batch => this.processBatch(batch))
      );
    }
  }

  /**
   * Process a batch of events
   */
  private async processBatch(events: HitEventDto[]): Promise<void> {
    const startTime = Date.now();

    try {
      // Process all events in the batch
      await Promise.allSettled(
        events.map(event => this.processHitEvent(event))
      );

      const duration = Date.now() - startTime;
      this.logger.debug('Batch processed successfully', 'AnalyticsConsumerService', {
        batchSize: events.length,
        duration,
      });
    } catch (error) {
      this.logger.error('Batch processing failed', error.message, 'AnalyticsConsumerService', {
        batchSize: events.length,
        error: error.stack,
      });
    }
  }
}