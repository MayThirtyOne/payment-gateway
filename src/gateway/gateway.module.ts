import { Module } from '@nestjs/common';
import { GatewayService } from './gateway.service';
import { GatewayHealthService } from './gateway-health.service';
import { GatewayController } from './gateway.controller';

@Module({
  controllers: [GatewayController],
  providers: [GatewayService, GatewayHealthService],
  exports: [GatewayService, GatewayHealthService],
})
export class GatewayModule {}
