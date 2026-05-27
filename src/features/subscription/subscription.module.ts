import { Module } from '@nestjs/common';
import { AdminSecretGuard } from '../admin/admin-secret.guard';
import { PaygateModule } from '../paygate/paygate.module';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionOrdersAdminController } from './subscription-orders-admin.controller';
import { SubscriptionService } from './subscription.service';

@Module({
  imports: [PaygateModule],
  controllers: [SubscriptionController, SubscriptionOrdersAdminController],
  providers: [SubscriptionService, AdminSecretGuard],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
