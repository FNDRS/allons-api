import { Module } from '@nestjs/common';
import { MeModule } from '../me/me.module';
import { PaygateModule } from '../paygate/paygate.module';
import { PaygateWebhookController } from '../paygate/paygate.webhook.controller';
import { ProvidersModule } from '../providers/providers.module';
import { AdminPaymentsController } from './admin-payments.controller';
import { MePaymentsController } from './me-payments.controller';
import { MePaymentsService } from './me-payments.service';
import { PaymentOrdersRepository } from './payment-orders.repository';
import { PaymentsReconciliationService } from './payments-reconciliation.service';
import { ProviderPaymentsController } from './provider-payments.controller';
import { ProviderPaymentsService } from './provider-payments.service';
import { RefundsRepository } from './refunds.repository';

@Module({
  imports: [PaygateModule, MeModule, ProvidersModule],
  controllers: [
    MePaymentsController,
    PaygateWebhookController,
    ProviderPaymentsController,
    AdminPaymentsController,
  ],
  providers: [
    PaymentOrdersRepository,
    MePaymentsService,
    ProviderPaymentsService,
    PaymentsReconciliationService,
    RefundsRepository,
  ],
  exports: [
    PaymentOrdersRepository,
    MePaymentsService,
    PaymentsReconciliationService,
    RefundsRepository,
  ],
})
export class PaymentsModule {}
