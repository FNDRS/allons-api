import { Module } from '@nestjs/common';
import { AdminSecretGuard } from '../admin/admin-secret.guard';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaygateModule } from '../paygate/paygate.module';
import { BlocklistAdminController } from './blocklist-admin.controller';
import { RenewalReminderService } from './renewal-reminder.service';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionOrdersAdminController } from './subscription-orders-admin.controller';
import { SubscriptionService } from './subscription.service';

@Module({
  imports: [PaygateModule, NotificationsModule],
  controllers: [
    SubscriptionController,
    SubscriptionOrdersAdminController,
    BlocklistAdminController,
  ],
  providers: [SubscriptionService, RenewalReminderService, AdminSecretGuard],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
