import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminSecretGuard } from '../admin/admin-secret.guard';
import { PaymentOrdersRepository } from './payment-orders.repository';
import { PaymentsReconciliationService } from './payments-reconciliation.service';

/**
 * Operational endpoints for the payments pipeline. Guarded by the
 * existing admin secret header (`AdminSecretGuard`) — same access
 * pattern as every other `/admin/*` route, no user token required.
 *
 * Exposed routes:
 *   GET /admin/payments/canary  — counters for monitoring
 *   POST /admin/payments/sweep  — manual trigger of the nightly cron
 */
@UseGuards(AdminSecretGuard)
@Controller('admin/payments')
export class AdminPaymentsController {
  constructor(
    private readonly orders: PaymentOrdersRepository,
    private readonly reconciliation: PaymentsReconciliationService,
  ) {}

  @Get('canary')
  async canary() {
    const stats = await this.orders.canaryStats(new Date());
    const totalResolved = Object.values(stats.resolutionSourceLast24h).reduce(
      (a, b) => a + b,
      0,
    );
    const longPending =
      stats.pendingByAge.under30m +
      stats.pendingByAge.under1h +
      stats.pendingByAge.over1h;

    return {
      checkedAt: new Date().toISOString(),
      pendingByAge: stats.pendingByAge,
      paidWithoutTickets: stats.paidWithoutTicketsCount,
      resolutionSourceLast24h: stats.resolutionSourceLast24h,
      lastSweep: this.reconciliation.getLastSweep(),
      alerts: buildAlerts({
        longPending,
        paidWithoutTicketsCount: stats.paidWithoutTicketsCount,
        resolutionSource: stats.resolutionSourceLast24h,
        totalResolved,
      }),
    };
  }

  @Get('sweep')
  async sweep() {
    return this.reconciliation.runNightlySweep();
  }
}

function buildAlerts(input: {
  longPending: number;
  paidWithoutTicketsCount: number;
  resolutionSource: Record<string, number>;
  totalResolved: number;
}): string[] {
  const alerts: string[] = [];
  if (input.longPending > 0) {
    alerts.push(
      `${input.longPending} order(s) pending_payment > 10m — manual review or wait for next sweep`,
    );
  }
  if (input.paidWithoutTicketsCount > 0) {
    alerts.push(
      `${input.paidWithoutTicketsCount} order(s) paid without tickets — ticket creation failed after transition`,
    );
  }
  if (input.totalResolved >= 5 && (input.resolutionSource.webhook ?? 0) === 0) {
    alerts.push(
      `0/${input.totalResolved} of last-24h resolutions came via webhook — webhook URL or signature config likely broken`,
    );
  }
  if (
    input.totalResolved >= 5 &&
    (input.resolutionSource.polling ?? 0) === 0 &&
    (input.resolutionSource.cron ?? 0) === 0
  ) {
    alerts.push(
      `Reconciliation paths haven't fired in 24h — polling/cron may not be running`,
    );
  }
  return alerts;
}
