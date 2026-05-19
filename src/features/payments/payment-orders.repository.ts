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
   * Pending orders older than `minAgeMs` whose expiry hasn't passed
   * yet (i.e. still legitimately waiting for fulfillment) and that
   * have a paygate_link_id we can query. Used by the nightly cron to
   * reconcile orders nobody is looking at anymore.
   */
  listPendingForReconciliation(
    now: Date,
    minAgeMs: number,
    limit = 200,
  ): Promise<PaymentOrder[]> {
    const cutoffCreated = new Date(now.getTime() - minAgeMs);
    return this.prisma.paymentOrder.findMany({
      where: {
        status: 'pending_payment',
        paygateLinkId: { not: null },
        createdAt: { lt: cutoffCreated },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  /**
   * Expired pending orders that still have a paygate_link_id we can
   * query. The nightly sweep reconciles these against Paygate *before*
   * cancelling: if the user paid right before the local TTL elapsed
   * and the webhook never landed, we want to fulfill, not cancel.
   */
  listExpiredPendingWithLink(now: Date): Promise<PaymentOrder[]> {
    return this.prisma.paymentOrder.findMany({
      where: {
        status: 'pending_payment',
        paygateLinkId: { not: null },
        expiresAt: { lt: now },
      },
      orderBy: { expiresAt: 'asc' },
    });
  }

  /**
   * Orders that look terminal (`status='paid'`) but have no tickets
   * pointing back to them — the failure window where transition
   * succeeded but ticket minting threw. The cron uses this to
   * surface candidates for retry / manual review. Bounded by
   * `minAgeMs` so the in-flight immediate-mint path isn't raced.
   */
  listPaidWithoutTickets(
    minAgeMs: number,
    limit = 50,
  ): Promise<PaymentOrder[]> {
    const cutoffUpdated = new Date(Date.now() - minAgeMs);
    return this.prisma.paymentOrder.findMany({
      where: {
        status: 'paid',
        // "No active tickets" — soft-deleted ones don't count as
        // satisfying the order. If they did, an order whose only
        // ticket got cancelled would be invisible here even though
        // the user has nothing usable.
        tickets: { none: { cancelledAt: null } },
        updatedAt: { lt: cutoffUpdated },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Counters that back the admin canary endpoint. Single roundtrip:
   * three parallel `$queryRaw` calls returning age buckets, a
   * paid-without-tickets count, and a 24-hour breakdown by
   * resolution_source.
   *
   * **Bucket semantics:** the `pendingByAge` keys are NON-overlapping
   * age ranges, not cumulative thresholds. `under10m` means "5m ≤ age
   * < 10m", `under30m` means "10m ≤ age < 30m", and so on. Anything
   * "> 10m" is the sum `under30m + under1h + over1h`.
   */
  async canaryStats(now: Date): Promise<{
    pendingByAge: {
      under5m: number;
      under10m: number;
      under30m: number;
      under1h: number;
      over1h: number;
    };
    paidWithoutTicketsCount: number;
    resolutionSourceLast24h: Record<string, number>;
  }> {
    const [pendingRows, paidNoTicketRows, sourceRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ bucket: string; n: number }>>`
        SELECT
          CASE
            WHEN extract(epoch FROM (${now}::timestamptz - created_at)) < 300 THEN 'under5m'
            WHEN extract(epoch FROM (${now}::timestamptz - created_at)) < 600 THEN 'under10m'
            WHEN extract(epoch FROM (${now}::timestamptz - created_at)) < 1800 THEN 'under30m'
            WHEN extract(epoch FROM (${now}::timestamptz - created_at)) < 3600 THEN 'under1h'
            ELSE 'over1h'
          END AS bucket,
          COUNT(*)::int AS n
        FROM payment_orders
        WHERE status = 'pending_payment'
        GROUP BY bucket
      `,
      this.prisma.$queryRaw<Array<{ n: number }>>`
        SELECT COUNT(*)::int AS n
        FROM payment_orders o
        LEFT JOIN tickets t ON t.payment_order_id = o.id
        WHERE o.status = 'paid' AND t.id IS NULL
      `,
      this.prisma.$queryRaw<Array<{ source: string | null; n: number }>>`
        SELECT resolution_source AS source, COUNT(*)::int AS n
        FROM payment_orders
        WHERE updated_at >= ${now}::timestamptz - interval '24 hours'
          AND status <> 'pending_payment'
        GROUP BY resolution_source
      `,
    ]);

    const pendingByAge = {
      under5m: 0,
      under10m: 0,
      under30m: 0,
      under1h: 0,
      over1h: 0,
    };
    for (const row of pendingRows) {
      if (row.bucket in pendingByAge) {
        (pendingByAge as Record<string, number>)[row.bucket] = row.n;
      }
    }

    const resolutionSourceLast24h: Record<string, number> = {};
    for (const row of sourceRows) {
      resolutionSourceLast24h[row.source ?? 'unknown'] = row.n;
    }

    return {
      pendingByAge,
      paidWithoutTicketsCount: paidNoTicketRows[0]?.n ?? 0,
      resolutionSourceLast24h,
    };
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
          resolutionSource: payload.source,
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
    status?: PaymentOrderStatus;
    eventId?: string;
    startDate?: string;
    endDate?: string;
    limit: number;
    offset: number;
  }): Promise<{ total: number; items: PaymentOrder[] }> {
    const where: Prisma.PaymentOrderWhereInput = {};
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
        where,
        orderBy: { createdAt: 'desc' },
        take: filter.limit,
        skip: filter.offset,
      }),
      this.prisma.paymentOrder.count({ where }),
    ]).then(([items, total]) => ({ items, total }));
  }
}
