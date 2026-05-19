import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { MeService } from '../me/me.service';
import type { PaygateService } from '../paygate/paygate.service';
import { MePaymentsService } from './me-payments.service';
import type { PaymentOrdersRepository } from './payment-orders.repository';
import type { PaymentOrder } from './payment-orders.types';

interface Mocks {
  prisma: {
    event: { findUnique: jest.Mock };
    paymentOrder: { count: jest.Mock };
    ticket: { count: jest.Mock; findMany: jest.Mock };
    $queryRaw: jest.Mock;
  };
  paygate: {
    createPaymentLink: jest.Mock;
    getPaymentLinkDetail: jest.Mock;
  };
  orders: {
    create: jest.Mock;
    findById: jest.Mock;
    listForUser: jest.Mock;
    transitionStatus: jest.Mock;
  };
  me: {
    captureReferralCode: jest.Mock;
    getReferralCheckoutPreview: jest.Mock;
    createTicket: jest.Mock;
  };
  supabaseAdmin: {
    db: {
      auth: { admin: { getUserById: jest.Mock } };
    };
  };
}

function buildService(): { service: MePaymentsService; mocks: Mocks } {
  const mocks: Mocks = {
    prisma: {
      event: { findUnique: jest.fn() },
      paymentOrder: { count: jest.fn() },
      ticket: { count: jest.fn(), findMany: jest.fn() },
      $queryRaw: jest.fn(),
    },
    paygate: {
      createPaymentLink: jest.fn(),
      getPaymentLinkDetail: jest.fn(),
    },
    orders: {
      create: jest.fn(),
      findById: jest.fn(),
      listForUser: jest.fn(),
      transitionStatus: jest.fn(),
    },
    me: {
      captureReferralCode: jest.fn(),
      getReferralCheckoutPreview: jest.fn(),
      createTicket: jest.fn(),
    },
    supabaseAdmin: {
      db: { auth: { admin: { getUserById: jest.fn() } } },
    },
  };
  const service = new MePaymentsService(
    mocks.prisma as unknown as PrismaService,
    mocks.paygate as unknown as PaygateService,
    mocks.orders as unknown as PaymentOrdersRepository,
    mocks.me as unknown as MeService,
    mocks.supabaseAdmin as unknown as import('../../shared/supabase/supabase-admin.service').SupabaseAdminService,
    {
      paymentsEnabled: true,
      forceFreeEvents: false,
    } as any,
    { event: jest.fn(), warn: jest.fn(), error: jest.fn() } as any,
  );
  mocks.prisma.paymentOrder.count.mockResolvedValue(0);
  return { service, mocks };
}

function fakeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1',
    title: 'Test Event',
    ticketMode: 'paid',
    capacity: 100,
    themeColor: null,
    providerId: 'provider-1',
    ...overrides,
  };
}

function fakeLink(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pg-link-1',
    link: 'https://stage.paygate.biz/checkout/pg-link-1',
    amount: 100,
    subtotal: 100,
    tax: 0,
    description: 'Ticket - Test Event',
    expires: true,
    expirationHours: 2,
    currency: 'HNL',
    numberOfProcesses: 0,
    isOpenAmount: false,
    ...overrides,
  };
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
    expiresAt: new Date('2026-05-14T22:00:00Z'),
    createdAt: new Date('2026-05-14T20:00:00Z'),
    updatedAt: new Date('2026-05-14T20:00:00Z'),
    ...overrides,
  };
}

describe('MePaymentsService.initiatePayment', () => {
  it('rejects unknown events with 404', async () => {
    const { service, mocks } = buildService();
    mocks.prisma.event.findUnique.mockResolvedValue(null);

    await expect(
      service.initiatePayment('user-1', { eventId: 'missing', quantity: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects quantity outside [1, 20]', async () => {
    const { service, mocks } = buildService();
    mocks.prisma.event.findUnique.mockResolvedValue(fakeEvent());

    await expect(
      service.initiatePayment('user-1', { eventId: 'event-1', quantity: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.initiatePayment('user-1', { eventId: 'event-1', quantity: 21 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects events whose ticketMode is "free"', async () => {
    const { service, mocks } = buildService();
    mocks.prisma.event.findUnique.mockResolvedValue(
      fakeEvent({ ticketMode: 'free' }),
    );

    await expect(
      service.initiatePayment('user-1', { eventId: 'event-1', quantity: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when the event has no priced ticket type', async () => {
    const { service, mocks } = buildService();
    mocks.prisma.event.findUnique.mockResolvedValue(fakeEvent());
    mocks.prisma.$queryRaw.mockResolvedValue([]); // no ticket types

    await expect(
      service.initiatePayment('user-1', { eventId: 'event-1', quantity: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when the price lookup throws (DB error)', async () => {
    const { service, mocks } = buildService();
    mocks.prisma.event.findUnique.mockResolvedValue(fakeEvent());
    mocks.prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));

    await expect(
      service.initiatePayment('user-1', { eventId: 'event-1', quantity: 1 }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('rejects when the requested quantity exceeds remaining capacity', async () => {
    const { service, mocks } = buildService();
    mocks.prisma.event.findUnique.mockResolvedValue(fakeEvent({ capacity: 5 }));
    mocks.prisma.$queryRaw.mockResolvedValue([{ price: 100 }]);
    mocks.prisma.ticket.count.mockResolvedValue(4);
    mocks.me.getReferralCheckoutPreview.mockResolvedValue({
      enabled: false,
      eligible: false,
      discountValueCents: 0,
    });

    await expect(
      service.initiatePayment('user-1', { eventId: 'event-1', quantity: 2 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('builds a Paygate link with the full amount when no referral discount applies', async () => {
    const { service, mocks } = buildService();
    mocks.prisma.event.findUnique.mockResolvedValue(fakeEvent());
    mocks.prisma.$queryRaw.mockResolvedValue([{ price: 50 }]);
    mocks.prisma.ticket.count.mockResolvedValue(0);
    mocks.me.getReferralCheckoutPreview.mockResolvedValue({
      enabled: false,
      eligible: false,
      discountValueCents: 0,
    });
    mocks.paygate.createPaymentLink.mockResolvedValue(fakeLink());
    mocks.orders.create.mockImplementation((input) =>
      fakeOrder({
        ...input,
        id: 'order-1',
        status: 'pending_payment',
      }),
    );

    const result = await service.initiatePayment('user-1', {
      eventId: 'event-1',
      quantity: 2,
    });

    // 50 HNL * 2 = 10000 cents
    expect(mocks.paygate.createPaymentLink).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 100, currency: 'HNL' }),
    );
    expect(mocks.orders.create).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 10000, quantity: 2 }),
    );
    expect(result).toMatchObject({
      orderId: 'order-1',
      paymentLink: 'https://stage.paygate.biz/checkout/pg-link-1',
      amountCents: 10000,
      currency: 'HNL',
      discount: null,
    });
  });

  it('captures the referral code and subtracts the eligible discount before pricing the Paygate link', async () => {
    const { service, mocks } = buildService();
    mocks.prisma.event.findUnique.mockResolvedValue(fakeEvent());
    mocks.prisma.$queryRaw.mockResolvedValue([{ price: 100 }]); // 100 HNL
    mocks.prisma.ticket.count.mockResolvedValue(0);
    mocks.me.captureReferralCode.mockResolvedValue({ ok: true });
    mocks.me.getReferralCheckoutPreview.mockResolvedValue({
      enabled: true,
      eligible: true,
      discountValueCents: 2000, // 20 HNL off
    });
    mocks.paygate.createPaymentLink.mockResolvedValue(fakeLink({ amount: 80 }));
    mocks.orders.create.mockImplementation((input) =>
      fakeOrder({ ...input, id: 'order-1' }),
    );

    const result = await service.initiatePayment('user-1', {
      eventId: 'event-1',
      quantity: 1,
      referralCode: '  ABC123  ',
    });

    expect(mocks.me.captureReferralCode).toHaveBeenCalledWith(
      'user-1',
      'ABC123', // trimmed
    );
    // 100 HNL - 20 HNL = 80 HNL = 8000 cents
    expect(mocks.paygate.createPaymentLink).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 80 }),
    );
    expect(mocks.orders.create).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 8000 }),
    );
    expect(result.discount).toEqual({ cents: 2000 });
  });

  it('caps the referral discount at the gross amount (never charge negative)', async () => {
    const { service, mocks } = buildService();
    mocks.prisma.event.findUnique.mockResolvedValue(fakeEvent());
    mocks.prisma.$queryRaw.mockResolvedValue([{ price: 10 }]); // 10 HNL = 1000 cents
    mocks.prisma.ticket.count.mockResolvedValue(0);
    mocks.me.getReferralCheckoutPreview.mockResolvedValue({
      enabled: true,
      eligible: true,
      discountValueCents: 5000, // 50 HNL off — bigger than the cart
    });

    await expect(
      service.initiatePayment('user-1', { eventId: 'event-1', quantity: 1 }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('0'),
    });

    // No order persisted, no Paygate call made.
    expect(mocks.paygate.createPaymentLink).not.toHaveBeenCalled();
    expect(mocks.orders.create).not.toHaveBeenCalled();
  });

  it('treats a captureReferralCode failure as a no-op (paid flow keeps going)', async () => {
    const { service, mocks } = buildService();
    mocks.prisma.event.findUnique.mockResolvedValue(fakeEvent());
    mocks.prisma.$queryRaw.mockResolvedValue([{ price: 100 }]);
    mocks.prisma.ticket.count.mockResolvedValue(0);
    mocks.me.captureReferralCode.mockRejectedValue(new Error('bad code'));
    mocks.me.getReferralCheckoutPreview.mockResolvedValue({
      enabled: true,
      eligible: false,
      discountValueCents: 0,
    });
    mocks.paygate.createPaymentLink.mockResolvedValue(fakeLink());
    mocks.orders.create.mockImplementation((input) =>
      fakeOrder({ ...input, id: 'order-1' }),
    );

    await expect(
      service.initiatePayment('user-1', {
        eventId: 'event-1',
        quantity: 1,
        referralCode: 'BAD',
      }),
    ).resolves.toMatchObject({ orderId: 'order-1', discount: null });
  });
});

describe('MePaymentsService.getOrder', () => {
  const expired = new Date('2026-05-14T22:00:00Z');
  const realNow = Date;

  afterEach(() => {
    global.Date = realNow;
  });

  it('returns 404 when the order does not exist', async () => {
    const { service, mocks } = buildService();
    mocks.orders.findById.mockResolvedValue(null);

    await expect(service.getOrder('user-1', 'order-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns 403 when the order belongs to a different user', async () => {
    const { service, mocks } = buildService();
    mocks.orders.findById.mockResolvedValue(
      fakeOrder({ userId: 'someone-else' }),
    );

    await expect(service.getOrder('user-1', 'order-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('reports cancelled (lazy expiration) when the order is pending and the link has expired', async () => {
    const { service, mocks } = buildService();
    mocks.orders.findById.mockResolvedValue(
      fakeOrder({
        status: 'pending_payment',
        expiresAt: new Date('2026-05-14T20:00:00Z'),
      }),
    );
    mocks.prisma.ticket.findMany.mockResolvedValue([]);
    jest.spyOn(global, 'Date').mockImplementation((...args: unknown[]) => {
      if (args.length === 0) return new realNow('2026-05-14T22:00:00Z');
      return new realNow(...(args as ConstructorParameters<typeof realNow>));
    });

    const result = await service.getOrder('user-1', 'order-1');

    expect(result.status).toBe('cancelled');
    expect(result.ticketIds).toEqual([]);
  });

  it('returns the ticketIds when the order is paid', async () => {
    const { service, mocks } = buildService();
    mocks.orders.findById.mockResolvedValue(
      fakeOrder({ status: 'paid', expiresAt: expired }),
    );
    mocks.prisma.ticket.findMany.mockResolvedValue([
      { id: 'ticket-1' },
      { id: 'ticket-2' },
    ]);

    const result = await service.getOrder('user-1', 'order-1');

    expect(result.status).toBe('paid');
    expect(result.ticketIds).toEqual(['ticket-1', 'ticket-2']);
  });
});

describe('MePaymentsService.getOrder — Paygate polling reconciliation', () => {
  const TEN_SECONDS_AGO = new Date(Date.now() - 10_000);
  const ONE_HOUR_AHEAD = new Date(Date.now() + 60 * 60 * 1000);
  const fakePaidLinkDetail = {
    id: 'pg-link-1',
    link: 'https://stage.paygate.biz/checkout/pg-link-1',
    amount: 100,
    subtotal: 100,
    tax: 0,
    description: 'Ticket - Test Event',
    expires: true,
    expirationHours: 2,
    currency: 'HNL',
    numberOfProcesses: 1,
    isOpenAmount: false,
    status: 'PROCESSED',
  };

  it('skips reconciliation when the order is fresh (< grace window)', async () => {
    const { service, mocks } = buildService();
    mocks.orders.findById.mockResolvedValue(
      fakeOrder({
        status: 'pending_payment',
        paygateLinkId: 'pg-link-1',
        createdAt: new Date(),
      }),
    );
    mocks.prisma.ticket.findMany.mockResolvedValue([]);

    await service.getOrder('user-1', 'order-1');

    expect(mocks.paygate.getPaymentLinkDetail).not.toHaveBeenCalled();
    expect(mocks.orders.transitionStatus).not.toHaveBeenCalled();
  });

  it('returns the stored state when Paygate still says pending', async () => {
    const { service, mocks } = buildService();
    mocks.orders.findById.mockResolvedValue(
      fakeOrder({
        status: 'pending_payment',
        paygateLinkId: 'pg-link-1',
        createdAt: TEN_SECONDS_AGO,
        expiresAt: ONE_HOUR_AHEAD,
      }),
    );
    mocks.prisma.ticket.findMany.mockResolvedValue([]);
    mocks.paygate.getPaymentLinkDetail.mockResolvedValue({
      ...fakePaidLinkDetail,
      status: 'PENDING',
      numberOfProcesses: 0,
    });

    const result = await service.getOrder('user-1', 'order-1');

    expect(mocks.paygate.getPaymentLinkDetail).toHaveBeenCalledWith(
      'pg-link-1',
    );
    expect(mocks.orders.transitionStatus).not.toHaveBeenCalled();
    expect(result.status).toBe('pending_payment');
  });

  it('transitions to paid and mints tickets when Paygate says PROCESSED', async () => {
    const { service, mocks } = buildService();
    const pendingOrder = fakeOrder({
      status: 'pending_payment',
      paygateLinkId: 'pg-link-1',
      createdAt: TEN_SECONDS_AGO,
      expiresAt: ONE_HOUR_AHEAD,
    });
    const paidOrder = { ...pendingOrder, status: 'paid' as const };

    mocks.orders.findById.mockResolvedValue(pendingOrder);
    mocks.prisma.ticket.findMany.mockResolvedValue([{ id: 'ticket-1' }]);
    mocks.paygate.getPaymentLinkDetail.mockResolvedValue(fakePaidLinkDetail);
    mocks.orders.transitionStatus.mockResolvedValue({
      applied: true,
      order: paidOrder,
    });
    mocks.supabaseAdmin.db.auth.admin.getUserById.mockResolvedValue({
      data: {
        user: { email: 'buyer@example.com', user_metadata: { name: 'Buyer' } },
      },
      error: null,
    });
    mocks.me.createTicket.mockResolvedValue({ createdCount: 1 });

    const result = await service.getOrder('user-1', 'order-1');

    expect(mocks.orders.transitionStatus).toHaveBeenCalledWith(
      pendingOrder.id,
      expect.objectContaining({
        status: 'paid',
        paygatePaymentId: fakePaidLinkDetail.id,
      }),
    );
    expect(mocks.me.createTicket).toHaveBeenCalledWith(
      pendingOrder.userId,
      pendingOrder.eventId,
      pendingOrder.quantity,
      expect.objectContaining({
        email: 'buyer@example.com',
        paymentOrderId: pendingOrder.id,
      }),
    );
    expect(result.status).toBe('paid');
  });

  it('re-reads the order when transition is a no-op (webhook beat us)', async () => {
    const { service, mocks } = buildService();
    const pending = fakeOrder({
      status: 'pending_payment',
      paygateLinkId: 'pg-link-1',
      createdAt: TEN_SECONDS_AGO,
      expiresAt: ONE_HOUR_AHEAD,
    });
    const alreadyPaid = { ...pending, status: 'paid' as const };

    mocks.orders.findById
      .mockResolvedValueOnce(pending) // initial lookup
      .mockResolvedValueOnce(alreadyPaid); // re-read after transition no-op
    mocks.prisma.ticket.findMany.mockResolvedValue([{ id: 'ticket-1' }]);
    mocks.paygate.getPaymentLinkDetail.mockResolvedValue(fakePaidLinkDetail);
    mocks.orders.transitionStatus.mockResolvedValue({
      applied: false,
      reason: 'not_pending',
    });

    const result = await service.getOrder('user-1', 'order-1');

    expect(mocks.me.createTicket).not.toHaveBeenCalled();
    expect(result.status).toBe('paid');
  });

  it('does not throw when Paygate is unreachable — falls back to stored state', async () => {
    const { service, mocks } = buildService();
    mocks.orders.findById.mockResolvedValue(
      fakeOrder({
        status: 'pending_payment',
        paygateLinkId: 'pg-link-1',
        createdAt: TEN_SECONDS_AGO,
        expiresAt: ONE_HOUR_AHEAD,
      }),
    );
    mocks.prisma.ticket.findMany.mockResolvedValue([]);
    mocks.paygate.getPaymentLinkDetail.mockRejectedValue(
      new Error('Paygate is down'),
    );

    const result = await service.getOrder('user-1', 'order-1');

    expect(mocks.orders.transitionStatus).not.toHaveBeenCalled();
    expect(result.status).toBe('pending_payment');
  });

  it('does not reconcile when the order has no paygate_link_id', async () => {
    const { service, mocks } = buildService();
    mocks.orders.findById.mockResolvedValue(
      fakeOrder({
        status: 'pending_payment',
        paygateLinkId: null as unknown as string,
        createdAt: TEN_SECONDS_AGO,
        expiresAt: ONE_HOUR_AHEAD,
      }),
    );
    mocks.prisma.ticket.findMany.mockResolvedValue([]);

    await service.getOrder('user-1', 'order-1');

    expect(mocks.paygate.getPaymentLinkDetail).not.toHaveBeenCalled();
  });
});

describe('MePaymentsService.listOrders', () => {
  it('maps repository rows to the response shape', async () => {
    const { service, mocks } = buildService();
    mocks.orders.listForUser.mockResolvedValue([
      fakeOrder({ id: 'a' }),
      fakeOrder({ id: 'b', status: 'paid' }),
    ]);

    const result = await service.listOrders('user-1');

    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toMatchObject({
      orderId: 'a',
      status: 'pending_payment',
    });
    expect(result.data[1]).toMatchObject({ orderId: 'b', status: 'paid' });
  });
});
