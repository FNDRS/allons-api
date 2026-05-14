import {
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  UnauthorizedException,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PaygateConfigService } from './paygate.config';
import { PaygateWebhookSignatureError } from './paygate.errors';
import { PaygateSignatureVerifier } from './paygate.signature';
import type { PaygateWebhookPayload } from './paygate.types';
import { PaymentOrdersRepository } from '../payments/payment-orders.repository';
import { MeService } from '../me/me.service';
import { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';

@ApiTags('webhooks')
@Controller('webhooks/paygate')
export class PaygateWebhookController {
  private readonly logger = new Logger(PaygateWebhookController.name);

  constructor(
    private readonly cfg: PaygateConfigService,
    private readonly signature: PaygateSignatureVerifier,
    private readonly orders: PaymentOrdersRepository,
    private readonly me: MeService,
    private readonly supabaseAdmin: SupabaseAdminService,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Paygate (Clinpays) webhook receiver',
    description:
      'Public endpoint Paygate calls when a payment status changes. If PAYGATE_WEBHOOK_SECRET is configured, the request must carry a valid signature in `X-Clinpays-Webhook-Signature`; otherwise the request is rejected with 401. When the secret is unset, the request is accepted with a warning log so payloads can be inspected before signature validation is enforced.',
  })
  handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ): { ok: true } {
    const eventHint =
      headers['x-paygate-event'] ??
      headers['x-event'] ??
      headers['x-webhook-event'] ??
      undefined;

    if (this.cfg.webhookSecret) {
      const rawBody = req.rawBody;
      if (!rawBody) {
        // Should never happen with rawBody: true in main.ts, but
        // guard explicitly — without the raw bytes we can't verify.
        this.logger.error(
          'Paygate webhook arrived without rawBody; check main.ts rawBody flag',
        );
        throw new UnauthorizedException('Signature could not be verified');
      }

      try {
        this.signature.verify({ rawBody, headers });
      } catch (err) {
        if (err instanceof PaygateWebhookSignatureError) {
          this.logger.warn(
            `Paygate webhook rejected (${err.reason}): ${err.message}`,
          );
          throw new UnauthorizedException('Invalid Paygate signature');
        }
        throw err;
      }
    } else {
      this.logger.warn(
        'Paygate webhook accepted WITHOUT signature verification (PAYGATE_WEBHOOK_SECRET not set). Set the secret to enable strict validation.',
      );
    }

    this.logger.log(
      `Paygate webhook received${eventHint ? ` (event=${String(eventHint)})` : ''}`,
    );

    // Process asynchronously but respond 200 quickly to avoid retries.
    void this.processWebhook(req.body as PaygateWebhookPayload, headers).catch(
      (err) => {
        this.logger.error(`Paygate webhook processing failed: ${String(err)}`);
      },
    );

    return { ok: true };
  }

  private async processWebhook(
    payload: PaygateWebhookPayload,
    headers: Record<string, string | string[] | undefined>,
  ) {
    if (!payload || typeof payload !== 'object') return;
    const rawStatus =
      typeof payload.status === 'string' ? payload.status.toUpperCase() : '';
    const paygateId = typeof payload._id === 'string' ? payload._id : null;
    const orderRef =
      typeof payload.orderReference === 'string' ? payload.orderReference : null;

    if (!paygateId) {
      this.logger.warn('Paygate webhook missing _id; ignoring');
      return;
    }

    const order = await this.findOrder({ paygateId, orderRef });
    if (!order) {
      const webhookId = firstHeader(headers, 'x-clinpays-webhook-id');
      this.logger.warn(
        `Paygate webhook for unknown order (paygateId=${paygateId}${orderRef ? `, orderReference=${orderRef}` : ''}${webhookId ? `, webhookId=${webhookId}` : ''})`,
      );
      return;
    }

    const nextStatus = mapWebhookStatus(rawStatus);
    if (!nextStatus) {
      this.logger.warn(
        `Paygate webhook has unhandled status="${rawStatus}" (order=${order.id})`,
      );
      return;
    }

    const transitioned = await this.orders.transitionStatus(order.id, {
      status: nextStatus,
      paygatePaymentId: paygateId,
      paygateRawWebhook: payload as any,
    });

    if (!transitioned.applied) {
      // Idempotent duplicate or already terminal.
      return;
    }

    if (nextStatus !== 'paid') return;

    // Create tickets on successful payment.
    try {
      const { data, error } =
        await this.supabaseAdmin.db.auth.admin.getUserById(order.userId);
      if (error || !data?.user?.email) {
        throw new Error('No se pudo obtener el email del usuario');
      }

      await this.me.createTicket(order.userId, order.eventId, order.quantity, {
        email: data.user.email,
        name:
          typeof (data.user.user_metadata as any)?.name === 'string'
            ? String((data.user.user_metadata as any).name)
            : null,
        holders: [],
        paymentOrderId: order.id,
      });
    } catch (err) {
      // We keep the order as paid; manual reconciliation can create tickets.
      this.logger.error(
        `Failed to create tickets for paid order ${order.id}: ${String(err)}`,
      );
    }
  }

  private async findOrder(input: {
    paygateId: string;
    orderRef: string | null;
  }) {
    if (input.orderRef) {
      // Try orderReference as internal order id first.
      const byId = await this.orders.findById(input.orderRef).catch(() => null);
      if (byId) return byId;
      const byLink = await this.orders.findByPaygateLinkId(input.orderRef);
      if (byLink) return byLink;
    }

    // Fall back to interpreting `_id` as either link id or payment id.
    return (
      (await this.orders.findByPaygateLinkId(input.paygateId)) ??
      (await this.orders.findByPaygatePaymentId(input.paygateId))
    );
  }
}

function mapWebhookStatus(
  status: string,
): 'paid' | 'failed' | 'cancelled' | null {
  switch (status) {
    case 'APPROVED':
      return 'paid';
    case 'DENIED':
      return 'failed';
    case 'CANCELED':
    case 'CANCELLED':
    case 'EXPIRED':
      return 'cancelled';
    default:
      return null;
  }
}

function firstHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== target) continue;
    const value = headers[key];
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
  }
  return null;
}
