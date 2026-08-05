import { Module } from '@nestjs/common';
import { ProvidersModule } from '../providers/providers.module';
import { PaygateModule } from '../paygate/paygate.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { ClassProgramsController } from './class-programs.controller';
import { ClassProgramsRepository } from './class-programs.repository';
import { MeClassProgramsController } from './me-class-programs.controller';
import { ProviderClassProgramsController } from './provider-class-programs.controller';
import { ClassProgramsService } from './class-programs.service';
import { ClassReminderService } from './class-reminder.service';

@Module({
  imports: [
    PaygateModule,
    PaymentsModule,
    ProvidersModule,
    NotificationsModule,
  ],
  controllers: [
    ClassProgramsController,
    MeClassProgramsController,
    ProviderClassProgramsController,
  ],
  providers: [
    ClassProgramsRepository,
    ClassProgramsService,
    ClassReminderService,
  ],
})
export class ClassProgramsModule {}
