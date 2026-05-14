import { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentOrdersRepository } from './payment-orders.repository';
import type { PaymentOrder } from './payment-orders.types';

interface PrismaMock {
  paymentOrder: {
    create: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    updateMany: jest.Mock;
    findUniqueOrThrow: jest.Mock;
  };
}

function buildRepo() {
  const prisma: PrismaMock = {
    paymentOrder: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
  };
  const repo = new PaymentOrdersRepository(prisma as unknown as PrismaService);
  return { repo, prisma };
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

describe('PaymentOrdersRepository.create', () => {
  it('defaults currency to HNL and entryTypeId to null when omitted', async () => {
    const { repo, prisma } = buildRepo();
    prisma.paymentOrder.create.mockResolvedValue(fakeOrder());

    await repo.create({
      userId: 'user-1',
      eventId: 'event-1',
      quantity: 2,
      amountCents: 5000,
      paygateLinkId: 'pg-link-1',
      expiresAt: new Date('2026-05-14T22:00:00Z'),
    });

    expect(prisma.paymentOrder.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        eventId: 'event-1',
        entryTypeId: null,
        quantity: 2,
        amountCents: 5000,
        currency: 'HNL',
        paygateLinkId: 'pg-link-1',
        expiresAt: new Date('2026-05-14T22:00:00Z'),
      },
    });
  });

  it('honours an explicit currency when provided', async () => {
    const { repo, prisma } = buildRepo();
    prisma.paymentOrder.create.mockResolvedValue(
      fakeOrder({ currency: 'USD' }),
    );

    await repo.create({
      userId: 'user-1',
      eventId: 'event-1',
      quantity: 1,
      amountCents: 5000,
      currency: 'USD',
      paygateLinkId: 'pg-link-1',
      expiresAt: new Date(),
    });

    expect(prisma.paymentOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ currency: 'USD' }),
      }),
    );
  });
});

describe('PaymentOrdersRepository lookups', () => {
  it('findById passes the id through findUnique', async () => {
    const { repo, prisma } = buildRepo();
    prisma.paymentOrder.findUnique.mockResolvedValue(fakeOrder());

    await repo.findById('order-1');

    expect(prisma.paymentOrder.findUnique).toHaveBeenCalledWith({
      where: { id: 'order-1' },
    });
  });

  it('findByPaygateLinkId targets the unique paygateLinkId column', async () => {
    const { repo, prisma } = buildRepo();
    prisma.paymentOrder.findUnique.mockResolvedValue(null);

    await repo.findByPaygateLinkId('pg-link-1');

    expect(prisma.paymentOrder.findUnique).toHaveBeenCalledWith({
      where: { paygateLinkId: 'pg-link-1' },
    });
  });

  it('findByPaygatePaymentId targets the unique paygatePaymentId column', async () => {
    const { repo, prisma } = buildRepo();
    prisma.paymentOrder.findUnique.mockResolvedValue(null);

    await repo.findByPaygatePaymentId('pg-payment-1');

    expect(prisma.paymentOrder.findUnique).toHaveBeenCalledWith({
      where: { paygatePaymentId: 'pg-payment-1' },
    });
  });

  it('listForUser filters by userId and orders newest first', async () => {
    const { repo, prisma } = buildRepo();
    prisma.paymentOrder.findMany.mockResolvedValue([]);

    await repo.listForUser('user-1');

    expect(prisma.paymentOrder.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { createdAt: 'desc' },
    });
  });
});

describe('PaymentOrdersRepository.listExpiredPending', () => {
  it('uses now() as the default cutoff when no grace period is given', async () => {
    const { repo, prisma } = buildRepo();
    prisma.paymentOrder.findMany.mockResolvedValue([]);
    const now = new Date('2026-05-14T22:00:00Z');

    await repo.listExpiredPending(now);

    expect(prisma.paymentOrder.findMany).toHaveBeenCalledWith({
      where: {
        status: 'pending_payment',
        expiresAt: { lt: now },
      },
      orderBy: { expiresAt: 'asc' },
    });
  });

  it('subtracts the grace period from now to compute the cutoff', async () => {
    const { repo, prisma } = buildRepo();
    prisma.paymentOrder.findMany.mockResolvedValue([]);
    const now = new Date('2026-05-14T22:15:00Z');
    const fifteenMinutes = 15 * 60 * 1000;

    await repo.listExpiredPending(now, fifteenMinutes);

    expect(prisma.paymentOrder.findMany).toHaveBeenCalledWith({
      where: {
        status: 'pending_payment',
        expiresAt: { lt: new Date('2026-05-14T22:00:00Z') },
      },
      orderBy: { expiresAt: 'asc' },
    });
  });
});

describe('PaymentOrdersRepository.transitionStatus', () => {
  it('updates only pending orders and returns applied:true on success', async () => {
    const { repo, prisma } = buildRepo();
    prisma.paymentOrder.updateMany.mockResolvedValue({ count: 1 });
    const updated = fakeOrder({
      status: 'paid',
      paygatePaymentId: 'pg-payment-1',
    });
    prisma.paymentOrder.findUniqueOrThrow.mockResolvedValue(updated);

    const result = await repo.transitionStatus('order-1', {
      status: 'paid',
      paygatePaymentId: 'pg-payment-1',
      paygateRawWebhook: { _id: 'pg-payment-1', status: 'APPROVED' },
    });

    expect(prisma.paymentOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', status: 'pending_payment' },
      data: expect.objectContaining({
        status: 'paid',
        paygatePaymentId: 'pg-payment-1',
        paygateRawWebhook: { _id: 'pg-payment-1', status: 'APPROVED' },
      }),
    });
    expect(result).toEqual({ applied: true, order: updated });
  });

  it('reports applied:false / not_pending when the order is no longer pending', async () => {
    const { repo, prisma } = buildRepo();
    prisma.paymentOrder.updateMany.mockResolvedValue({ count: 0 });
    prisma.paymentOrder.findUnique.mockResolvedValue(
      fakeOrder({ status: 'paid' }),
    );

    const result = await repo.transitionStatus('order-1', { status: 'paid' });

    expect(result).toEqual({ applied: false, reason: 'not_pending' });
    expect(prisma.paymentOrder.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('reports applied:false / not_found when the order id does not exist', async () => {
    const { repo, prisma } = buildRepo();
    prisma.paymentOrder.updateMany.mockResolvedValue({ count: 0 });
    prisma.paymentOrder.findUnique.mockResolvedValue(null);

    const result = await repo.transitionStatus('order-1', { status: 'paid' });

    expect(result).toEqual({ applied: false, reason: 'not_found' });
  });

  it('treats P2002 unique violation (paygate_payment_id) as not_pending without throwing', async () => {
    const { repo, prisma } = buildRepo();
    prisma.paymentOrder.updateMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique violation', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const result = await repo.transitionStatus('order-1', {
      status: 'paid',
      paygatePaymentId: 'pg-payment-1',
    });

    expect(result).toEqual({ applied: false, reason: 'not_pending' });
  });

  it('rethrows non-P2002 Prisma errors', async () => {
    const { repo, prisma } = buildRepo();
    prisma.paymentOrder.updateMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Other failure', {
        code: 'P1001',
        clientVersion: 'test',
      }),
    );

    await expect(
      repo.transitionStatus('order-1', { status: 'paid' }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });
});
