import { Test, TestingModule } from '@nestjs/testing';
import { GatewayService } from './gateway.service';
import { GatewayHealthService } from './gateway-health.service';
import { GATEWAY_CONFIG } from './types/gateway.types';
import { getLoggerToken } from 'nestjs-pino';

describe('GatewayService', () => {
  let service: GatewayService;
  let healthService: GatewayHealthService;

  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GatewayService,
        GatewayHealthService,
        {
          provide: getLoggerToken(GatewayService.name),
          useValue: mockLogger,
        },
        {
          provide: getLoggerToken(GatewayHealthService.name),
          useValue: mockLogger,
        },
      ],
    }).compile();

    service = module.get<GatewayService>(GatewayService);
    healthService = module.get<GatewayHealthService>(GatewayHealthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    healthService.resetAllStats();
  });

  describe('selectGateway', () => {
    it('should select a gateway from configured gateways', () => {
      const result = service.selectGateway();

      expect(result.gateway).toBeDefined();
      expect(GATEWAY_CONFIG.map(g => g.name)).toContain(result.gateway);
      expect(result.reason).toBeDefined();
    });

    it('should respect weighted distribution over many selections', () => {
      const selections: Record<string, number> = {};
      const iterations = 1000;

      for (let i = 0; i < iterations; i++) {
        const result = service.selectGateway();
        selections[result.gateway] = (selections[result.gateway] || 0) + 1;
      }

      // Razorpay (50%), PayU (30%), Cashfree (20%)
      // Allow 10% tolerance for randomness
      const razorpayRatio = selections['razorpay'] / iterations;
      const payuRatio = selections['payu'] / iterations;
      const cashfreeRatio = selections['cashfree'] / iterations;

      expect(razorpayRatio).toBeGreaterThan(0.4);
      expect(razorpayRatio).toBeLessThan(0.6);
      expect(payuRatio).toBeGreaterThan(0.2);
      expect(payuRatio).toBeLessThan(0.4);
      expect(cashfreeRatio).toBeGreaterThan(0.1);
      expect(cashfreeRatio).toBeLessThan(0.3);
    });

    it('should exclude unhealthy gateways from selection', () => {
      // Disable razorpay
      healthService.disableGateway('razorpay', 30);

      const selections: Record<string, number> = {};
      const iterations = 100;

      for (let i = 0; i < iterations; i++) {
        const result = service.selectGateway();
        selections[result.gateway] = (selections[result.gateway] || 0) + 1;
      }

      expect(selections['razorpay']).toBeUndefined();
      expect(selections['payu']).toBeGreaterThan(0);
      expect(selections['cashfree']).toBeGreaterThan(0);
    });

    it('should throw error when no healthy gateways available', () => {
      // Disable all gateways
      GATEWAY_CONFIG.forEach(g => healthService.disableGateway(g.name, 30));

      expect(() => service.selectGateway()).toThrow('No healthy payment gateways available');
    });
  });

  describe('getAllGateways', () => {
    it('should return all configured gateways', () => {
      const gateways = service.getAllGateways();

      expect(gateways).toHaveLength(GATEWAY_CONFIG.length);
      expect(gateways.map(g => g.name)).toEqual(['razorpay', 'payu', 'cashfree']);
    });
  });

  describe('isValidGateway', () => {
    it('should return true for valid gateway names', () => {
      expect(service.isValidGateway('razorpay')).toBe(true);
      expect(service.isValidGateway('payu')).toBe(true);
      expect(service.isValidGateway('cashfree')).toBe(true);
    });

    it('should return false for invalid gateway names', () => {
      expect(service.isValidGateway('invalid')).toBe(false);
      expect(service.isValidGateway('')).toBe(false);
    });
  });

  describe('recordTransactionResult', () => {
    it('should record success transactions', () => {
      service.recordTransactionResult('razorpay', true);

      const health = healthService.getGatewayHealth('razorpay');
      expect(health.totalRequests).toBe(1);
      expect(health.successCount).toBe(1);
      expect(health.failureCount).toBe(0);
    });

    it('should record failure transactions', () => {
      service.recordTransactionResult('razorpay', false);

      const health = healthService.getGatewayHealth('razorpay');
      expect(health.totalRequests).toBe(1);
      expect(health.failureCount).toBe(1);
    });
  });
});
