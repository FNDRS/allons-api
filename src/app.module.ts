import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SupabaseAdminService } from './supabase-admin.service';
import { InterestsController } from './interests.controller';
import { InterestsService } from './interests.service';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './health/health.controller';
import { ProvidersController } from './providers/providers.controller';
import { EventsController } from './events/events.controller';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { MeController } from './me/me.controller';
import { MeService } from './me/me.service';
import { FriendsController } from './friends/friends.controller';
import { FriendsService } from './friends/friends.service';
import { ConversationsController } from './conversations/conversations.controller';
import { ConversationsService } from './conversations/conversations.service';
import { MailService } from './mail/mail.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
  controllers: [
    AppController,
    HealthController,
    InterestsController,
    ProvidersController,
    EventsController,
    AccountController,
    MeController,
    FriendsController,
    ConversationsController,
  ],
  providers: [
    AppService,
    SupabaseAdminService,
    InterestsService,
    AccountService,
    MeService,
    FriendsService,
    ConversationsService,
    MailService,
  ],
})
export class AppModule {}
