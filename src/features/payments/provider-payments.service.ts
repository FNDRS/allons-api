import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProvidersService } from '../providers/providers.service';
import { PaymentOrdersRepository } from './payment-orders.repository';

@Injectable()
export class ProviderPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProvidersService,
    private readonly orders: PaymentOrdersRepository,
  ) {}

  /**
   * Lists the payment orders for a single event, plus an aggregated
   * summary. Only the provider that owns the event can fetch this.
   *
   * Ownership is enforced by joining the caller's provider membership
   * (via `ProvidersService.getMembership`) with `event.providerId`.
   * If either is missing or mismatches we 403 so we never leak
   * payment activity to a different merchant.
   */
  async listForEvent(userId: string, eventId: string) {
    const membership = await this.providers.getMembership(userId);
    if (!membership) {
      throw new ForbiddenException(
        'El usuario no está asociado a ningún comercio',
      );
    }

    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, providerId: true, title: true },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');
    if (event.providerId !== membership.providerId) {
      throw new ForbiddenException('Este evento pertenece a otro comercio');
    }

    const [rows, summary] = await Promise.all([
      this.orders.listForEvent(eventId),
      this.orders.summaryForEvent(eventId),
    ]);

    return {
      eventId: event.id,
      eventTitle: event.title,
      summary,
      data: rows.map((row) => ({
        orderId: row.id,
        status: row.status,
        amountCents: row.amountCents,
        currency: row.currency,
        quantity: row.quantity,
        buyerUserId: row.userId,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }
}
