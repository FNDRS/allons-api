import { Module } from '@nestjs/common';
import { PaygateModule } from '../paygate/paygate.module';
import { PaygateWebhookController } from '../paygate/paygate.webhook.controller';
import { MeModule } from '../me/me.module';
import { PaymentOrdersRepository } from './payment-orders.repository';
import { MePaymentsController } from './me-payments.controller';
import { MePaymentsService } from './me-payments.service';

@Module({
  imports: [PaygateModule, MeModule],
  controllers: [MePaymentsController, PaygateWebhookController],
  providers: [PaymentOrdersRepository, MePaymentsService],
  exports: [PaymentOrdersRepository, MePaymentsService],
})
export class PaymentsModule {}
