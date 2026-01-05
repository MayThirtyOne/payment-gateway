import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get()
  getRoot() {
    return {
      name: 'Payment Gateway Router',
      version: '1.0.0',
      description: 'Dynamic Payment Gateway Routing Service',
      endpoints: {
        initiate: 'POST /transactions/initiate',
        callback: 'POST /transactions/callback',
        gateways: 'GET /gateways',
        health: 'GET /health',
      },
    };
  }

  @Get('health')
  healthCheck() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB',
      },
    };
  }
}
