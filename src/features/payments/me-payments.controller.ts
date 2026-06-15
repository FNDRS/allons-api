import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { seconds, Throttle } from '@nestjs/throttler';
import { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';
import {
  InitiatePaymentBodyDto,
  InitiatePaymentResponseDto,
  PaymentOrderDetailResponseDto,
  PaymentOrderListResponseDto,
} from './me-payments.dto';
import { MePaymentsService } from './me-payments.service';
import { PostHogService } from '../../shared/posthog/posthog.service';

@ApiTags('me — payments')
@ApiBearerAuth('bearer')
@Controller('me/payments')
export class MePaymentsController {
  constructor(
    private readonly payments: MePaymentsService,
    private readonly supabaseAdmin: SupabaseAdminService,
    private readonly posthog: PostHogService,
  ) {}

  @Post('initiate')
  @Throttle({ 'payment-initiate': { ttl: seconds(60), limit: 10 } })
  @ApiOperation({
    summary: 'Start payment (order + Paygate link)',
    description:
      'Creates a `pending_payment` order, generates a Paygate payment link, and returns the checkout URL. Requires Supabase session (JWT). May apply a referral-code discount.',
  })
  @ApiBody({ type: InitiatePaymentBodyDto })
  @ApiResponse({ status: 201, type: InitiatePaymentResponseDto })
  @ApiResponse({
    status: 400,
    description:
      'Business validation failed, invalid payload, or zero total after discount.',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid token.' })
  @ApiResponse({ status: 404, description: 'Event not found.' })
  @ApiResponse({
    status: 503,
    description: 'Paygate unavailable while creating the link.',
  })
  async initiate(@Req() req: Request, @Body() body: InitiatePaymentBodyDto) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    (req as any).userId = user.id;
    if (!body?.eventId || typeof body.eventId !== 'string') {
      throw new BadRequestException('eventId es requerido');
    }
    const quantity =
      typeof body.quantity === 'number' && Number.isFinite(body.quantity)
        ? Math.floor(body.quantity)
        : 1;
    const result = await this.payments.initiatePayment(user.id, {
      eventId: body.eventId,
      entryTypeId:
        typeof body.entryTypeId === 'string' ? body.entryTypeId : null,
      quantity,
      referralCode:
        typeof body.referralCode === 'string' ? body.referralCode : null,
    });
    this.posthog.capture({
      distinctId: user.id,
      event: 'payment initiated',
      properties: {
        event_id: body.eventId,
        quantity,
        order_id: result.orderId,
        amount_cents: result.amountCents,
        currency: result.currency,
        has_discount: Boolean(result.discount),
        has_referral_code: typeof body.referralCode === 'string',
      },
    });
    return result;
  }

  @Get('orders/:orderId')
  @ApiOperation({
    summary: 'Payment order status',
    description:
      'Returns order status and `ticketIds` when `paid`. Order owner only.',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiResponse({ status: 200, type: PaymentOrderDetailResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid token.' })
  @ApiResponse({
    status: 403,
    description: 'Order belongs to another user.',
  })
  @ApiResponse({ status: 404, description: 'Order not found.' })
  async getOrder(@Req() req: Request, @Param('orderId') orderId: string) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    (req as any).userId = user.id;
    return this.payments.getOrder(user.id, orderId);
  }

  @Get('orders')
  @ApiOperation({
    summary: 'List my payment orders',
    description: 'Authenticated user payment order history.',
  })
  @ApiResponse({ status: 200, type: PaymentOrderListResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid token.' })
  async listOrders(@Req() req: Request) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    (req as any).userId = user.id;
    return this.payments.listOrders(user.id);
  }
}
