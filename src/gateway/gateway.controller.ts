import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { GatewayService } from './gateway.service';
import { GatewayHealthService } from './gateway-health.service';

@Controller('gateways')
export class GatewayController {
  constructor(
    private readonly gatewayService: GatewayService,
    private readonly healthService: GatewayHealthService,
  ) {}

  @Get()
  getAllGateways() {
    const configs = this.gatewayService.getAllGateways();
    const health = this.healthService.getAllGatewayHealth();

    return {
      gateways: configs.map(config => {
        const gatewayHealth = health.find(h => h.name === config.name);
        return {
          ...config,
          health: gatewayHealth,
        };
      }),
    };
  }

  @Get(':name/health')
  getGatewayHealth(@Param('name') name: string) {
    return this.healthService.getGatewayHealth(name);
  }

  @Post(':name/disable')
  disableGateway(@Param('name') name: string, @Body() body: { minutes?: number }) {
    this.healthService.disableGateway(name, body.minutes);
    return {
      success: true,
      message: `Gateway ${name} has been disabled`,
      health: this.healthService.getGatewayHealth(name),
    };
  }

  @Post(':name/enable')
  enableGateway(@Param('name') name: string) {
    this.healthService.enableGateway(name);
    return {
      success: true,
      message: `Gateway ${name} has been enabled`,
      health: this.healthService.getGatewayHealth(name),
    };
  }

  @Post('reset')
  resetStats() {
    this.healthService.resetAllStats();
    return {
      success: true,
      message: 'All gateway stats have been reset',
    };
  }
}
