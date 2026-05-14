import { Module } from '@nestjs/common';
import { PaymentOrdersRepository } from './payment-orders.repository';

@Module({
  providers: [PaymentOrdersRepository],
  exports: [PaymentOrdersRepository],
})
export class PaymentsModule {}
