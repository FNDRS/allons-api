import { Module } from '@nestjs/common';
import { ProviderPrivateController } from './provider-private.controller';
import { ProvidersController } from './providers.controller';
import { AdminPayoutsController } from './admin-payouts.controller';
import { ProvidersService } from './providers.service';
import { AdminSecretGuard } from '../admin/admin-secret.guard';
import { NotificationsModule } from '../notifications/notifications.module';
import { SubscriptionModule } from '../subscription/subscription.module';

@Module({
  imports: [NotificationsModule, SubscriptionModule],
  controllers: [
    ProvidersController,
    ProviderPrivateController,
    AdminPayoutsController,
  ],
  providers: [ProvidersService, AdminSecretGuard],
  exports: [ProvidersService],
})
export class ProvidersModule {}
