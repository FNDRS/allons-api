import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { SharedModule } from './shared/shared.module';
import { HealthModule } from './features/health/health.module';
import { ProvidersModule } from './features/providers/providers.module';
import { EventsModule } from './features/events/events.module';
import { AccountModule } from './features/account/account.module';
import { InterestsModule } from './features/interests/interests.module';
import { FriendsModule } from './features/friends/friends.module';
import { ConversationsModule } from './features/conversations/conversations.module';
import { MeModule } from './features/me/me.module';
import { AdminModule } from './features/admin/admin.module';
import { PaygateModule } from './features/paygate/paygate.module';
import { PaymentsModule } from './features/payments/payments.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AllonsThrottlerGuard } from './shared/rate-limit/allons-throttler.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot({
      throttlers: [
        // Baseline protection for the whole API.
        { name: 'default', ttl: 60, limit: 200 },
        // Sensitive routes get stricter limits via @Throttle.
        { name: 'payment-initiate', ttl: 60, limit: 10 },
        { name: 'paygate-webhook', ttl: 60, limit: 600 },
      ],
    }),
    PrismaModule,
    SharedModule,
    HealthModule,
    ProvidersModule,
    EventsModule,
    AccountModule,
    InterestsModule,
    FriendsModule,
    ConversationsModule,
    MeModule,
    AdminModule,
    PaygateModule,
    PaymentsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: AllonsThrottlerGuard,
    },
  ],
})
export class AppModule {}
