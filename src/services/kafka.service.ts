import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer, Consumer, KafkaMessage } from 'kafkajs';
import { LoggerService } from './logger.service';
import { HitEventDto } from '../dto/analytics.dto';

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private kafka: Kafka;
  private producer: Producer;
  private consumer: Consumer;
  private readonly topicHits: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.topicHits = this.configService.get<string>('KAFKA_TOPIC_HITS', 'url.hits');
    
    this.kafka = new Kafka({
      clientId: this.configService.get<string>('KAFKA_CLIENT_ID', 'url-shortener'),
      brokers: this.configService.get<string>('KAFKA_BROKERS', 'localhost:9092').split(','),
      retry: {
        initialRetryTime: 300,
        retries: 8,
        multiplier: 2,
      },
      connectionTimeout: 10000,
      requestTimeout: 30000,
    });

    this.producer = this.kafka.producer({
      maxInFlightRequests: 1,
      idempotent: true,
      transactionTimeout: 30000,
    });

    this.consumer = this.kafka.consumer({
      groupId: this.configService.get<string>('KAFKA_CONSUMER_GROUP_ID', 'url-shortener-analytics'),
      sessionTimeout: 30000,
      rebalanceTimeout: 60000,
      heartbeatInterval: 3000,
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.connectProducer();
      await this.connectConsumer();
      await this.createTopics();
      this.logger.log('✅ Kafka service initialized', 'KafkaService');
    } catch (error) {
      this.logger.error('❌ Failed to initialize Kafka service', error.message, 'KafkaService', { error: error.stack });
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await Promise.all([
        this.producer.disconnect(),
        this.consumer.disconnect(),
      ]);
      this.logger.log('✅ Kafka service disconnected', 'KafkaService');
    } catch (error) {
      this.logger.error('❌ Error disconnecting Kafka service', error.message, 'KafkaService');
    }
  }

  /**
   * Connect the Kafka producer
   */
  private async connectProducer(): Promise<void> {
    await this.producer.connect();
    this.logger.log('📤 Kafka producer connected', 'KafkaService');
  }

  /**
   * Connect the Kafka consumer
   */
  private async connectConsumer(): Promise<void> {
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: this.topicHits, fromBeginning: false });
    this.logger.log('📥 Kafka consumer connected and subscribed', 'KafkaService');
  }

  /**
   * Create necessary topics
   */
  private async createTopics(): Promise<void> {
    const admin = this.kafka.admin();
    
    try {
      await admin.connect();
      
      const topics = await admin.listTopics();
      
      if (!topics.includes(this.topicHits)) {
        await admin.createTopics({
          topics: [
            {
              topic: this.topicHits,
              numPartitions: 3,
              replicationFactor: 1,
              configEntries: [
                {
                  name: 'cleanup.policy',
                  value: 'compact',
                },
                {
                  name: 'retention.ms',
                  value: '604800000', // 7 days
                },
              ],
            },
          ],
        });
        
        this.logger.log(`📝 Created Kafka topic: ${this.topicHits}`, 'KafkaService');
      }
    } catch (error) {
      this.logger.error('❌ Failed to create Kafka topics', error.message, 'KafkaService');
      throw error;
    } finally {
      await admin.disconnect();
    }
  }

  /**
   * Publish a URL hit event
   */
  async publishHitEvent(hitEvent: HitEventDto): Promise<void> {
    try {
      const message = {
        key: hitEvent.code,
        value: JSON.stringify({
          ...hitEvent,
          timestamp: hitEvent.timestamp.toISOString(),
        }),
        headers: {
          eventType: 'url.hit',
          version: '1.0',
          source: 'url-shortener',
        },
      };

      await this.producer.send({
        topic: this.topicHits,
        messages: [message],
      });

      this.logger.debug('📤 Published hit event to Kafka', 'KafkaService', {
        code: hitEvent.code,
        timestamp: hitEvent.timestamp,
      });
    } catch (error) {
      this.logger.error('❌ Failed to publish hit event', error.message, 'KafkaService', {
        code: hitEvent.code,
        error: error.stack,
      });
      // Don't throw error to avoid breaking the redirect flow
    }
  }

  /**
   * Start consuming hit events
   */
  async startConsumer(onMessage: (message: HitEventDto) => Promise<void>): Promise<void> {
    try {
      await this.consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          try {
            const hitEvent = this.parseHitEvent(message);
            await onMessage(hitEvent);
            
            this.logger.debug('📥 Processed hit event from Kafka', 'KafkaService', {
              topic,
              partition,
              code: hitEvent.code,
            });
          } catch (error) {
            this.logger.error('❌ Failed to process hit event', error.message, 'KafkaService', {
              topic,
              partition,
              offset: message.offset,
              error: error.stack,
            });
          }
        },
      });
      
      this.logger.log('📥 Kafka consumer started', 'KafkaService');
    } catch (error) {
      this.logger.error('❌ Failed to start Kafka consumer', error.message, 'KafkaService');
      throw error;
    }
  }

  /**
   * Parse Kafka message to HitEventDto
   */
  private parseHitEvent(message: KafkaMessage): HitEventDto {
    if (!message.value) {
      throw new Error('Message value is null');
    }

    const data = JSON.parse(message.value.toString());
    
    return {
      code: data.code,
      timestamp: new Date(data.timestamp),
      ip: data.ip,
      userAgent: data.userAgent,
      referrer: data.referrer,
      country: data.country,
      city: data.city,
      deviceType: data.deviceType,
      browser: data.browser,
      os: data.os,
    };
  }

  /**
   * Publish batch of hit events
   */
  async publishHitEventBatch(hitEvents: HitEventDto[]): Promise<void> {
    try {
      const messages = hitEvents.map(hitEvent => ({
        key: hitEvent.code,
        value: JSON.stringify({
          ...hitEvent,
          timestamp: hitEvent.timestamp.toISOString(),
        }),
        headers: {
          eventType: 'url.hit',
          version: '1.0',
          source: 'url-shortener',
        },
      }));

      await this.producer.send({
        topic: this.topicHits,
        messages,
      });

      this.logger.debug('📤 Published hit event batch to Kafka', 'KafkaService', {
        count: hitEvents.length,
      });
    } catch (error) {
      this.logger.error('❌ Failed to publish hit event batch', error.message, 'KafkaService', {
        count: hitEvents.length,
        error: error.stack,
      });
    }
  }

  /**
   * Get producer health status
   */
  async getProducerHealth(): Promise<boolean> {
    try {
      // Send a test message to check connectivity
      await this.producer.send({
        topic: this.topicHits,
        messages: [{
          key: 'health-check',
          value: JSON.stringify({ type: 'health-check', timestamp: new Date().toISOString() }),
        }],
      });
      return true;
    } catch (error) {
      this.logger.error('❌ Kafka producer health check failed', error.message, 'KafkaService');
      return false;
    }
  }

  /**
   * Get consumer health status
   */
  async getConsumerHealth(): Promise<boolean> {
    try {
      // Check if consumer is connected
      return this.consumer !== null;
    } catch (error) {
      this.logger.error('❌ Kafka consumer health check failed', error.message, 'KafkaService');
      return false;
    }
  }
}