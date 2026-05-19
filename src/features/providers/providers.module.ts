import { Module } from '@nestjs/common';
import { ProviderPrivateController } from './provider-private.controller';
import { ProvidersController } from './providers.controller';
import { ProvidersService } from './providers.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [ProvidersController, ProviderPrivateController],
  providers: [ProvidersService],
  exports: [ProvidersService],
})
export class ProvidersModule {}
