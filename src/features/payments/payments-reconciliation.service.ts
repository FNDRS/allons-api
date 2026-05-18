import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';
import { MeService } from '../me/me.service';
import { PaygateService } from '../paygate/paygate.service';
import { PaymentOrdersRepository } from './payment-orders.repository';
import type { PaymentOrder } from './payment-orders.types';

/**
 * Stuck orders younger than this don't get touched by the cron — the
 * mobile-side poller (4 s grace) reaches them first while the user is
 * still on the checkout screen. Cron only deals with abandonment.
 */
const STUCK_MIN_AGE_MS = 5 * 60 * 1000;

export interface SweepResult {
  scanned: number;
  reconciledPaid: number;
  expiredCancelled: number;
  ticketsBackfilled: number;
  paygateErrors: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

/**
 * Periodic safety net for the payments pipeline. Two responsibilities:
 *
 *  - Nightly sweep: walk every order still in `pending_payment`,
 *    ask Paygate for the canonical state, and either fulfill (mint
 *    tickets + transition to paid) or expire (mark as cancelled when
 *    the link TTL has already passed).
 *  - Hourly canary: emit structured warn logs when the inflight
 *    counters cross simple thresholds. Doesn't fix anything; gives
 *    monitoring tooling a thing to alert on.
 *
 * Both jobs are also exposed as plain methods so the admin endpoint
 * can trigger them manually on demand (`GET /admin/payments/sweep`
 * style flows, kept out of scope here).
 */
@Injectable()
export class PaymentsReconciliationService {
  private readonly logger = new Logger(PaymentsReconciliationService.name);
  private lastSweep: SweepResult | null = null;

  constructor(
    private readonly orders: PaymentOrdersRepository,
    private readonly paygate: PaygateService,
    private readonly me: MeService,
    private readonly supabaseAdmin: SupabaseAdminService,
  ) {}

  /** Snapshot of the last completed cron sweep (or `null` pre-boot). */
  getLastSweep(): SweepResult | null {
    return this.lastSweep;
  }

  /**
   * Runs every night at 03:00 server time. The sweep is bounded: it
   * only touches orders older than 5 minutes (immediate fulfillment
   * paths have had their turn) and only contacts Paygate for rows
   * that still carry a `paygate_link_id`.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, {
    name: 'payments-nightly-sweep',
    timeZone: 'America/Tegucigalpa',
  })
  async runNightlySweep(): Promise<SweepResult> {
    const startedAt = new Date();
    const stats = {
      scanned: 0,
      reconciledPaid: 0,
      expiredCancelled: 0,
      ticketsBackfilled: 0,
      paygateErrors: 0,
    };

    this.logger.log(
      `[reconciliation] nightly sweep starting at ${startedAt.toISOString()}`,
    );

    const stuck = await this.orders.listPendingForReconciliation(
      startedAt,
      STUCK_MIN_AGE_MS,
    );
    stats.scanned = stuck.length;
    for (const order of stuck) {
      await this.reconcileOne(order, stats);
    }

    const expired = await this.orders.listExpiredPending(startedAt);
    for (const order of expired) {
      const result = await this.orders.transitionStatus(order.id, {
        status: 'cancelled',
        source: 'cron',
      });
      if (result.applied) {
        stats.expiredCancelled += 1;
      }
    }

    const paidNoTickets = await this.orders.listPaidWithoutTickets(50);
    for (const order of paidNoTickets) {
      const minted = await this.tryMintTickets(order, 'cron-backfill');
      if (minted) stats.ticketsBackfilled += 1;
    }

    const finishedAt = new Date();
    this.lastSweep = {
      ...stats,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    };

    this.logger.log(
      `[reconciliation] sweep done scanned=${stats.scanned} reconciledPaid=${stats.reconciledPaid} expiredCancelled=${stats.expiredCancelled} ticketsBackfilled=${stats.ticketsBackfilled} paygateErrors=${stats.paygateErrors} durationMs=${this.lastSweep.durationMs}`,
    );
    return this.lastSweep;
  }

  /**
   * Runs once an hour. Doesn't fix anything; just emits one warn log
   * when the canary thresholds are crossed so external monitoring can
   * alert. Thresholds are deliberately conservative — most healthy
   * systems will never trip them.
   */
  @Cron(CronExpression.EVERY_HOUR, {
    name: 'payments-hourly-canary',
    timeZone: 'America/Tegucigalpa',
  })
  async runCanaryCheck(): Promise<void> {
    const stats = await this.orders.canaryStats(new Date());
    const longPending =
      stats.pendingByAge.under30m +
      stats.pendingByAge.under1h +
      stats.pendingByAge.over1h;
    if (longPending > 0) {
      this.logger.warn(
        `[canary] ${longPending} order(s) pending_payment > 10m (under30m=${stats.pendingByAge.under30m} under1h=${stats.pendingByAge.under1h} over1h=${stats.pendingByAge.over1h})`,
      );
    }
    if (stats.paidWithoutTicketsCount > 0) {
      this.logger.warn(
        `[canary] ${stats.paidWithoutTicketsCount} order(s) paid without tickets — needs cron sweep or manual review`,
      );
    }
    const sources = stats.resolutionSourceLast24h;
    const totalResolved = Object.values(sources).reduce((a, b) => a + b, 0);
    if (totalResolved >= 5 && (sources.webhook ?? 0) === 0) {
      this.logger.warn(
        `[canary] 0/${totalResolved} of last-24h resolutions came via webhook — webhook may be misconfigured`,
      );
    }
  }

  private async reconcileOne(
    order: PaymentOrder,
    stats: {
      reconciledPaid: number;
      ticketsBackfilled: number;
      paygateErrors: number;
    },
  ): Promise<void> {
    if (!order.paygateLinkId) return;
    let detail;
    try {
      detail = await this.paygate.getPaymentLinkDetail(order.paygateLinkId);
    } catch (err) {
      stats.paygateErrors += 1;
      this.logger.warn(
        `[reconciliation] paygate fetch failed order=${order.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return;
    }

    const looksPaid =
      detail.status?.toUpperCase() === 'PROCESSED' ||
      (detail.numberOfProcesses ?? 0) > 0;
    if (!looksPaid) return;

    const transition = await this.orders.transitionStatus(order.id, {
      status: 'paid',
      paygatePaymentId: detail.id,
      paygateRawWebhook: detail,
      source: 'cron',
    });
    if (!transition.applied) return;

    stats.reconciledPaid += 1;
    const minted = await this.tryMintTickets(transition.order, 'cron-fulfill');
    if (minted) stats.ticketsBackfilled += 1;
  }

  /**
   * Mints tickets for a `paid` order that doesn't have any. Best
   * effort; the order stays `paid` regardless. Returns whether
   * tickets were actually created (so the sweep stats stay honest).
   */
  private async tryMintTickets(
    order: PaymentOrder,
    label: string,
  ): Promise<boolean> {
    try {
      const { data } = await this.supabaseAdmin.db.auth.admin.getUserById(
        order.userId,
      );
      const email = data?.user?.email ?? null;
      const meta = data?.user?.user_metadata as { name?: unknown } | null;
      const name = typeof meta?.name === 'string' ? meta.name : null;
      if (!email) {
        this.logger.error(
          `[reconciliation] ${label}: missing email for user=${order.userId} order=${order.id}`,
        );
        return false;
      }
      await this.me.createTicket(order.userId, order.eventId, order.quantity, {
        email,
        name,
        holders: [],
        paymentOrderId: order.id,
      });
      this.logger.log(
        `[reconciliation] ${label}: minted ${order.quantity} ticket(s) for order=${order.id}`,
      );
      return true;
    } catch (err) {
      this.logger.error(
        `[reconciliation] ${label}: ticket creation failed for order=${order.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  }
}
