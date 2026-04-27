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

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
  controllers: [
    AppController,
    HealthController,
    InterestsController,
    ProvidersController,
    EventsController,
  ],
  providers: [AppService, SupabaseAdminService, InterestsService],
})
export class AppModule {}
