import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { GatewayHealthService } from './gateway-health.service';
import { GatewayConfig, GatewaySelectionResult, GATEWAY_CONFIG } from './types/gateway.types';

@Injectable()
export class GatewayService {
  constructor(
    private readonly healthService: GatewayHealthService,
    @InjectPinoLogger(GatewayService.name)
    private readonly logger: PinoLogger,
  ) {}

  selectGateway(): GatewaySelectionResult {
    const healthyGateways = this.getHealthyGatewayConfigs();

    if (healthyGateways.length === 0) {
      this.logger.error('No healthy gateways available for routing');
      throw new Error('No healthy payment gateways available');
    }

    /*
     * WEIGHTED RANDOM SELECTION ALGORITHM
     *
     * I'm implementing a weighted random selection here because I need to distribute
     * traffic proportionally across gateways based on their configured weights.
     *
     * Here's my approach:
     * 1. I first calculate the total weight of all HEALTHY gateways only. This is
     *    important because if a gateway goes down, I want its share to be redistributed
     *    proportionally among the remaining gateways.
     *
     * 2. I generate a random number between 0 and totalWeight. Then I iterate through
     *    gateways, accumulating their weights. The gateway whose cumulative weight
     *    first exceeds the random number gets selected.
     *
     * Example: If Razorpay=50, PayU=30, Cashfree=20 (total=100)
     * - Random=25 → Razorpay (0-50 range)
     * - Random=60 → PayU (50-80 range)
     * - Random=90 → Cashfree (80-100 range)
     *
     * This ensures traffic distribution matches the weight percentages over time.
     */
    const totalWeight = healthyGateways.reduce((sum, g) => sum + g.weight, 0);
    const random = Math.random() * totalWeight;

    let cumulativeWeight = 0;
    let selectedGateway: GatewayConfig | null = null;

    for (const gateway of healthyGateways) {
      cumulativeWeight += gateway.weight;
      if (random <= cumulativeWeight) {
        selectedGateway = gateway;
        break;
      }
    }

    if (!selectedGateway) {
      selectedGateway = healthyGateways[0];
    }

    const reason = this.buildSelectionReason(selectedGateway, healthyGateways, totalWeight);

    this.logger.info(
      {
        selectedGateway: selectedGateway.name,
        healthyGateways: healthyGateways.map(g => g.name),
        effectiveWeight: ((selectedGateway.weight / totalWeight) * 100).toFixed(1) + '%',
      },
      `Gateway selected for transaction`,
    );

    return {
      gateway: selectedGateway.name,
      reason,
    };
  }

  getAllGateways(): GatewayConfig[] {
    return GATEWAY_CONFIG;
  }

  private getHealthyGatewayConfigs(): GatewayConfig[] {
    const healthyNames = this.healthService.getHealthyGateways();
    return GATEWAY_CONFIG.filter(config => healthyNames.includes(config.name));
  }

  private buildSelectionReason(
    selected: GatewayConfig,
    healthyGateways: GatewayConfig[],
    totalWeight: number,
  ): string {
    const allGateways = GATEWAY_CONFIG;
    const unhealthyGateways = allGateways.filter(
      g => !healthyGateways.some(hg => hg.name === g.name),
    );

    let reason = `Selected ${selected.name} via weighted routing (${((selected.weight / totalWeight) * 100).toFixed(1)}% effective probability)`;

    if (unhealthyGateways.length > 0) {
      reason += `. Excluded unhealthy gateways: ${unhealthyGateways.map(g => g.name).join(', ')}`;
    }

    return reason;
  }

  isValidGateway(gatewayName: string): boolean {
    return GATEWAY_CONFIG.some(g => g.name === gatewayName);
  }

  recordTransactionResult(gateway: string, success: boolean): void {
    this.healthService.recordTransaction(gateway, success);
  }
}
