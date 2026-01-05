import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  GatewayStats,
  GatewayHealth,
  GATEWAY_CONFIG,
  HEALTH_CHECK_WINDOW_MINUTES,
  UNHEALTHY_COOLDOWN_MINUTES,
  SUCCESS_RATE_THRESHOLD,
  MIN_REQUESTS_FOR_HEALTH_CHECK,
} from './types/gateway.types';

interface TransactionRecord {
  timestamp: Date;
  success: boolean;
}

@Injectable()
export class GatewayHealthService {
  private gatewayTransactions: Map<string, TransactionRecord[]> = new Map();
  private disabledGateways: Map<string, Date> = new Map();

  constructor(
    @InjectPinoLogger(GatewayHealthService.name)
    private readonly logger: PinoLogger,
  ) {
    GATEWAY_CONFIG.forEach(gateway => {
      this.gatewayTransactions.set(gateway.name, []);
    });
  }

  recordTransaction(gateway: string, success: boolean): void {
    const transactions = this.gatewayTransactions.get(gateway) || [];
    transactions.push({
      timestamp: new Date(),
      success,
    });
    this.gatewayTransactions.set(gateway, transactions);

    this.logger.info(
      { gateway, success, totalRecords: transactions.length },
      `Recorded transaction for gateway`,
    );

    if (!success) {
      this.checkAndUpdateHealth(gateway);
    }
  }

  isGatewayHealthy(gateway: string): boolean {
    const disabledUntil = this.disabledGateways.get(gateway);

    if (disabledUntil) {
      if (new Date() > disabledUntil) {
        this.disabledGateways.delete(gateway);
        this.logger.info({ gateway }, `Gateway re-enabled after cooldown period`);
        return true;
      }
      return false;
    }

    return true;
  }

  getHealthyGateways(): string[] {
    return GATEWAY_CONFIG.filter(
      config => config.enabled && this.isGatewayHealthy(config.name),
    ).map(config => config.name);
  }

  getAllGatewayHealth(): GatewayHealth[] {
    return GATEWAY_CONFIG.map(config => this.getGatewayHealth(config.name));
  }

  getGatewayHealth(gateway: string): GatewayHealth {
    const stats = this.getGatewayStats(gateway);
    const disabledUntil = this.disabledGateways.get(gateway) || null;
    const isHealthy = this.isGatewayHealthy(gateway);

    return {
      name: gateway,
      isHealthy,
      successRate: stats.totalRequests > 0 ? stats.successCount / stats.totalRequests : 1,
      totalRequests: stats.totalRequests,
      successCount: stats.successCount,
      failureCount: stats.failureCount,
      disabledUntil,
    };
  }

  private getGatewayStats(gateway: string): GatewayStats {
    const transactions = this.gatewayTransactions.get(gateway) || [];
    const windowStart = new Date(Date.now() - HEALTH_CHECK_WINDOW_MINUTES * 60 * 1000);

    const windowTransactions = transactions.filter(t => t.timestamp >= windowStart);

    const successCount = windowTransactions.filter(t => t.success).length;
    const failureCount = windowTransactions.filter(t => !t.success).length;
    const lastFailure = windowTransactions
      .filter(t => !t.success)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];

    return {
      totalRequests: windowTransactions.length,
      successCount,
      failureCount,
      lastFailureTime: lastFailure?.timestamp || null,
      windowStartTime: windowStart,
    };
  }

  private checkAndUpdateHealth(gateway: string): void {
    const stats = this.getGatewayStats(gateway);

    /*
     * HEALTH CHECK & AUTO-DISABLE LOGIC
     *
     * I'm implementing a circuit-breaker pattern here to protect our system from
     * routing traffic to failing gateways. Here's my thought process:
     *
     * 1. I only trigger health evaluation after a minimum number of requests
     *    (MIN_REQUESTS_FOR_HEALTH_CHECK). This prevents a single failure from
     *    disabling a gateway. For example, 1 failure out of 2 requests is 50%
     *    but that's too small a sample to make decisions.
     *
     * 2. I calculate success rate over a sliding window (last 15 minutes by default).
     *    This means old failures don't permanently affect the gateway's reputation.
     *    The gateway gets a fresh start as old transactions fall out of the window.
     *
     * 3. If success rate drops below threshold (90% by default), I disable the
     *    gateway for a cooldown period (30 minutes). During this time, no traffic
     *    goes to this gateway, giving it time to recover.
     *
     * 4. After cooldown expires, the gateway automatically re-enters the pool.
     *    I chose this approach over manual intervention because payment gateway
     *    issues are often transient (network blips, rate limits, etc).
     */
    if (stats.totalRequests < MIN_REQUESTS_FOR_HEALTH_CHECK) {
      this.logger.debug(
        { gateway, totalRequests: stats.totalRequests, minRequired: MIN_REQUESTS_FOR_HEALTH_CHECK },
        `Not enough requests for health check`,
      );
      return;
    }

    const successRate = stats.successCount / stats.totalRequests;

    if (successRate < SUCCESS_RATE_THRESHOLD) {
      const disabledUntil = new Date(Date.now() + UNHEALTHY_COOLDOWN_MINUTES * 60 * 1000);
      this.disabledGateways.set(gateway, disabledUntil);

      this.logger.warn(
        {
          gateway,
          successRate: (successRate * 100).toFixed(2) + '%',
          threshold: SUCCESS_RATE_THRESHOLD * 100 + '%',
          disabledUntil: disabledUntil.toISOString(),
          stats,
        },
        `Gateway disabled due to low success rate`,
      );
    }
  }

  cleanupOldRecords(): void {
    const cutoffTime = new Date(Date.now() - HEALTH_CHECK_WINDOW_MINUTES * 2 * 60 * 1000);

    this.gatewayTransactions.forEach((transactions, gateway) => {
      const filtered = transactions.filter(t => t.timestamp >= cutoffTime);
      this.gatewayTransactions.set(gateway, filtered);
    });
  }

  disableGateway(gateway: string, minutes: number = UNHEALTHY_COOLDOWN_MINUTES): void {
    const disabledUntil = new Date(Date.now() + minutes * 60 * 1000);
    this.disabledGateways.set(gateway, disabledUntil);
    this.logger.info(
      { gateway, disabledUntil: disabledUntil.toISOString() },
      `Gateway manually disabled`,
    );
  }

  enableGateway(gateway: string): void {
    this.disabledGateways.delete(gateway);
    this.logger.info({ gateway }, `Gateway manually enabled`);
  }

  resetAllStats(): void {
    GATEWAY_CONFIG.forEach(gateway => {
      this.gatewayTransactions.set(gateway.name, []);
    });
    this.disabledGateways.clear();
    this.logger.info('All gateway stats reset');
  }
}
