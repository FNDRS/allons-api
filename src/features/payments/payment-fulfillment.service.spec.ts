import type { PrismaService } from '../../prisma/prisma.service';
import type { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';
import type { MeService } from '../me/me.service';
import { PaymentFulfillmentService } from './payment-fulfillment.service';
import type { PaymentOrder } from './payment-orders.types';

function buildService() {
  const prisma = {
    userClassPass: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    },
    classPackage: { findUnique: jest.fn() },
    event: { findUnique: jest.fn() },
    ticket: { count: jest.fn() },
  };
  const me = { createTicket: jest.fn() };
  const supabaseAdmin = {
    db: { auth: { admin: { getUserById: jest.fn() } } },
  };
  const service = new PaymentFulfillmentService(
    prisma as unknown as PrismaService,
    me as unknown as MeService,
    supabaseAdmin as unknown as SupabaseAdminService,
  );
  return { service, prisma, me, supabaseAdmin };
}

function fakeOrder(overrides: Partial<PaymentOrder> = {}): PaymentOrder {
  return {
    id: 'order-1',
    userId: 'user-1',
    orderType: 'class_package',
    eventId: null,
    entryTypeId: null,
    classProgramId: 'program-1',
    classPackageId: 'package-1',
    quantity: 1,
    amountCents: 160000,
    currency: 'HNL',
    status: 'paid',
    paygateLinkId: 'pg-link-1',
    paygatePaymentId: 'pg-payment-1',
    paygateRawWebhook: null,
    resolutionSource: 'webhook',
    expiresAt: new Date('2026-08-04T12:00:00.000Z'),
    createdAt: new Date('2026-08-04T10:00:00.000Z'),
    updatedAt: new Date('2026-08-04T11:00:00.000Z'),
    ...overrides,
  };
}

describe('PaymentFulfillmentService', () => {
  it('creates a finite class pass from a paid class package order', async () => {
    const { service, prisma } = buildService();
    prisma.classPackage.findUnique.mockResolvedValue({
      id: 'package-1',
      programId: 'program-1',
      credits: 8,
      validityDays: 30,
      kind: 'pack',
      program: { providerId: 'provider-1' },
    });
    prisma.userClassPass.create.mockResolvedValue({ id: 'pass-1' });

    const result = await service.fulfillPaidOrder(fakeOrder(), 'test-fulfill');

    expect(result).toBe(true);
    expect(prisma.userClassPass.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        providerId: 'provider-1',
        programId: 'program-1',
        packageId: 'package-1',
        paymentOrderId: 'order-1',
        creditsTotal: 8,
        creditsRemaining: 8,
        status: 'active',
      }),
    });
    const expiresAt = prisma.userClassPass.create.mock.calls[0][0].data
      .expiresAt as Date;
    expect(expiresAt).toBeInstanceOf(Date);
  });

  it('creates an unlimited pass without finite credits', async () => {
    const { service, prisma } = buildService();
    prisma.classPackage.findUnique.mockResolvedValue({
      id: 'package-1',
      programId: 'program-1',
      credits: null,
      validityDays: 30,
      kind: 'unlimited',
      program: { providerId: 'provider-1' },
    });
    prisma.userClassPass.create.mockResolvedValue({ id: 'pass-1' });

    await service.fulfillPaidOrder(fakeOrder(), 'test-fulfill');

    expect(prisma.userClassPass.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        creditsTotal: null,
        creditsRemaining: null,
      }),
    });
  });

  it('does not create a second pass for the same paid order', async () => {
    const { service, prisma } = buildService();
    prisma.userClassPass.findFirst.mockResolvedValue({ id: 'pass-1' });

    const result = await service.fulfillPaidOrder(fakeOrder(), 'test-fulfill');

    expect(result).toBe(false);
    expect(prisma.userClassPass.create).not.toHaveBeenCalled();
  });

  it('mints tickets for a paid event ticket order', async () => {
    const { service, prisma, me, supabaseAdmin } = buildService();
    prisma.event.findUnique.mockResolvedValue({ id: 'event-1', capacity: 10 });
    prisma.ticket.count.mockResolvedValue(2);
    supabaseAdmin.db.auth.admin.getUserById.mockResolvedValue({
      data: {
        user: { email: 'buyer@example.com', user_metadata: { name: 'Buyer' } },
      },
    });
    me.createTicket.mockResolvedValue({ createdCount: 2 });

    const result = await service.fulfillPaidOrder(
      fakeOrder({
        orderType: 'event_ticket',
        eventId: 'event-1',
        entryTypeId: 'tier-1',
        classProgramId: null,
        classPackageId: null,
        quantity: 2,
      }),
      'test-ticket-fulfill',
    );

    expect(result).toBe(true);
    expect(me.createTicket).toHaveBeenCalledWith(
      'user-1',
      'event-1',
      2,
      expect.objectContaining({
        email: 'buyer@example.com',
        name: 'Buyer',
        paymentOrderId: 'order-1',
        ticketTypeId: 'tier-1',
        holders: [
          { email: 'buyer@example.com', name: 'Buyer' },
          { email: 'buyer@example.com', name: 'Buyer' },
        ],
      }),
    );
  });

  it('does not mint tickets when paid order would exceed event capacity', async () => {
    const { service, prisma, me } = buildService();
    prisma.event.findUnique.mockResolvedValue({ id: 'event-1', capacity: 3 });
    prisma.ticket.count.mockResolvedValue(2);

    const result = await service.fulfillPaidOrder(
      fakeOrder({
        orderType: 'event_ticket',
        eventId: 'event-1',
        classProgramId: null,
        classPackageId: null,
        quantity: 2,
      }),
      'test-ticket-fulfill',
    );

    expect(result).toBe(false);
    expect(me.createTicket).not.toHaveBeenCalled();
  });
});
