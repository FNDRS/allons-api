import type { MeService } from '../me/me.service';
import type { PaygateService } from '../paygate/paygate.service';
import type { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';
import { PaymentsReconciliationService } from './payments-reconciliation.service';
import type { PaymentOrdersRepository } from './payment-orders.repository';
import type { PaymentOrder } from './payment-orders.types';

interface Mocks {
  orders: {
    listPendingForReconciliation: jest.Mock;
    listExpiredPending: jest.Mock;
    listPaidWithoutTickets: jest.Mock;
    transitionStatus: jest.Mock;
    canaryStats: jest.Mock;
  };
  paygate: { getPaymentLinkDetail: jest.Mock };
  me: { createTicket: jest.Mock };
  supabaseAdmin: {
    db: { auth: { admin: { getUserById: jest.Mock } } };
  };
}

function buildService(): {
  service: PaymentsReconciliationService;
  mocks: Mocks;
} {
  const mocks: Mocks = {
    orders: {
      listPendingForReconciliation: jest.fn().mockResolvedValue([]),
      listExpiredPending: jest.fn().mockResolvedValue([]),
      listPaidWithoutTickets: jest.fn().mockResolvedValue([]),
      transitionStatus: jest.fn(),
      canaryStats: jest.fn(),
    },
    paygate: { getPaymentLinkDetail: jest.fn() },
    me: { createTicket: jest.fn() },
    supabaseAdmin: {
      db: { auth: { admin: { getUserById: jest.fn() } } },
    },
  };
  const service = new PaymentsReconciliationService(
    mocks.orders as unknown as PaymentOrdersRepository,
    mocks.paygate as unknown as PaygateService,
    mocks.me as unknown as MeService,
    mocks.supabaseAdmin as unknown as SupabaseAdminService,
  );
  return { service, mocks };
}

function fakeOrder(overrides: Partial<PaymentOrder> = {}): PaymentOrder {
  return {
    id: 'order-1',
    userId: 'user-1',
    eventId: 'event-1',
    entryTypeId: null,
    quantity: 1,
    amountCents: 10000,
    currency: 'HNL',
    status: 'pending_payment',
    paygateLinkId: 'pg-link-1',
    paygatePaymentId: null,
    paygateRawWebhook: null,
    resolutionSource: null,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    createdAt: new Date(Date.now() - 30 * 60 * 1000),
    updatedAt: new Date(Date.now() - 30 * 60 * 1000),
    ...overrides,
  };
}

describe('PaymentsReconciliationService.runNightlySweep', () => {
  it('reconciles a stuck pending order that Paygate reports as PROCESSED', async () => {
    const { service, mocks } = buildService();
    const stuck = fakeOrder();
    mocks.orders.listPendingForReconciliation.mockResolvedValue([stuck]);
    mocks.paygate.getPaymentLinkDetail.mockResolvedValue({
      id: 'pg-link-1',
      status: 'PROCESSED',
      numberOfProcesses: 1,
    });
    mocks.orders.transitionStatus.mockResolvedValue({
      applied: true,
      order: { ...stuck, status: 'paid' as const },
    });
    mocks.supabaseAdmin.db.auth.admin.getUserById.mockResolvedValue({
      data: {
        user: { email: 'buyer@example.com', user_metadata: { name: 'Buyer' } },
      },
    });
    mocks.me.createTicket.mockResolvedValue({ createdCount: 1 });

    const result = await service.runNightlySweep();

    expect(mocks.orders.transitionStatus).toHaveBeenCalledWith(
      'order-1',
      expect.objectContaining({ status: 'paid', source: 'cron' }),
    );
    expect(mocks.me.createTicket).toHaveBeenCalledWith(
      'user-1',
      'event-1',
      1,
      expect.objectContaining({
        email: 'buyer@example.com',
        paymentOrderId: 'order-1',
      }),
    );
    expect(result.reconciledPaid).toBe(1);
    expect(result.ticketsBackfilled).toBe(1);
  });

  it('leaves the order alone when Paygate says still pending', async () => {
    const { service, mocks } = buildService();
    mocks.orders.listPendingForReconciliation.mockResolvedValue([fakeOrder()]);
    mocks.paygate.getPaymentLinkDetail.mockResolvedValue({
      id: 'pg-link-1',
      status: 'PENDING',
      numberOfProcesses: 0,
    });

    const result = await service.runNightlySweep();

    expect(mocks.orders.transitionStatus).not.toHaveBeenCalled();
    expect(result.reconciledPaid).toBe(0);
  });

  it('counts a paygate error but keeps sweeping the next order', async () => {
    const { service, mocks } = buildService();
    mocks.orders.listPendingForReconciliation.mockResolvedValue([
      fakeOrder({ id: 'order-a' }),
      fakeOrder({ id: 'order-b' }),
    ]);
    mocks.paygate.getPaymentLinkDetail
      .mockRejectedValueOnce(new Error('paygate boom'))
      .mockResolvedValueOnce({
        id: 'pg-link-1',
        status: 'PROCESSED',
        numberOfProcesses: 1,
      });
    mocks.orders.transitionStatus.mockResolvedValue({
      applied: true,
      order: fakeOrder({ id: 'order-b', status: 'paid' }),
    });
    mocks.supabaseAdmin.db.auth.admin.getUserById.mockResolvedValue({
      data: { user: { email: 'b@example.com', user_metadata: { name: 'B' } } },
    });
    mocks.me.createTicket.mockResolvedValue({ createdCount: 1 });

    const result = await service.runNightlySweep();

    expect(result.paygateErrors).toBe(1);
    expect(result.reconciledPaid).toBe(1);
  });

  it('cancels expired pending orders and tags them cron', async () => {
    const { service, mocks } = buildService();
    mocks.orders.listExpiredPending.mockResolvedValue([
      fakeOrder({ id: 'expired-1' }),
    ]);
    mocks.orders.transitionStatus.mockResolvedValue({
      applied: true,
      order: fakeOrder({ id: 'expired-1', status: 'cancelled' }),
    });

    const result = await service.runNightlySweep();

    expect(mocks.orders.transitionStatus).toHaveBeenCalledWith(
      'expired-1',
      expect.objectContaining({ status: 'cancelled', source: 'cron' }),
    );
    expect(result.expiredCancelled).toBe(1);
  });

  it('backfills tickets for paid orders that have none', async () => {
    const { service, mocks } = buildService();
    mocks.orders.listPaidWithoutTickets.mockResolvedValue([
      fakeOrder({ status: 'paid' }),
    ]);
    mocks.supabaseAdmin.db.auth.admin.getUserById.mockResolvedValue({
      data: { user: { email: 'x@y.com', user_metadata: { name: 'X' } } },
    });
    mocks.me.createTicket.mockResolvedValue({ createdCount: 1 });

    const result = await service.runNightlySweep();

    expect(result.ticketsBackfilled).toBe(1);
    expect(mocks.me.createTicket).toHaveBeenCalled();
  });

  it('records lastSweep snapshot and totals', async () => {
    const { service } = buildService();
    await service.runNightlySweep();
    const snapshot = service.getLastSweep();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.scanned).toBe(0);
    expect(typeof snapshot?.durationMs).toBe('number');
  });
});

describe('PaymentsReconciliationService.runCanaryCheck', () => {
  it('does not warn when everything is healthy', async () => {
    const { service, mocks } = buildService();
    mocks.orders.canaryStats.mockResolvedValue({
      pendingByAge: {
        under5m: 2,
        under10m: 0,
        under30m: 0,
        under1h: 0,
        over1h: 0,
      },
      paidWithoutTicketsCount: 0,
      resolutionSourceLast24h: { webhook: 10, polling: 2 },
    });
    const warn = jest.fn();
    (service as unknown as { logger: { warn: jest.Mock } }).logger = {
      warn,
    };

    await service.runCanaryCheck();
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns when orders are stuck > 10m', async () => {
    const { service, mocks } = buildService();
    mocks.orders.canaryStats.mockResolvedValue({
      pendingByAge: {
        under5m: 0,
        under10m: 0,
        under30m: 1,
        under1h: 2,
        over1h: 3,
      },
      paidWithoutTicketsCount: 0,
      resolutionSourceLast24h: { webhook: 4, polling: 2 },
    });
    const warn = jest.fn();
    (service as unknown as { logger: { warn: jest.Mock } }).logger = {
      warn,
    };

    await service.runCanaryCheck();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('pending_payment > 10m'),
    );
  });

  it('warns when 0/N resolutions came via webhook in last 24h', async () => {
    const { service, mocks } = buildService();
    mocks.orders.canaryStats.mockResolvedValue({
      pendingByAge: {
        under5m: 0,
        under10m: 0,
        under30m: 0,
        under1h: 0,
        over1h: 0,
      },
      paidWithoutTicketsCount: 0,
      resolutionSourceLast24h: { polling: 12 },
    });
    const warn = jest.fn();
    (service as unknown as { logger: { warn: jest.Mock } }).logger = {
      warn,
    };

    await service.runCanaryCheck();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('webhook may be misconfigured'),
    );
  });

  it('warns about paid orders missing tickets', async () => {
    const { service, mocks } = buildService();
    mocks.orders.canaryStats.mockResolvedValue({
      pendingByAge: {
        under5m: 0,
        under10m: 0,
        under30m: 0,
        under1h: 0,
        over1h: 0,
      },
      paidWithoutTicketsCount: 3,
      resolutionSourceLast24h: { webhook: 2, polling: 1 },
    });
    const warn = jest.fn();
    (service as unknown as { logger: { warn: jest.Mock } }).logger = {
      warn,
    };

    await service.runCanaryCheck();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('paid without tickets'),
    );
  });
});
