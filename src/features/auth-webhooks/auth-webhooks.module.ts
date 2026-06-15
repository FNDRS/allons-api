import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SharedModule } from '../../shared/shared.module';
import { AuthWebhooksController } from './auth-webhooks.controller';
import { AuthWebhookJwtGuard } from './auth-webhooks.guard';
import { AuthWebhooksService } from './auth-webhooks.service';

@Module({
  imports: [SharedModule, PrismaModule],
  controllers: [AuthWebhooksController],
  providers: [AuthWebhooksService, AuthWebhookJwtGuard],
})
export class AuthWebhooksModule {}
