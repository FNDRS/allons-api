import { Injectable } from '@nestjs/common';
import type { Refund } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';

export type RefundStatus =
  | 'requested'
  | 'skipped_policy'
  | 'approved'
  | 'paid'
  | 'denied'
  | 'failed';

export type RefundReason =
  | 'user_cancelled'
  | 'provider_cancelled'
  | 'duplicate_charge';

export interface CreateForCancelInput {
  paymentOrderId: string;
  ticketId: string | null;
  userId: string;
  amountCents: number;
  currency: string;
  reason: RefundReason;
  status: Extract<RefundStatus, 'requested' | 'skipped_policy'>;
  policyEligibleAtRequest: boolean;
  policyDeadlineHoursAtRequest: number | null;
  paygatePaymentId: string | null;
}

/**
 * Data-access for the `refunds` table. Owns the audit + state record
 * that today is written on user-initiated ticket cancellation and is
 * the consumption surface for the future provider approval queue and
 * Paygate refund automation.
 */
@Injectable()
export class RefundsRepository {
  constructor(private readonly prisma: PrismaService) {}

  createForCancel(input: CreateForCancelInput): Promise<Refund> {
    return this.prisma.refund.create({
      data: {
        paymentOrderId: input.paymentOrderId,
        ticketId: input.ticketId,
        userId: input.userId,
        amountCents: input.amountCents,
        currency: input.currency,
        reason: input.reason,
        status: input.status,
        policyEligibleAtRequest: input.policyEligibleAtRequest,
        policyDeadlineHoursAtRequest: input.policyDeadlineHoursAtRequest,
        paygatePaymentId: input.paygatePaymentId,
      },
    });
  }

  /** Pending queue for the future provider approval screen. */
  listPending(limit = 50): Promise<Refund[]> {
    return this.prisma.refund.findMany({
      where: { status: { in: ['requested', 'approved', 'failed'] } },
      orderBy: { requestedAt: 'asc' },
      take: limit,
    });
  }

  /** History for the future user-facing "Mis reembolsos" screen. */
  listForUser(userId: string, limit = 50): Promise<Refund[]> {
    return this.prisma.refund.findMany({
      where: { userId },
      orderBy: { requestedAt: 'desc' },
      take: limit,
    });
  }

  listAdmin(input: {
    status?: RefundStatus;
    limit: number;
    offset: number;
  }): Promise<Refund[]> {
    return this.prisma.refund.findMany({
      where: input.status ? { status: input.status } : undefined,
      orderBy: { requestedAt: 'desc' },
      take: input.limit,
      skip: input.offset,
    });
  }

  countAdmin(status?: RefundStatus): Promise<number> {
    return this.prisma.refund.count({
      where: status ? { status } : undefined,
    });
  }

  async countsByStatus(): Promise<Record<string, number>> {
    const rows = await this.prisma.refund.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const out: Record<string, number> = {};
    for (const row of rows) {
      out[row.status] = row._count._all;
    }
    return out;
  }

  async sumPaidLast30dCents(): Promise<number> {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const agg = await this.prisma.refund.aggregate({
      where: { status: 'paid', resolvedAt: { gte: since } },
      _sum: { amountCents: true },
    });
    return agg._sum.amountCents ?? 0;
  }
}
