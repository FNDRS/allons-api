import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { PaygateModule } from '../paygate/paygate.module';
import { AdminController } from './admin.controller';
import { AdminSecretGuard } from './admin-secret.guard';

@Module({
  imports: [PaymentsModule, PaygateModule],
  controllers: [AdminController],
  providers: [AdminSecretGuard],
})
export class AdminModule {}
