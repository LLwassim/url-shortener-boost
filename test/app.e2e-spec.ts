import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { testApp } from './setup-e2e';

describe('URL Shortener E2E Tests', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = testApp;
  });

  afterAll(async () => {
    // Cleanup is handled in setup-e2e.ts
  });

  describe('Health Endpoints', () => {
    it('/health (GET)', () => {
      return request(app.getHttpServer())
        .get('/health')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('status');
          expect(res.body).toHaveProperty('timestamp');
          expect(res.body).toHaveProperty('uptime');
          expect(res.body).toHaveProperty('checks');
        });
    });

    it('/health/liveness (GET)', () => {
      return request(app.getHttpServer())
        .get('/health/liveness')
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBe('alive');
        });
    });

    it('/health/readiness (GET)', () => {
      return request(app.getHttpServer())
        .get('/health/readiness')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('status');
          expect(res.body).toHaveProperty('checks');
        });
    });
  });

  describe('URL Shortening Flow', () => {
    let shortCode: string;
    let shortUrl: string;

    it('should create a short URL', () => {
      return request(app.getHttpServer())
        .post('/api/urls')
        .send({
          url: 'https://example.com/test-e2e',
        })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty('code');
          expect(res.body).toHaveProperty('shortUrl');
          expect(res.body).toHaveProperty('original', 'https://example.com/test-e2e');
          expect(res.body).toHaveProperty('isNew', true);
          
          shortCode = res.body.code;
          shortUrl = res.body.shortUrl;
        });
    });

    it('should redirect using the short code', () => {
      return request(app.getHttpServer())
        .get(`/${shortCode}`)
        .expect(302)
        .expect('Location', 'https://example.com/test-e2e');
    });

    it('should preview URL information', () => {
      return request(app.getHttpServer())
        .get(`/${shortCode}/preview`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('code', shortCode);
          expect(res.body).toHaveProperty('original', 'https://example.com/test-e2e');
          expect(res.body).toHaveProperty('hitCount');
          expect(res.body).toHaveProperty('isExpired', false);
        });
    });

    it('should return existing URL for duplicate request', () => {
      return request(app.getHttpServer())
        .post('/api/urls')
        .send({
          url: 'https://example.com/test-e2e',
        })
        .expect(201)
        .expect((res) => {
          expect(res.body.code).toBe(shortCode);
          expect(res.body.isNew).toBe(false);
        });
    });
  });

  describe('Custom Alias Flow', () => {
    it('should create URL with custom alias', () => {
      return request(app.getHttpServer())
        .post('/api/urls')
        .send({
          url: 'https://example.com/custom-alias-e2e',
          customAlias: 'my-custom-link',
        })
        .expect(201)
        .expect((res) => {
          expect(res.body.code).toBe('my-custom-link');
          expect(res.body.isNew).toBe(true);
        });
    });

    it('should redirect using custom alias', () => {
      return request(app.getHttpServer())
        .get('/my-custom-link')
        .expect(302)
        .expect('Location', 'https://example.com/custom-alias-e2e');
    });

    it('should reject duplicate custom alias', () => {
      return request(app.getHttpServer())
        .post('/api/urls')
        .send({
          url: 'https://example.com/another-url',
          customAlias: 'my-custom-link',
        })
        .expect(400)
        .expect((res) => {
          expect(res.body.message).toContain('Custom alias already exists');
        });
    });
  });

  describe('URL Expiration', () => {
    it('should create URL with expiration', () => {
      const futureDate = new Date(Date.now() + 60000); // 1 minute from now
      
      return request(app.getHttpServer())
        .post('/api/urls')
        .send({
          url: 'https://example.com/expiring-url',
          expiresAt: futureDate.toISOString(),
        })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty('expiresAt');
        });
    });

    it('should reject past expiration date', () => {
      const pastDate = new Date(Date.now() - 60000); // 1 minute ago
      
      return request(app.getHttpServer())
        .post('/api/urls')
        .send({
          url: 'https://example.com/past-expiry',
          expiresAt: pastDate.toISOString(),
        })
        .expect(400);
    });
  });

  describe('URL Listing', () => {
    beforeAll(async () => {
      // Create some test URLs
      const testUrls = [
        'https://example.com/list-test-1',
        'https://example.com/list-test-2',
        'https://example.com/list-test-3',
      ];

      for (const url of testUrls) {
        await request(app.getHttpServer())
          .post('/api/urls')
          .send({ url });
      }
    });

    it('should list URLs with pagination', () => {
      return request(app.getHttpServer())
        .get('/api/urls')
        .query({ page: 1, limit: 10 })
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('urls');
          expect(res.body).toHaveProperty('total');
          expect(res.body).toHaveProperty('page', 1);
          expect(res.body).toHaveProperty('limit', 10);
          expect(res.body).toHaveProperty('totalPages');
          expect(res.body).toHaveProperty('hasNext');
          expect(res.body).toHaveProperty('hasPrev');
          
          expect(Array.isArray(res.body.urls)).toBe(true);
          expect(res.body.total).toBeGreaterThan(0);
        });
    });

    it('should filter URLs by search term', () => {
      return request(app.getHttpServer())
        .get('/api/urls')
        .query({ search: 'list-test' })
        .expect(200)
        .expect((res) => {
          expect(res.body.urls.length).toBeGreaterThan(0);
          
          // All URLs should contain the search term
          res.body.urls.forEach((url: any) => {
            expect(url.original).toContain('list-test');
          });
        });
    });

    it('should sort URLs by different fields', () => {
      return request(app.getHttpServer())
        .get('/api/urls')
        .query({ sort: 'createdAt', order: 'ASC' })
        .expect(200)
        .expect((res) => {
          expect(res.body.urls.length).toBeGreaterThan(1);
          
          // Check if sorted by creation date (ascending)
          for (let i = 1; i < res.body.urls.length; i++) {
            const prev = new Date(res.body.urls[i - 1].createdAt);
            const curr = new Date(res.body.urls[i].createdAt);
            expect(prev.getTime()).toBeLessThanOrEqual(curr.getTime());
          }
        });
    });
  });

  describe('URL Statistics', () => {
    it('should get URL statistics', () => {
      return request(app.getHttpServer())
        .get('/api/urls/stats')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('total');
          expect(res.body).toHaveProperty('active');
          expect(res.body).toHaveProperty('expired');
          
          expect(typeof res.body.total).toBe('number');
          expect(typeof res.body.active).toBe('number');
          expect(typeof res.body.expired).toBe('number');
        });
    });
  });

  describe('Admin Endpoints', () => {
    const adminApiKey = 'test-admin-key';

    it('should delete URL with valid API key', async () => {
      // First create a URL to delete
      const createResponse = await request(app.getHttpServer())
        .post('/api/urls')
        .send({
          url: 'https://example.com/to-be-deleted',
        });

      const { code } = createResponse.body;

      // Delete the URL
      return request(app.getHttpServer())
        .delete(`/api/urls/${code}`)
        .set('X-API-Key', adminApiKey)
        .expect(204);
    });

    it('should reject delete without API key', async () => {
      return request(app.getHttpServer())
        .delete('/api/urls/some-code')
        .expect(401)
        .expect((res) => {
          expect(res.body.message).toContain('API key is required');
        });
    });

    it('should reject delete with invalid API key', async () => {
      return request(app.getHttpServer())
        .delete('/api/urls/some-code')
        .set('X-API-Key', 'invalid-key')
        .expect(401)
        .expect((res) => {
          expect(res.body.message).toContain('Invalid API key');
        });
    });
  });

  describe('Error Handling', () => {
    it('should return 400 for invalid URL', () => {
      return request(app.getHttpServer())
        .post('/api/urls')
        .send({
          url: 'not-a-valid-url',
        })
        .expect(400);
    });

    it('should return 400 for invalid custom alias', () => {
      return request(app.getHttpServer())
        .post('/api/urls')
        .send({
          url: 'https://example.com/test',
          customAlias: 'a', // Too short
        })
        .expect(400);
    });

    it('should return 404 for non-existent short code', () => {
      return request(app.getHttpServer())
        .get('/non-existent-code')
        .expect(404);
    });

    it('should return 404 for non-existent preview', () => {
      return request(app.getHttpServer())
        .get('/non-existent-code/preview')
        .expect(404);
    });
  });

  describe('Rate Limiting', () => {
    it('should handle multiple requests within rate limit', async () => {
      const promises = [];
      
      for (let i = 0; i < 5; i++) {
        promises.push(
          request(app.getHttpServer())
            .post('/api/urls')
            .send({
              url: `https://example.com/rate-limit-test-${i}`,
            })
        );
      }

      const responses = await Promise.all(promises);
      
      // All requests should succeed (within rate limit)
      responses.forEach((response) => {
        expect(response.status).toBe(201);
      });
    });
  });

  describe('Metrics Endpoint', () => {
    it('should return Prometheus metrics', () => {
      return request(app.getHttpServer())
        .get('/metrics')
        .expect(200)
        .expect('Content-Type', /text\/plain/)
        .expect((res) => {
          expect(res.text).toContain('# HELP');
          expect(res.text).toContain('# TYPE');
        });
    });

    it('should return metrics in JSON format', () => {
      return request(app.getHttpServer())
        .get('/metrics/json')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('timestamp');
          expect(res.body).toHaveProperty('application');
          expect(res.body).toHaveProperty('http');
          expect(res.body).toHaveProperty('urls');
          expect(res.body).toHaveProperty('system');
        });
    });
  });

  describe('Security Headers', () => {
    it('should include security headers in responses', () => {
      return request(app.getHttpServer())
        .get('/health')
        .expect((res) => {
          expect(res.headers).toHaveProperty('x-request-id');
          // Add more security header checks as needed
        });
    });
  });
});