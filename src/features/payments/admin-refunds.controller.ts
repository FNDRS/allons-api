import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminSecretGuard } from '../admin/admin-secret.guard';
import { RefundsRepository, type RefundStatus } from './refunds.repository';

const REFUND_STATUSES: RefundStatus[] = [
  'requested',
  'skipped_policy',
  'approved',
  'paid',
  'denied',
  'failed',
];

function parseStatus(value: string | undefined): RefundStatus | undefined {
  if (!value) return undefined;
  return (REFUND_STATUSES as string[]).includes(value)
    ? (value as RefundStatus)
    : undefined;
}

function parseLimit(value: string | undefined, fallback: number, max: number) {
  const n = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function parseOffset(value: string | undefined) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

@UseGuards(AdminSecretGuard)
@Controller('admin/refunds')
export class AdminRefundsController {
  constructor(private readonly refunds: RefundsRepository) {}

  @Get('summary')
  async summary() {
    const [byStatus, paid30d] = await Promise.all([
      this.refunds.countsByStatus(),
      this.refunds.sumPaidLast30dCents(),
    ]);
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    return {
      total,
      byStatus,
      paidLast30dCents: paid30d,
      lastUpdated: new Date().toISOString(),
    };
  }

  @Get()
  async list(
    @Query('status') statusRaw?: string,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
  ) {
    const status = parseStatus(statusRaw);
    const limit = parseLimit(limitRaw, 50, 200);
    const offset = parseOffset(offsetRaw);

    const [items, total] = await Promise.all([
      this.refunds.listAdmin({ status, limit, offset }),
      this.refunds.countAdmin(status),
    ]);

    return {
      total,
      items: items.map((r) => ({
        id: r.id,
        paymentOrderId: r.paymentOrderId,
        ticketId: r.ticketId,
        userId: r.userId,
        amountCents: r.amountCents,
        currency: r.currency,
        reason: r.reason,
        status: r.status,
        policyEligibleAtRequest: r.policyEligibleAtRequest,
        policyDeadlineHoursAtRequest: r.policyDeadlineHoursAtRequest,
        paygatePaymentId: r.paygatePaymentId,
        notes: r.notes,
        requestedAt: r.requestedAt.toISOString(),
        resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
      })),
    };
  }
}
