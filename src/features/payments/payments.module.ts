import { Module } from '@nestjs/common';
import { MeModule } from '../me/me.module';
import { PaygateModule } from '../paygate/paygate.module';
import { PaygateWebhookController } from '../paygate/paygate.webhook.controller';
import { ProvidersModule } from '../providers/providers.module';
import { MePaymentsController } from './me-payments.controller';
import { MePaymentsService } from './me-payments.service';
import { PaymentOrdersRepository } from './payment-orders.repository';
import { ProviderPaymentsController } from './provider-payments.controller';
import { ProviderPaymentsService } from './provider-payments.service';

@Module({
  imports: [PaygateModule, MeModule, ProvidersModule],
  controllers: [
    MePaymentsController,
    PaygateWebhookController,
    ProviderPaymentsController,
  ],
  providers: [
    PaymentOrdersRepository,
    MePaymentsService,
    ProviderPaymentsService,
  ],
  exports: [PaymentOrdersRepository, MePaymentsService],
})
export class PaymentsModule {}
