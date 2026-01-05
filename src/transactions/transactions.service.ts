import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { GatewayService } from '../gateway/gateway.service';
import { Transaction, TransactionStatus, PaymentInstrument } from './types/transaction.types';
import { InitiateTransactionDto } from './dto/initiate-transaction.dto';
import { CallbackDto, CallbackStatus } from './dto/callback.dto';

@Injectable()
export class TransactionsService {
  private transactions: Map<string, Transaction> = new Map();
  private orderToTransaction: Map<string, string> = new Map();

  constructor(
    private readonly gatewayService: GatewayService,
    @InjectPinoLogger(TransactionsService.name)
    private readonly logger: PinoLogger,
  ) {}

  async initiateTransaction(dto: InitiateTransactionDto): Promise<Transaction> {
    /*
     * DUPLICATE ORDER PREVENTION
     *
     * I'm checking for existing pending transactions for this order_id to prevent
     * double-charging scenarios. This is critical for payment systems because:
     *
     * 1. A user might accidentally click "Pay" twice, or their browser might
     *    retry a failed request. Without this check, we'd create multiple
     *    payment attempts for the same order.
     *
     * 2. I only block if the existing transaction is PENDING. If a previous
     *    transaction failed, I allow a retry with a fresh gateway selection
     *    (not implemented here, but the logic supports it).
     *
     * 3. The error message guides the user to use the callback endpoint instead,
     *    which is the proper way to update an existing transaction's status.
     */
    if (this.orderToTransaction.has(dto.order_id)) {
      const existingTxnId = this.orderToTransaction.get(dto.order_id)!;
      const existingTxn = this.transactions.get(existingTxnId);

      if (existingTxn && existingTxn.status === TransactionStatus.PENDING) {
        this.logger.warn(
          { orderId: dto.order_id, transactionId: existingTxnId },
          'Transaction already exists for this order',
        );
        throw new BadRequestException(
          `Transaction already initiated for order ${dto.order_id}. Use callback to update status.`,
        );
      }
    }

    const gatewaySelection = this.gatewayService.selectGateway();
    const transactionId = crypto.randomUUID();
    const now = new Date();

    const transaction: Transaction = {
      id: transactionId,
      order_id: dto.order_id,
      amount: dto.amount,
      currency: dto.currency || 'INR',
      status: TransactionStatus.PENDING,
      gateway: gatewaySelection.gateway,
      gateway_selection_reason: gatewaySelection.reason,
      payment_instrument: this.sanitizePaymentInstrument(dto.payment_instrument),
      created_at: now,
      updated_at: now,
    };

    this.transactions.set(transactionId, transaction);
    this.orderToTransaction.set(dto.order_id, transactionId);

    this.logger.info(
      {
        transactionId,
        orderId: dto.order_id,
        gateway: gatewaySelection.gateway,
        amount: dto.amount,
        reason: gatewaySelection.reason,
      },
      'Transaction initiated successfully',
    );

    return transaction;
  }

  async processCallback(dto: CallbackDto): Promise<Transaction> {
    const transactionId = this.orderToTransaction.get(dto.order_id);

    if (!transactionId) {
      this.logger.error({ orderId: dto.order_id }, 'Transaction not found for callback');
      throw new NotFoundException(`Transaction not found for order ${dto.order_id}`);
    }

    const transaction = this.transactions.get(transactionId);

    if (!transaction) {
      throw new NotFoundException(`Transaction ${transactionId} not found`);
    }

    /*
     * GATEWAY MISMATCH VALIDATION
     *
     * I'm validating that the callback comes from the same gateway we routed to.
     * This is a security measure to prevent:
     *
     * 1. Spoofed callbacks - someone trying to mark a transaction as successful
     *    by sending a fake callback with a different gateway name.
     *
     * 2. Misconfigured webhooks - if a merchant accidentally configures webhooks
     *    from multiple gateways to the same endpoint, this catches it.
     *
     * In production, I'd also verify webhook signatures, but for this implementation
     * the gateway name check provides basic validation.
     */
    if (transaction.gateway !== dto.gateway) {
      this.logger.warn(
        {
          orderId: dto.order_id,
          expectedGateway: transaction.gateway,
          receivedGateway: dto.gateway,
        },
        'Gateway mismatch in callback',
      );
      throw new BadRequestException(
        `Gateway mismatch. Expected: ${transaction.gateway}, Received: ${dto.gateway}`,
      );
    }

    if (transaction.status !== TransactionStatus.PENDING) {
      this.logger.warn(
        { orderId: dto.order_id, currentStatus: transaction.status },
        'Transaction already processed',
      );
      throw new BadRequestException(
        `Transaction already processed with status: ${transaction.status}`,
      );
    }

    const isSuccess = dto.status === CallbackStatus.SUCCESS;
    transaction.status = isSuccess ? TransactionStatus.SUCCESS : TransactionStatus.FAILURE;
    transaction.updated_at = new Date();

    if (!isSuccess && dto.reason) {
      transaction.failure_reason = dto.reason;
    }

    /*
     * FEEDING HEALTH METRICS
     *
     * I'm recording every callback result to the gateway health service because
     * this is how the system learns which gateways are performing well.
     *
     * This creates a feedback loop:
     * Transaction → Gateway → Callback → Health Update → Future Routing Decisions
     *
     * By recording both successes and failures, I build an accurate picture of
     * each gateway's real-world performance, not just failure counts.
     */
    this.gatewayService.recordTransactionResult(dto.gateway, isSuccess);

    this.logger.info(
      {
        transactionId,
        orderId: dto.order_id,
        gateway: dto.gateway,
        status: transaction.status,
        reason: dto.reason,
      },
      'Transaction callback processed',
    );

    return transaction;
  }

  getTransaction(transactionId: string): Transaction {
    const transaction = this.transactions.get(transactionId);

    if (!transaction) {
      throw new NotFoundException(`Transaction ${transactionId} not found`);
    }

    return transaction;
  }

  getTransactionByOrderId(orderId: string): Transaction {
    const transactionId = this.orderToTransaction.get(orderId);

    if (!transactionId) {
      throw new NotFoundException(`Transaction not found for order ${orderId}`);
    }

    return this.getTransaction(transactionId);
  }

  getAllTransactions(): Transaction[] {
    return Array.from(this.transactions.values()).sort(
      (a, b) => b.created_at.getTime() - a.created_at.getTime(),
    );
  }

  getStats() {
    const transactions = this.getAllTransactions();

    const stats = {
      total: transactions.length,
      pending: transactions.filter(t => t.status === TransactionStatus.PENDING).length,
      success: transactions.filter(t => t.status === TransactionStatus.SUCCESS).length,
      failure: transactions.filter(t => t.status === TransactionStatus.FAILURE).length,
      byGateway: {} as Record<string, { total: number; success: number; failure: number }>,
    };

    transactions.forEach(t => {
      if (!stats.byGateway[t.gateway]) {
        stats.byGateway[t.gateway] = { total: 0, success: 0, failure: 0 };
      }
      stats.byGateway[t.gateway].total++;
      if (t.status === TransactionStatus.SUCCESS) {
        stats.byGateway[t.gateway].success++;
      } else if (t.status === TransactionStatus.FAILURE) {
        stats.byGateway[t.gateway].failure++;
      }
    });

    return stats;
  }

  clearTransactions(): void {
    this.transactions.clear();
    this.orderToTransaction.clear();
    this.logger.info('All transactions cleared');
  }

  /*
   * PII DATA SANITIZATION
   *
   * I'm masking sensitive payment data before storing because even though
   * this is in-memory storage, I want to follow PCI-DSS best practices:
   *
   * 1. Card numbers are masked to show only last 4 digits - this allows
   *    customer support to identify cards without exposing full numbers.
   *
   * 2. CVV is completely removed - there's never a legitimate reason to
   *    store CVV after the initial authorization.
   *
   * This ensures that even if someone dumps the in-memory data, they
   * can't extract usable card information.
   */
  private sanitizePaymentInstrument(instrument: PaymentInstrument): PaymentInstrument {
    const sanitized = { ...instrument };

    if (sanitized.card_number) {
      sanitized.card_number = '****' + sanitized.card_number.slice(-4);
    }

    delete sanitized.cvv;

    return sanitized;
  }
}
