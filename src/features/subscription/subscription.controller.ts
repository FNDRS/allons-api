import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';
import { SubscriptionService } from './subscription.service';

@Controller('provider')
export class SubscriptionController {
  constructor(
    private readonly subscription: SubscriptionService,
    private readonly supabaseAdmin: SupabaseAdminService,
  ) {}

  private async getUser(req: Request) {
    return this.supabaseAdmin.getAuthenticatedUser(req.headers.authorization);
  }

  @Get('subscription')
  async getSubscription(@Req() req: Request) {
    const user = await this.getUser(req);
    return this.subscription.getSubscription(user.id);
  }

  @Get('plans')
  getPlans() {
    return { data: this.subscription.getPlans() };
  }

  @Post('subscription/initiate')
  async initiate(@Req() req: Request, @Body() body: { planId?: unknown }) {
    const user = await this.getUser(req);
    return this.subscription.initiateSubscription(user.id, body?.planId);
  }

  @Get('subscription/orders/:orderId')
  async getOrder(@Req() req: Request, @Param('orderId') orderId: string) {
    const user = await this.getUser(req);
    return this.subscription.getSubscriptionOrder(user.id, orderId);
  }
}
