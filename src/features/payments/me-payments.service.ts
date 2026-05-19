import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';
import { MeService } from '../me/me.service';
import { PaygateService } from '../paygate/paygate.service';
import { PaymentOrdersRepository } from './payment-orders.repository';
import type { PaymentOrder } from './payment-orders.types';

interface InitiateInput {
  eventId: string;
  entryTypeId?: string | null;
  quantity: number;
  referralCode?: string | null;
}

/**
 * How long the order has to have been pending before the mobile-side
 * polling triggers a server-side reconciliation against Paygate. The
 * happy path is webhook → transition in <1s; this grace window lets
 * that path win when it works and only escalates when the webhook
 * never showed up.
 */
const RECONCILE_GRACE_MS = 4_000;

@Injectable()
export class MePaymentsService {
  private readonly logger = new Logger(MePaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paygate: PaygateService,
    private readonly orders: PaymentOrdersRepository,
    private readonly me: MeService,
    private readonly supabaseAdmin: SupabaseAdminService,
  ) {}

  async initiatePayment(userId: string, input: InitiateInput) {
    const event = await this.prisma.event.findUnique({
      where: { id: input.eventId },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');

    const quantity = Math.floor(input.quantity);
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 20) {
      throw new BadRequestException('quantity debe estar entre 1 y 20');
    }

    if ((event as unknown as { ticketMode?: string }).ticketMode === 'free') {
      throw new BadRequestException(
        'Este evento no requiere pago (ticketMode=free)',
      );
    }

    const unitPriceCents = await this.getEventUnitPriceCents(event.id);
    if (unitPriceCents <= 0) {
      throw new BadRequestException(
        'El evento no tiene precio configurado para tickets pagos',
      );
    }

    const existingSold = await this.prisma.ticket.count({
      where: { eventId: event.id },
    });
    if (event.capacity > 0 && existingSold + quantity > event.capacity) {
      throw new BadRequestException('No hay cupo disponible');
    }

    const grossAmountCents = unitPriceCents * quantity;
    const referralCode = nonEmptyTrim(input.referralCode);
    const { amountCents, discountCents } = await this.applyReferralDiscount(
      userId,
      grossAmountCents,
      referralCode,
    );

    if (amountCents <= 0) {
      // Paygate refuses zero/negative amounts. A 100%-off referral would
      // need a separate "free reservation" path that bypasses the
      // gateway entirely — out of scope here.
      throw new BadRequestException(
        'El total a cobrar quedó en 0; usa la reserva gratuita en su lugar',
      );
    }

    const link = await this.paygate.createPaymentLink({
      description: `Ticket - ${event.title}`,
      amount: Number((amountCents / 100).toFixed(2)),
      currency: 'HNL',
    });

    const expiresAt = new Date(
      Date.now() + link.expirationHours * 60 * 60 * 1000,
    );

    const order = await this.orders.create({
      userId,
      eventId: event.id,
      entryTypeId: input.entryTypeId ?? null,
      quantity,
      amountCents,
      currency: link.currency,
      paygateLinkId: link.id,
      expiresAt,
    });

    return {
      orderId: order.id,
      paymentLink: link.link,
      amountCents: order.amountCents,
      currency: order.currency,
      expiresAt: order.expiresAt?.toISOString() ?? expiresAt.toISOString(),
      discount: discountCents > 0 ? { cents: discountCents } : null,
    };
  }

  async getOrder(userId: string, orderId: string) {
    let order = await this.orders.findById(orderId);
    if (!order) throw new NotFoundException('Orden no encontrada');
    if (order.userId !== userId) {
      throw new ForbiddenException('Acceso denegado');
    }

    // The webhook from Paygate cannot map the inbound transaction id
    // back to our payment_orders row (Paygate's webhook payload doesn't
    // echo the link id), so a stale or missing webhook would otherwise
    // leave the order forever `pending_payment`. The mobile client is
    // already polling this endpoint; we use those calls to also pull
    // the canonical state from Paygate and transition + fulfill on
    // our side when the gateway says the payment landed.
    order = await this.maybeReconcileFromPaygate(order);

    const now = new Date();
    const computedStatus =
      order.status === 'pending_payment' &&
      order.expiresAt &&
      order.expiresAt < now
        ? 'cancelled'
        : order.status;

    const tickets = await this.prisma.ticket.findMany({
      where: { paymentOrderId: order.id },
      select: { id: true },
    });

    return {
      orderId: order.id,
      status: computedStatus,
      amountCents: order.amountCents,
      currency: order.currency,
      ticketIds: computedStatus === 'paid' ? tickets.map((t) => t.id) : [],
      eventId: order.eventId,
      expiresAt: order.expiresAt?.toISOString() ?? null,
    };
  }

  /**
   * Best-effort reconciliation: asks Paygate for the latest state of
   * the payment link and, if the gateway says it's been processed,
   * transitions our order to `paid` and mints the tickets. No-op when:
   *
   *  - the order is no longer `pending_payment`
   *  - we don't have a `paygate_link_id` to query against
   *  - the order is too fresh (give the webhook a head start)
   *  - the order has already expired locally
   *
   * Any Paygate / DB error is swallowed with a warn log — the caller's
   * subsequent DB read still surfaces the existing state, and the
   * mobile poller will try again on the next tick. `transitionStatus`
   * is the same idempotency gate the webhook controller uses, so a
   * webhook that lands during this call doesn't double-create tickets.
   */
  private async maybeReconcileFromPaygate(
    order: PaymentOrder,
  ): Promise<PaymentOrder> {
    if (order.status !== 'pending_payment') return order;
    if (!order.paygateLinkId) return order;
    const now = new Date();
    const ageMs = now.getTime() - order.createdAt.getTime();
    if (ageMs < RECONCILE_GRACE_MS) return order;
    if (order.expiresAt && order.expiresAt < now) return order;

    let detail;
    try {
      detail = await this.paygate.getPaymentLinkDetail(order.paygateLinkId);
    } catch (err) {
      this.logger.warn(
        `reconcile: paygate.getPaymentLinkDetail failed for order=${order.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return order;
    }

    const paygateStatus = detail.status?.toUpperCase() ?? '';
    const looksPaid =
      paygateStatus === 'PROCESSED' || (detail.numberOfProcesses ?? 0) > 0;
    if (!looksPaid) {
      return order;
    }

    const transition = await this.orders.transitionStatus(order.id, {
      status: 'paid',
      paygatePaymentId: detail.id,
      paygateRawWebhook: detail,
      source: 'polling',
    });
    if (!transition.applied) {
      // Someone else (e.g. the webhook) already moved this order.
      // Re-read once so the caller works with the latest row.
      return (await this.orders.findById(order.id)) ?? order;
    }

    // Mint the tickets — same code path the webhook controller uses.
    // Failures here are logged but not rolled back: the order stays
    // `paid` and the support flow can backfill missing tickets.
    try {
      const { data } = await this.supabaseAdmin.db.auth.admin.getUserById(
        order.userId,
      );
      const userEmail = data?.user?.email ?? null;
      const userMeta = data?.user?.user_metadata as
        | { name?: unknown }
        | null
        | undefined;
      const userName =
        typeof userMeta?.name === 'string' ? userMeta.name : null;
      if (!userEmail) {
        throw new Error('No se pudo obtener el email del comprador');
      }
      await this.me.createTicket(order.userId, order.eventId, order.quantity, {
        email: userEmail,
        name: userName,
        holders: [],
        paymentOrderId: order.id,
      });
      this.logger.log(
        `reconcile: fulfilled order=${order.id} via Paygate polling (paygatePaymentId=${detail.id})`,
      );
    } catch (err) {
      this.logger.error(
        `reconcile: order ${order.id} marked paid but ticket creation failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return transition.order;
  }

  async listOrders(userId: string) {
    const rows = await this.orders.listForUser(userId);
    return {
      data: rows.map((row) => ({
        orderId: row.id,
        status: row.status,
        amountCents: row.amountCents,
        currency: row.currency,
        eventId: row.eventId,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Resolves the discount the user is eligible for and subtracts it
   * from the gross amount. Capturing the referral code is best-effort
   * (a bad code shouldn't block paid checkout) but a successful
   * capture is what makes the user's claim eligible going forward.
   */
  private async applyReferralDiscount(
    userId: string,
    grossAmountCents: number,
    referralCode: string | null,
  ): Promise<{ amountCents: number; discountCents: number }> {
    if (referralCode) {
      await this.me.captureReferralCode(userId, referralCode).catch(() => null);
    }

    const preview = await this.me.getReferralCheckoutPreview(userId);
    if (!preview.eligible || preview.discountValueCents <= 0) {
      return { amountCents: grossAmountCents, discountCents: 0 };
    }

    const discountCents = Math.min(
      preview.discountValueCents,
      grossAmountCents,
    );
    return {
      amountCents: grossAmountCents - discountCents,
      discountCents,
    };
  }

  private async getEventUnitPriceCents(eventId: string): Promise<number> {
    try {
      const rows = await this.prisma.$queryRaw<Array<{ price: number }>>`
        SELECT price::float8 AS price
        FROM provider_event_ticket_types
        WHERE event_id = ${eventId}::uuid
          AND active = true
        ORDER BY
          CASE kind
            WHEN 'general' THEN 0
            WHEN 'early' THEN 1
            WHEN 'vip' THEN 2
            ELSE 3
          END ASC,
          created_at ASC
        LIMIT 1
      `;
      const price = rows[0]?.price;
      if (!Number.isFinite(price)) return 0;
      return Math.round(Number(price) * 100);
    } catch {
      throw new InternalServerErrorException(
        'No se pudo determinar el precio del ticket para el evento',
      );
    }
  }
}

function nonEmptyTrim(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
