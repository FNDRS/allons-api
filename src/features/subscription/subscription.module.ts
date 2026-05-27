import { Module } from '@nestjs/common';
import { AdminSecretGuard } from '../admin/admin-secret.guard';
import { PaygateModule } from '../paygate/paygate.module';
import { InvoiceAdminController } from './invoice-admin.controller';
import { InvoiceService } from './invoice.service';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';

@Module({
  imports: [PaygateModule],
  controllers: [SubscriptionController, InvoiceAdminController],
  providers: [SubscriptionService, InvoiceService, AdminSecretGuard],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
