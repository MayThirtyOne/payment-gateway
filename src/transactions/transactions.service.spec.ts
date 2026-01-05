import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { GatewayService } from '../gateway/gateway.service';
import { GatewayHealthService } from '../gateway/gateway-health.service';
import { PaymentInstrumentType, TransactionStatus } from './types/transaction.types';
import { CallbackStatus } from './dto/callback.dto';
import { getLoggerToken } from 'nestjs-pino';

describe('TransactionsService', () => {
  let service: TransactionsService;
  let healthService: GatewayHealthService;

  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  const validTransactionDto = {
    order_id: 'ORD123',
    amount: 499.0,
    payment_instrument: {
      type: PaymentInstrumentType.CARD,
      card_number: '4111111111111111',
      expiry: '12/25',
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        GatewayService,
        GatewayHealthService,
        {
          provide: getLoggerToken(TransactionsService.name),
          useValue: mockLogger,
        },
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

    service = module.get<TransactionsService>(TransactionsService);
    healthService = module.get<GatewayHealthService>(GatewayHealthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    service.clearTransactions();
    healthService.resetAllStats();
  });

  describe('initiateTransaction', () => {
    it('should create a new transaction with pending status', async () => {
      const result = await service.initiateTransaction(validTransactionDto);

      expect(result.id).toBeDefined();
      expect(result.order_id).toBe('ORD123');
      expect(result.amount).toBe(499.0);
      expect(result.status).toBe(TransactionStatus.PENDING);
      expect(result.gateway).toBeDefined();
      expect(result.gateway_selection_reason).toBeDefined();
    });

    it('should mask card number in stored transaction', async () => {
      const result = await service.initiateTransaction(validTransactionDto);

      expect(result.payment_instrument.card_number).toBe('****1111');
    });

    it('should remove CVV from stored transaction', async () => {
      const dtoWithCvv = {
        ...validTransactionDto,
        payment_instrument: {
          ...validTransactionDto.payment_instrument,
          cvv: '123',
        },
      };

      const result = await service.initiateTransaction(dtoWithCvv);

      expect(result.payment_instrument.cvv).toBeUndefined();
    });

    it('should reject duplicate order_id for pending transaction', async () => {
      await service.initiateTransaction(validTransactionDto);

      await expect(service.initiateTransaction({ ...validTransactionDto })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should use default currency INR if not provided', async () => {
      const result = await service.initiateTransaction(validTransactionDto);
      expect(result.currency).toBe('INR');
    });

    it('should use provided currency', async () => {
      const result = await service.initiateTransaction({
        ...validTransactionDto,
        currency: 'USD',
      });
      expect(result.currency).toBe('USD');
    });
  });

  describe('processCallback', () => {
    it('should update transaction to success', async () => {
      const transaction = await service.initiateTransaction(validTransactionDto);

      const result = await service.processCallback({
        order_id: 'ORD123',
        status: CallbackStatus.SUCCESS,
        gateway: transaction.gateway,
      });

      expect(result.status).toBe(TransactionStatus.SUCCESS);
    });

    it('should update transaction to failure with reason', async () => {
      const transaction = await service.initiateTransaction(validTransactionDto);

      const result = await service.processCallback({
        order_id: 'ORD123',
        status: CallbackStatus.FAILURE,
        gateway: transaction.gateway,
        reason: 'Customer Cancelled',
      });

      expect(result.status).toBe(TransactionStatus.FAILURE);
      expect(result.failure_reason).toBe('Customer Cancelled');
    });

    it('should throw NotFound for unknown order', async () => {
      await expect(
        service.processCallback({
          order_id: 'UNKNOWN',
          status: CallbackStatus.SUCCESS,
          gateway: 'razorpay',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequest for gateway mismatch', async () => {
      const transaction = await service.initiateTransaction(validTransactionDto);
      const differentGateway = transaction.gateway === 'razorpay' ? 'payu' : 'razorpay';

      await expect(
        service.processCallback({
          order_id: 'ORD123',
          status: CallbackStatus.SUCCESS,
          gateway: differentGateway,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequest for already processed transaction', async () => {
      const transaction = await service.initiateTransaction(validTransactionDto);

      await service.processCallback({
        order_id: 'ORD123',
        status: CallbackStatus.SUCCESS,
        gateway: transaction.gateway,
      });

      await expect(
        service.processCallback({
          order_id: 'ORD123',
          status: CallbackStatus.FAILURE,
          gateway: transaction.gateway,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should record gateway stats for success', async () => {
      const transaction = await service.initiateTransaction(validTransactionDto);

      await service.processCallback({
        order_id: 'ORD123',
        status: CallbackStatus.SUCCESS,
        gateway: transaction.gateway,
      });

      const health = healthService.getGatewayHealth(transaction.gateway);
      expect(health.successCount).toBe(1);
    });

    it('should record gateway stats for failure', async () => {
      const transaction = await service.initiateTransaction(validTransactionDto);

      await service.processCallback({
        order_id: 'ORD123',
        status: CallbackStatus.FAILURE,
        gateway: transaction.gateway,
      });

      const health = healthService.getGatewayHealth(transaction.gateway);
      expect(health.failureCount).toBe(1);
    });
  });

  describe('getTransaction', () => {
    it('should return transaction by ID', async () => {
      const created = await service.initiateTransaction(validTransactionDto);
      const result = service.getTransaction(created.id);

      expect(result.id).toBe(created.id);
    });

    it('should throw NotFound for unknown ID', () => {
      expect(() => service.getTransaction('unknown-id')).toThrow(NotFoundException);
    });
  });

  describe('getTransactionByOrderId', () => {
    it('should return transaction by order ID', async () => {
      await service.initiateTransaction(validTransactionDto);
      const result = service.getTransactionByOrderId('ORD123');

      expect(result.order_id).toBe('ORD123');
    });

    it('should throw NotFound for unknown order ID', () => {
      expect(() => service.getTransactionByOrderId('UNKNOWN')).toThrow(NotFoundException);
    });
  });

  describe('getAllTransactions', () => {
    it('should return all transactions sorted by created_at descending', async () => {
      await service.initiateTransaction({ ...validTransactionDto, order_id: 'ORD1' });
      await service.initiateTransaction({ ...validTransactionDto, order_id: 'ORD2' });
      await service.initiateTransaction({ ...validTransactionDto, order_id: 'ORD3' });

      const all = service.getAllTransactions();

      expect(all).toHaveLength(3);
      expect(all[0].order_id).toBe('ORD1');
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', async () => {
      const txn1 = await service.initiateTransaction({ ...validTransactionDto, order_id: 'ORD1' });
      const txn2 = await service.initiateTransaction({ ...validTransactionDto, order_id: 'ORD2' });
      await service.initiateTransaction({ ...validTransactionDto, order_id: 'ORD3' });

      await service.processCallback({
        order_id: 'ORD1',
        status: CallbackStatus.SUCCESS,
        gateway: txn1.gateway,
      });

      await service.processCallback({
        order_id: 'ORD2',
        status: CallbackStatus.FAILURE,
        gateway: txn2.gateway,
        reason: 'Test failure',
      });

      const stats = service.getStats();

      expect(stats.total).toBe(3);
      expect(stats.pending).toBe(1);
      expect(stats.success).toBe(1);
      expect(stats.failure).toBe(1);
    });
  });

  describe('clearTransactions', () => {
    it('should clear all transactions', async () => {
      await service.initiateTransaction(validTransactionDto);

      service.clearTransactions();

      expect(service.getAllTransactions()).toHaveLength(0);
    });
  });
});
