import { Injectable, Logger } from '@nestjs/common';
import { Prisma, PaymentOrderStatus } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  CreatePaymentOrderInput,
  PaymentOrder,
  TransitionStatusInput,
} from './payment-orders.types';

/**
 * Data-access layer for the `payment_orders` table.
 *
 * Encapsulates every read/write the rest of the codebase needs against
 * this table so the business layer never touches Prisma directly. Keeps
 * idempotency rules close to the schema: the `paygate_link_id` and
 * `paygate_payment_id` unique constraints are the source of truth for
 * "did we already see this?" — repository methods surface them as
 * predictable lookups (`findByPaygateLinkId`, `findByPaygatePaymentId`)
 * rather than letting callers re-implement the join.
 */
@Injectable()
export class PaymentOrdersRepository {
  private readonly logger = new Logger(PaymentOrdersRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  create(input: CreatePaymentOrderInput): Promise<PaymentOrder> {
    return this.prisma.paymentOrder.create({
      data: {
        userId: input.userId,
        eventId: input.eventId,
        entryTypeId: input.entryTypeId ?? null,
        quantity: input.quantity,
        amountCents: input.amountCents,
        currency: input.currency ?? 'HNL',
        paygateLinkId: input.paygateLinkId,
        expiresAt: input.expiresAt,
      },
    });
  }

  findById(id: string): Promise<PaymentOrder | null> {
    return this.prisma.paymentOrder.findUnique({ where: { id } });
  }

  findByPaygateLinkId(paygateLinkId: string): Promise<PaymentOrder | null> {
    return this.prisma.paymentOrder.findUnique({
      where: { paygateLinkId },
    });
  }

  findByPaygatePaymentId(
    paygatePaymentId: string,
  ): Promise<PaymentOrder | null> {
    return this.prisma.paymentOrder.findUnique({
      where: { paygatePaymentId },
    });
  }

  listForUser(userId: string): Promise<PaymentOrder[]> {
    return this.prisma.paymentOrder.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  listForEvent(eventId: string): Promise<PaymentOrder[]> {
    return this.prisma.paymentOrder.findMany({
      where: { eventId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Aggregated counters and paid GMV (in cents) for a single event.
   * The provider dashboard uses this; we keep aggregation in SQL so
   * we don't pull every row into memory just to sum amounts.
   */
  async summaryForEvent(eventId: string): Promise<{
    paidCount: number;
    pendingCount: number;
    failedCount: number;
    cancelledCount: number;
    refundedCount: number;
    paidAmountCents: number;
  }> {
    const grouped = await this.prisma.paymentOrder.groupBy({
      by: ['status'],
      where: { eventId },
      _count: { _all: true },
      _sum: { amountCents: true },
    });

    const summary = {
      paidCount: 0,
      pendingCount: 0,
      failedCount: 0,
      cancelledCount: 0,
      refundedCount: 0,
      paidAmountCents: 0,
    };

    for (const row of grouped) {
      const count = row._count?._all ?? 0;
      switch (row.status) {
        case 'paid':
          summary.paidCount = count;
          summary.paidAmountCents = row._sum?.amountCents ?? 0;
          break;
        case 'pending_payment':
          summary.pendingCount = count;
          break;
        case 'failed':
          summary.failedCount = count;
          break;
        case 'cancelled':
          summary.cancelledCount = count;
          break;
        case 'refunded':
          summary.refundedCount = count;
          break;
      }
    }

    return summary;
  }

  /**
   * Returns pending orders whose payment link has expired past the
   * given grace period. Use for a periodic sweeper that flips them to
   * `cancelled` when Paygate never sent a terminal webhook.
   */
  listExpiredPending(now: Date, gracePeriodMs = 0): Promise<PaymentOrder[]> {
    const cutoff = new Date(now.getTime() - gracePeriodMs);
    return this.prisma.paymentOrder.findMany({
      where: {
        status: 'pending_payment',
        expiresAt: { lt: cutoff },
      },
      orderBy: { expiresAt: 'asc' },
    });
  }

  /**
   * Transitions an order to a terminal state from `pending_payment`.
   *
   * Guarded by a `status: pending_payment` clause in the update WHERE
   * so the second arriving webhook is a no-op (Prisma returns count 0
   * and we surface it as `alreadyApplied`). The unique constraint on
   * `paygate_payment_id` prevents the same payment from being attached
   * to two orders.
   */
  async transitionStatus(
    id: string,
    payload: TransitionStatusInput,
  ): Promise<
    | { applied: true; order: PaymentOrder }
    | { applied: false; reason: 'not_pending' | 'not_found' }
  > {
    try {
      const result = await this.prisma.paymentOrder.updateMany({
        where: { id, status: 'pending_payment' },
        data: {
          status: payload.status,
          paygatePaymentId: payload.paygatePaymentId ?? undefined,
          paygateRawWebhook: payload.paygateRawWebhook ?? undefined,
          updatedAt: new Date(),
        },
      });

      if (result.count === 0) {
        const exists = await this.findById(id);
        return {
          applied: false,
          reason: exists ? 'not_pending' : 'not_found',
        };
      }

      const order = await this.prisma.paymentOrder.findUniqueOrThrow({
        where: { id },
      });
      return { applied: true, order };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Unique violation on paygate_payment_id: a different order
        // already claims this payment. Surface to caller for manual
        // reconciliation.
        this.logger.warn(
          `paygate_payment_id unique violation while transitioning order ${id}`,
        );
        return { applied: false, reason: 'not_pending' };
      }
      throw err;
    }
  }

  countByStatus(status: PaymentOrderStatus): Promise<number> {
    return this.prisma.paymentOrder.count({ where: { status } });
  }

  listByStatus(status: PaymentOrderStatus): Promise<PaymentOrder[]> {
    return this.prisma.paymentOrder.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
    });
  }

  listAdmin(filter: {
    status?: string;
    eventId?: string;
    startDate?: string;
    endDate?: string;
    limit: number;
    offset: number;
  }): Promise<{ total: number; items: PaymentOrder[] }> {
    const where: Record<string, unknown> = {};
    if (filter.status) where.status = filter.status;
    if (filter.eventId) where.eventId = filter.eventId;
    if (filter.startDate || filter.endDate) {
      where.createdAt = {
        ...(filter.startDate ? { gte: new Date(filter.startDate) } : {}),
        ...(filter.endDate ? { lte: new Date(filter.endDate) } : {}),
      };
    }
    return Promise.all([
      this.prisma.paymentOrder.findMany({
        where: where as any,
        orderBy: { createdAt: 'desc' },
        take: filter.limit,
        skip: filter.offset,
      }),
      this.prisma.paymentOrder.count({ where: where as any }),
    ]).then(([items, total]) => ({ items, total }));
  }
}
