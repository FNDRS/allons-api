import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminSecretGuard } from '../admin/admin-secret.guard';
import { SubscriptionService } from './subscription.service';

/** Read-only view of self-serve subscription payments for the admin console. */
@UseGuards(AdminSecretGuard)
@Controller('admin/subscription-orders')
export class SubscriptionOrdersAdminController {
  constructor(private readonly subscription: SubscriptionService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.subscription.listOrders({ status });
  }
}
