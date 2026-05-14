import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MeService } from '../me/me.service';
import { PaygateService } from '../paygate/paygate.service';
import { PaymentOrdersRepository } from './payment-orders.repository';

interface InitiateInput {
  eventId: string;
  entryTypeId?: string | null;
  quantity: number;
  referralCode?: string | null;
}

@Injectable()
export class MePaymentsService {
  private readonly logger = new Logger(MePaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paygate: PaygateService,
    private readonly orders: PaymentOrdersRepository,
    private readonly me: MeService,
  ) {}

  async initiatePayment(userId: string, input: InitiateInput) {
    this.logger.log(
      `initiatePayment start user=${userId} event=${input.eventId} qty=${input.quantity}`,
    );
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

    this.logger.log(
      `initiatePayment paygateLink created event=${event.id} paygateLinkId=${link.id} amountCents=${amountCents} discountCents=${discountCents}`,
    );

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
    const order = await this.orders.findById(orderId);
    if (!order) throw new NotFoundException('Orden no encontrada');
    if (order.userId !== userId) {
      throw new ForbiddenException('Acceso denegado');
    }

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
