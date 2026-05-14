import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaygateService } from '../paygate/paygate.service';
import { PaymentOrdersRepository } from './payment-orders.repository';

@Injectable()
export class MePaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paygate: PaygateService,
    private readonly orders: PaymentOrdersRepository,
  ) {}

  async initiatePayment(userId: string, input: {
    eventId: string;
    entryTypeId?: string | null;
    quantity: number;
  }) {
    const event = await this.prisma.event.findUnique({
      where: { id: input.eventId },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');

    const quantity = Math.floor(input.quantity);
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 20) {
      throw new BadRequestException('quantity debe estar entre 1 y 20');
    }

    if ((event as any).ticketMode === 'free') {
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

    const amountCents = unitPriceCents * quantity;
    const link = await this.paygate.createPaymentLink({
      description: `Ticket - ${event.title}`,
      amount: Number((amountCents / 100).toFixed(2)),
      currency: 'HNL',
    });

    const expiresAt = new Date(Date.now() + link.expirationHours * 60 * 60 * 1000);

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
    };
  }

  async getOrder(userId: string, orderId: string) {
    const order = await this.orders.findById(orderId);
    if (!order) throw new NotFoundException('Orden no encontrada');
    if (order.userId !== userId) throw new ForbiddenException('Acceso denegado');

    const now = new Date();
    const computedStatus =
      order.status === 'pending_payment' && order.expiresAt && order.expiresAt < now
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

  private async getEventUnitPriceCents(eventId: string): Promise<number> {
    // Reuse the same ticket-type selection heuristic as MeService.
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
    } catch (err) {
      throw new InternalServerErrorException(
        'No se pudo determinar el precio del ticket para el evento',
      );
    }
  }
}
