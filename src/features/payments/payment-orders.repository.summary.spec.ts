import type { PrismaService } from '../../prisma/prisma.service';
import { PaymentOrdersRepository } from './payment-orders.repository';

function buildRepo() {
  const prisma = {
    paymentOrder: {
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
  };
  const repo = new PaymentOrdersRepository(prisma as unknown as PrismaService);
  return { repo, prisma };
}

describe('PaymentOrdersRepository.listForEvent', () => {
  it('queries by eventId, ordered newest first', async () => {
    const { repo, prisma } = buildRepo();
    prisma.paymentOrder.findMany.mockResolvedValue([]);

    await repo.listForEvent('event-1');

    expect(prisma.paymentOrder.findMany).toHaveBeenCalledWith({
      where: { eventId: 'event-1' },
      orderBy: { createdAt: 'desc' },
    });
  });
});

describe('PaymentOrdersRepository.summaryForEvent', () => {
  it('uses groupBy to aggregate counts and paid GMV in a single SQL call', async () => {
    const { repo, prisma } = buildRepo();
    prisma.paymentOrder.groupBy.mockResolvedValue([
      { status: 'paid', _count: { _all: 3 }, _sum: { amountCents: 60000 } },
      {
        status: 'pending_payment',
        _count: { _all: 1 },
        _sum: { amountCents: 0 },
      },
      { status: 'failed', _count: { _all: 2 }, _sum: { amountCents: 0 } },
    ]);

    const result = await repo.summaryForEvent('event-1');

    expect(prisma.paymentOrder.groupBy).toHaveBeenCalledWith({
      by: ['status'],
      where: { eventId: 'event-1' },
      _count: { _all: true },
      _sum: { amountCents: true },
    });
    expect(result).toEqual({
      paidCount: 3,
      pendingCount: 1,
      failedCount: 2,
      cancelledCount: 0,
      refundedCount: 0,
      paidAmountCents: 60000,
    });
  });

  it('returns zeros for statuses that are absent from the groupBy result', async () => {
    const { repo, prisma } = buildRepo();
    prisma.paymentOrder.groupBy.mockResolvedValue([]);

    const result = await repo.summaryForEvent('event-1');

    expect(result).toEqual({
      paidCount: 0,
      pendingCount: 0,
      failedCount: 0,
      cancelledCount: 0,
      refundedCount: 0,
      paidAmountCents: 0,
    });
  });
});
