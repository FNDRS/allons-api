import { Module } from '@nestjs/common';
import { ProvidersModule } from '../providers/providers.module';
import { PaygateModule } from '../paygate/paygate.module';
import { PaymentOrdersRepository } from '../payments/payment-orders.repository';
import { ClassProgramsController } from './class-programs.controller';
import { ClassProgramsRepository } from './class-programs.repository';
import { MeClassProgramsController } from './me-class-programs.controller';
import { ProviderClassProgramsController } from './provider-class-programs.controller';
import { ClassProgramsService } from './class-programs.service';

@Module({
  imports: [PaygateModule, ProvidersModule],
  controllers: [
    ClassProgramsController,
    MeClassProgramsController,
    ProviderClassProgramsController,
  ],
  providers: [
    ClassProgramsRepository,
    ClassProgramsService,
    PaymentOrdersRepository,
  ],
})
export class ClassProgramsModule {}
