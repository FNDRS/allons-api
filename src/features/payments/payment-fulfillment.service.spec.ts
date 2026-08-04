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
  const service = new PaymentFulfillmentService(
    prisma as unknown as PrismaService,
    { createTicket: jest.fn() } as unknown as MeService,
    {
      db: { auth: { admin: { getUserById: jest.fn() } } },
    } as unknown as SupabaseAdminService,
  );
  return { service, prisma };
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
});
