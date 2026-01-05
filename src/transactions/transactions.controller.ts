import { Controller, Post, Get, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { InitiateTransactionDto } from './dto/initiate-transaction.dto';
import { CallbackDto } from './dto/callback.dto';

@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post('initiate')
  @HttpCode(HttpStatus.CREATED)
  async initiateTransaction(@Body() dto: InitiateTransactionDto) {
    const transaction = await this.transactionsService.initiateTransaction(dto);

    return {
      success: true,
      message: 'Transaction initiated successfully',
      data: {
        transaction_id: transaction.id,
        order_id: transaction.order_id,
        amount: transaction.amount,
        currency: transaction.currency,
        status: transaction.status,
        gateway: transaction.gateway,
        gateway_selection_reason: transaction.gateway_selection_reason,
        created_at: transaction.created_at,
      },
    };
  }

  @Post('callback')
  @HttpCode(HttpStatus.OK)
  async handleCallback(@Body() dto: CallbackDto) {
    const transaction = await this.transactionsService.processCallback(dto);

    return {
      success: true,
      message: `Transaction ${dto.status === 'success' ? 'completed' : 'failed'}`,
      data: {
        transaction_id: transaction.id,
        order_id: transaction.order_id,
        status: transaction.status,
        gateway: transaction.gateway,
        failure_reason: transaction.failure_reason,
        updated_at: transaction.updated_at,
      },
    };
  }

  @Get('stats/summary')
  getStats() {
    const stats = this.transactionsService.getStats();
    return {
      success: true,
      data: stats,
    };
  }

  @Get('order/:orderId')
  getTransactionByOrderId(@Param('orderId') orderId: string) {
    const transaction = this.transactionsService.getTransactionByOrderId(orderId);
    return {
      success: true,
      data: transaction,
    };
  }

  @Get(':id')
  getTransaction(@Param('id') id: string) {
    const transaction = this.transactionsService.getTransaction(id);
    return {
      success: true,
      data: transaction,
    };
  }

  @Get()
  getAllTransactions() {
    const transactions = this.transactionsService.getAllTransactions();
    return {
      success: true,
      count: transactions.length,
      data: transactions,
    };
  }

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  resetTransactions() {
    this.transactionsService.clearTransactions();
    return {
      success: true,
      message: 'All transactions have been cleared',
    };
  }
}
