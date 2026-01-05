import { Test, TestingModule } from '@nestjs/testing';
import { GatewayHealthService } from './gateway-health.service';
import { MIN_REQUESTS_FOR_HEALTH_CHECK, SUCCESS_RATE_THRESHOLD } from './types/gateway.types';
import { getLoggerToken } from 'nestjs-pino';

describe('GatewayHealthService', () => {
  let service: GatewayHealthService;

  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GatewayHealthService,
        {
          provide: getLoggerToken(GatewayHealthService.name),
          useValue: mockLogger,
        },
      ],
    }).compile();

    service = module.get<GatewayHealthService>(GatewayHealthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    service.resetAllStats();
  });

  describe('recordTransaction', () => {
    it('should record successful transaction', () => {
      service.recordTransaction('razorpay', true);

      const health = service.getGatewayHealth('razorpay');
      expect(health.totalRequests).toBe(1);
      expect(health.successCount).toBe(1);
      expect(health.successRate).toBe(1);
    });

    it('should record failed transaction', () => {
      service.recordTransaction('razorpay', false);

      const health = service.getGatewayHealth('razorpay');
      expect(health.totalRequests).toBe(1);
      expect(health.failureCount).toBe(1);
      expect(health.successRate).toBe(0);
    });

    it('should disable gateway when success rate drops below threshold', () => {
      // Record enough transactions to trigger health check
      const successCount = Math.floor(MIN_REQUESTS_FOR_HEALTH_CHECK * SUCCESS_RATE_THRESHOLD) - 1;
      const failCount = MIN_REQUESTS_FOR_HEALTH_CHECK - successCount;

      for (let i = 0; i < successCount; i++) {
        service.recordTransaction('razorpay', true);
      }
      for (let i = 0; i < failCount; i++) {
        service.recordTransaction('razorpay', false);
      }

      const health = service.getGatewayHealth('razorpay');
      expect(health.isHealthy).toBe(false);
      expect(health.disabledUntil).not.toBeNull();
    });
  });

  describe('isGatewayHealthy', () => {
    it('should return true for healthy gateway', () => {
      expect(service.isGatewayHealthy('razorpay')).toBe(true);
    });

    it('should return false for disabled gateway', () => {
      service.disableGateway('razorpay', 30);
      expect(service.isGatewayHealthy('razorpay')).toBe(false);
    });

    it('should re-enable gateway after cooldown', () => {
      // Disable for a very short time
      service.disableGateway('razorpay', 0.001); // ~60ms

      // Wait for cooldown
      return new Promise<void>(resolve => {
        setTimeout(() => {
          expect(service.isGatewayHealthy('razorpay')).toBe(true);
          resolve();
        }, 100);
      });
    });
  });

  describe('getHealthyGateways', () => {
    it('should return all gateways when all are healthy', () => {
      const healthy = service.getHealthyGateways();
      expect(healthy).toContain('razorpay');
      expect(healthy).toContain('payu');
      expect(healthy).toContain('cashfree');
    });

    it('should exclude disabled gateways', () => {
      service.disableGateway('razorpay', 30);
      const healthy = service.getHealthyGateways();

      expect(healthy).not.toContain('razorpay');
      expect(healthy).toContain('payu');
      expect(healthy).toContain('cashfree');
    });
  });

  describe('getAllGatewayHealth', () => {
    it('should return health for all gateways', () => {
      const allHealth = service.getAllGatewayHealth();

      expect(allHealth).toHaveLength(3);
      expect(allHealth.map(h => h.name)).toEqual(['razorpay', 'payu', 'cashfree']);
    });
  });

  describe('disableGateway / enableGateway', () => {
    it('should manually disable gateway', () => {
      service.disableGateway('razorpay', 30);

      expect(service.isGatewayHealthy('razorpay')).toBe(false);
      const health = service.getGatewayHealth('razorpay');
      expect(health.disabledUntil).not.toBeNull();
    });

    it('should manually enable gateway', () => {
      service.disableGateway('razorpay', 30);
      service.enableGateway('razorpay');

      expect(service.isGatewayHealthy('razorpay')).toBe(true);
    });
  });

  describe('resetAllStats', () => {
    it('should reset all gateway stats', () => {
      service.recordTransaction('razorpay', true);
      service.recordTransaction('razorpay', false);
      service.disableGateway('payu', 30);

      service.resetAllStats();

      const razorpayHealth = service.getGatewayHealth('razorpay');
      expect(razorpayHealth.totalRequests).toBe(0);
      expect(service.isGatewayHealthy('payu')).toBe(true);
    });
  });
});
