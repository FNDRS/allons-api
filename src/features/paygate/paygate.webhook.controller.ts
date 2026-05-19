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
import { ApiBody, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { seconds, Throttle } from '@nestjs/throttler';
import { ObservabilityService } from '../../shared/observability/observability.service';
import { PostHogService } from '../../shared/posthog/posthog.service';
import { PaygateConfigService } from './paygate.config';
import { PaygateWebhookSignatureError } from './paygate.errors';
import { PaygateSignatureVerifier } from './paygate.signature';
import type { PaygateWebhookPayload } from './paygate.types';
import { PaymentOrdersRepository } from '../payments/payment-orders.repository';
import { MeService } from '../me/me.service';
import { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';
import { PrismaService } from '../../prisma/prisma.service';

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
    private readonly prisma: PrismaService,
    private readonly obs: ObservabilityService,
    private readonly posthog: PostHogService,
  ) {}

  @Post()
  @HttpCode(200)
  @Throttle({ 'paygate-webhook': { ttl: seconds(60), limit: 600 } })
  @ApiOperation({
    summary: 'Paygate (Clinpays) webhook receiver',
    description:
      'Public endpoint Paygate calls when a charge status changes. **No** user `Authorization: Bearer`. When `PAYGATE_WEBHOOK_SECRET` is set, the raw body must be signed (e.g. `X-Clinpays-Webhook-Signature`). Without a secret, requests are rejected unless `PAYGATE_WEBHOOK_ALLOW_UNSIGNED=true` (development only).',
  })
  @ApiHeader({
    name: 'X-Clinpays-Webhook-Signature',
    required: false,
    description:
      'HMAC signature of the raw body when the webhook secret is configured.',
  })
  @ApiBody({
    description: 'Paygate event JSON (shape per merchant documentation).',
    schema: {
      type: 'object',
      additionalProperties: true,
      example: {
        paymentId: 'paygate-payment-id',
        linkId: 'paygate-link-id',
        status: 'APPROVED',
      },
    },
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
        this.obs.event('payments.webhook.signature_ok', {
          webhookId: firstHeader(headers, 'x-clinpays-webhook-id') ?? null,
        });
      } catch (err) {
        if (err instanceof PaygateWebhookSignatureError) {
          this.logger.warn(
            `Paygate webhook rejected (${err.reason}): ${err.message}`,
          );
          this.obs.warn('payments.webhook.signature_invalid', {
            reason: err.reason,
            webhookId: firstHeader(headers, 'x-clinpays-webhook-id') ?? null,
          });
          throw new UnauthorizedException('Invalid Paygate signature');
        }
        throw err;
      }
    } else if (!this.cfg.allowUnsignedWebhooks) {
      throw new UnauthorizedException(
        'Paygate webhook signing is not configured (set PAYGATE_WEBHOOK_SECRET, or PAYGATE_WEBHOOK_ALLOW_UNSIGNED=true only for local development)',
      );
    } else {
      this.logger.warn(
        'Paygate webhook accepted WITHOUT signature verification (PAYGATE_WEBHOOK_ALLOW_UNSIGNED=true). Never enable this in production.',
      );
    }

    this.logger.log(
      `Paygate webhook received${eventHint ? ` (event=${String(eventHint)})` : ''}`,
    );

    this.obs.event('payments.webhook.received', {
      webhookId: firstHeader(headers, 'x-clinpays-webhook-id') ?? null,
      eventHint: eventHint ? String(eventHint) : null,
    });

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
      typeof payload.orderReference === 'string'
        ? payload.orderReference
        : null;

    if (!paygateId) {
      this.logger.warn('Paygate webhook missing _id; ignoring');
      this.obs.warn('payments.webhook.missing_paygate_id', {
        webhookId: firstHeader(headers, 'x-clinpays-webhook-id') ?? null,
      });
      return;
    }

    const order = await this.findOrder({ paygateId, orderRef });
    if (!order) {
      const webhookId = firstHeader(headers, 'x-clinpays-webhook-id');
      this.logger.warn(
        `Paygate webhook for unknown order (paygateId=${paygateId}${orderRef ? `, orderReference=${orderRef}` : ''}${webhookId ? `, webhookId=${webhookId}` : ''})`,
      );
      this.obs.warn('payments.webhook.unknown_order', {
        paygateId,
        webhookId: webhookId ?? null,
        hasOrderRef: Boolean(orderRef),
      });
      return;
    }

    const nextStatus = mapWebhookStatus(rawStatus);
    if (!nextStatus) {
      this.logger.warn(
        `Paygate webhook has unhandled status="${rawStatus}" (order=${order.id})`,
      );
      this.obs.warn('payments.webhook.unhandled_status', {
        orderId: order.id,
        paygateId,
        status: rawStatus,
      });
      return;
    }

    const transitioned = await this.orders.transitionStatus(order.id, {
      status: nextStatus,
      paygatePaymentId: paygateId,
      paygateRawWebhook: payload as any,
      source: 'webhook',
    });

    if (!transitioned.applied) {
      // Idempotent duplicate or already terminal.
      return;
    }

    this.obs.event('payments.order.transitioned', {
      orderId: order.id,
      userId: order.userId,
      from: 'pending_payment',
      to: nextStatus,
      source: 'webhook',
      paygatePaymentId: paygateId,
    });

    if (nextStatus === 'paid') {
      this.posthog.capture({
        distinctId: order.userId,
        event: 'payment completed',
        properties: {
          order_id: order.id,
          event_id: order.eventId,
          amount_cents: order.amountCents,
          currency: order.currency,
          quantity: order.quantity,
          source: 'webhook',
        },
      });
    } else {
      this.posthog.capture({
        distinctId: order.userId,
        event: 'payment failed',
        properties: {
          order_id: order.id,
          event_id: order.eventId,
          amount_cents: order.amountCents,
          currency: order.currency,
          status: nextStatus,
          source: 'webhook',
        },
      });
    }

    if (nextStatus !== 'paid') return;

    const eventRow = await this.prisma.event.findUnique({
      where: { id: order.eventId },
    });
    if (!eventRow) {
      this.logger.error(
        `Paid order ${order.id} references missing event ${order.eventId}; cannot create tickets`,
      );
      return;
    }
    const sold = await this.prisma.ticket.count({
      where: { eventId: order.eventId, cancelledAt: null },
    });
    if (eventRow.capacity > 0 && sold + order.quantity > eventRow.capacity) {
      this.logger.error(
        `Refusing ticket issuance for paid order ${order.id}: event ${order.eventId} capacity ${eventRow.capacity}, sold ${sold}, order quantity ${order.quantity}`,
      );
      return;
    }

    // Create tickets on successful payment.
    try {
      const { data, error } =
        await this.supabaseAdmin.db.auth.admin.getUserById(order.userId);
      if (error || !data?.user?.email) {
        throw new Error('No se pudo obtener el email del usuario');
      }

      const buyerName =
        typeof (data.user.user_metadata as { name?: unknown })?.name ===
        'string'
          ? String((data.user.user_metadata as { name: string }).name)
          : null;
      const holderTemplate = {
        email: data.user.email,
        ...(buyerName ? { name: buyerName } : {}),
      };
      const holders = Array.from({ length: order.quantity }, () => ({
        ...holderTemplate,
      }));

      await this.me.createTicket(order.userId, order.eventId, order.quantity, {
        email: data.user.email,
        name: buyerName,
        holders,
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
