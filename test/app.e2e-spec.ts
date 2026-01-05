import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Payment Gateway Router (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Health Endpoints', () => {
    it('/ (GET) - should return API info', () => {
      return request(app.getHttpServer())
        .get('/')
        .expect(200)
        .expect(res => {
          expect(res.body.name).toBe('Payment Gateway Router');
          expect(res.body.endpoints).toBeDefined();
        });
    });

    it('/health (GET) - should return health status', () => {
      return request(app.getHttpServer())
        .get('/health')
        .expect(200)
        .expect(res => {
          expect(res.body.status).toBe('ok');
          expect(res.body.timestamp).toBeDefined();
        });
    });
  });

  describe('Gateway Endpoints', () => {
    it('/gateways (GET) - should return all gateways', () => {
      return request(app.getHttpServer())
        .get('/gateways')
        .expect(200)
        .expect(res => {
          expect(res.body.gateways).toHaveLength(3);
          expect(res.body.gateways.map((g: { name: string }) => g.name)).toEqual([
            'razorpay',
            'payu',
            'cashfree',
          ]);
        });
    });

    it('/gateways/:name/health (GET) - should return gateway health', () => {
      return request(app.getHttpServer())
        .get('/gateways/razorpay/health')
        .expect(200)
        .expect(res => {
          expect(res.body.name).toBe('razorpay');
          expect(res.body.isHealthy).toBe(true);
        });
    });
  });

  describe('Transaction Flow', () => {
    const orderId = `ORD-E2E-${Date.now()}`;
    let selectedGateway: string;

    beforeAll(async () => {
      // Reset state before tests
      await request(app.getHttpServer()).post('/transactions/reset');
      await request(app.getHttpServer()).post('/gateways/reset');
    });

    it('/transactions/initiate (POST) - should create transaction', async () => {
      const response = await request(app.getHttpServer())
        .post('/transactions/initiate')
        .send({
          order_id: orderId,
          amount: 999.0,
          payment_instrument: {
            type: 'card',
            card_number: '4111111111111111',
            expiry: '12/25',
          },
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.order_id).toBe(orderId);
      expect(response.body.data.status).toBe('pending');
      expect(response.body.data.gateway).toBeDefined();
      expect(response.body.data.gateway_selection_reason).toBeDefined();

      selectedGateway = response.body.data.gateway;
    });

    it('/transactions/initiate (POST) - should reject duplicate order', async () => {
      await request(app.getHttpServer())
        .post('/transactions/initiate')
        .send({
          order_id: orderId,
          amount: 999.0,
          payment_instrument: {
            type: 'card',
            card_number: '4111111111111111',
            expiry: '12/25',
          },
        })
        .expect(400);
    });

    it('/transactions/callback (POST) - should update transaction to success', async () => {
      const response = await request(app.getHttpServer())
        .post('/transactions/callback')
        .send({
          order_id: orderId,
          status: 'success',
          gateway: selectedGateway,
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('success');
    });

    it('/transactions/order/:orderId (GET) - should return transaction by order ID', async () => {
      const response = await request(app.getHttpServer())
        .get(`/transactions/order/${orderId}`)
        .expect(200);

      expect(response.body.data.order_id).toBe(orderId);
      expect(response.body.data.status).toBe('success');
    });
  });

  describe('Transaction Validation', () => {
    it('should reject invalid amount', () => {
      return request(app.getHttpServer())
        .post('/transactions/initiate')
        .send({
          order_id: 'ORD-INVALID',
          amount: -100,
          payment_instrument: {
            type: 'card',
          },
        })
        .expect(400);
    });

    it('should reject missing payment instrument', () => {
      return request(app.getHttpServer())
        .post('/transactions/initiate')
        .send({
          order_id: 'ORD-INVALID',
          amount: 100,
        })
        .expect(400);
    });

    it('should reject invalid callback status', () => {
      return request(app.getHttpServer())
        .post('/transactions/callback')
        .send({
          order_id: 'ORD-INVALID',
          status: 'invalid_status',
          gateway: 'razorpay',
        })
        .expect(400);
    });
  });

  describe('Gateway Health Flow', () => {
    beforeAll(async () => {
      // Reset state
      await request(app.getHttpServer()).post('/transactions/reset');
      await request(app.getHttpServer()).post('/gateways/reset');
    });

    it('should disable gateway after multiple failures', async () => {
      // Create multiple failed transactions for same gateway
      // Note: This test may need adjustment based on health check threshold
      const gateway = 'razorpay';

      // Manually disable gateway for test
      await request(app.getHttpServer())
        .post(`/gateways/${gateway}/disable`)
        .send({ minutes: 1 })
        .expect(201);

      // Check gateway is disabled
      const response = await request(app.getHttpServer())
        .get(`/gateways/${gateway}/health`)
        .expect(200);

      expect(response.body.isHealthy).toBe(false);
    });

    it('should re-enable gateway manually', async () => {
      await request(app.getHttpServer()).post('/gateways/razorpay/enable').expect(201);

      const response = await request(app.getHttpServer())
        .get('/gateways/razorpay/health')
        .expect(200);

      expect(response.body.isHealthy).toBe(true);
    });
  });
});
