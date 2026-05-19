import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { AdminController } from './admin.controller';
import { AdminSecretGuard } from './admin-secret.guard';

@Module({
  imports: [PaymentsModule],
  controllers: [AdminController],
  providers: [AdminSecretGuard],
})
export class AdminModule {}
