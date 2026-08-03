import { Module } from '@nestjs/common';
import { ProviderPrivateController } from './provider-private.controller';
import { ProvidersController } from './providers.controller';
import { AdminPayoutsController } from './admin-payouts.controller';
import { ProvidersService } from './providers.service';
import { PublicProvidersService } from './public-providers.service';
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
  providers: [ProvidersService, PublicProvidersService, AdminSecretGuard],
  exports: [ProvidersService],
})
export class ProvidersModule {}
