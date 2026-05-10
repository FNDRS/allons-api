import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminSecretGuard } from './admin-secret.guard';

@Module({
  controllers: [AdminController],
  providers: [AdminSecretGuard],
})
export class AdminModule {}
