import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { GatewayModule } from './gateway/gateway.module';
import { TransactionsModule } from './transactions/transactions.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV !== 'production'
            ? {
                target: 'pino-pretty',
                options: {
                  colorize: true,
                  singleLine: true,
                  levelFirst: true,
                  translateTime: 'SYS:standard',
                },
              }
            : undefined,
        level: process.env.LOG_LEVEL || 'info',
        autoLogging: true,
        redact: ['req.headers.authorization', 'req.body.payment_instrument.card_number'],
      },
    }),
    GatewayModule,
    TransactionsModule,
    HealthModule,
  ],
})
export class AppModule {}
