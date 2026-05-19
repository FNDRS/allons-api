import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
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
  providers: [AppService],
})
export class AppModule {}
