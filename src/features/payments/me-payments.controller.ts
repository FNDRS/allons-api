import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';
import { MePaymentsService } from './me-payments.service';

@Controller('me/payments')
export class MePaymentsController {
  constructor(
    private readonly payments: MePaymentsService,
    private readonly supabaseAdmin: SupabaseAdminService,
  ) {}

  @Post('initiate')
  async initiate(
    @Req() req: Request,
    @Body()
    body: { eventId?: string; entryTypeId?: string; quantity?: number },
  ) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    if (!body?.eventId || typeof body.eventId !== 'string') {
      throw new BadRequestException('eventId es requerido');
    }
    const quantity =
      typeof body.quantity === 'number' && Number.isFinite(body.quantity)
        ? Math.floor(body.quantity)
        : 1;
    return this.payments.initiatePayment(user.id, {
      eventId: body.eventId,
      entryTypeId: typeof body.entryTypeId === 'string' ? body.entryTypeId : null,
      quantity,
    });
  }

  @Get('orders/:orderId')
  async getOrder(@Req() req: Request, @Param('orderId') orderId: string) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    return this.payments.getOrder(user.id, orderId);
  }

  @Get('orders')
  async listOrders(@Req() req: Request) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    return this.payments.listOrders(user.id);
  }
}
