import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ProvidersService } from '../providers/providers.service';
import type { PaymentOrdersRepository } from './payment-orders.repository';
import type { PaymentOrder } from './payment-orders.types';
import { ProviderPaymentsService } from './provider-payments.service';

interface Mocks {
  prisma: { event: { findUnique: jest.Mock } };
  providers: { getMembership: jest.Mock };
  orders: { listForEvent: jest.Mock; summaryForEvent: jest.Mock };
}

function buildService(): { service: ProviderPaymentsService; mocks: Mocks } {
  const mocks: Mocks = {
    prisma: { event: { findUnique: jest.fn() } },
    providers: { getMembership: jest.fn() },
    orders: { listForEvent: jest.fn(), summaryForEvent: jest.fn() },
  };
  const service = new ProviderPaymentsService(
    mocks.prisma as unknown as PrismaService,
    mocks.providers as unknown as ProvidersService,
    mocks.orders as unknown as PaymentOrdersRepository,
  );
  return { service, mocks };
}

function fakeOrder(overrides: Partial<PaymentOrder> = {}): PaymentOrder {
  return {
    id: 'order-1',
    userId: 'buyer-1',
    eventId: 'event-1',
    entryTypeId: null,
    quantity: 2,
    amountCents: 20000,
    currency: 'HNL',
    status: 'paid',
    paygateLinkId: 'pg-link-1',
    paygatePaymentId: 'pg-payment-1',
    paygateRawWebhook: null,
    expiresAt: null,
    createdAt: new Date('2026-05-14T20:00:00Z'),
    updatedAt: new Date('2026-05-14T20:00:00Z'),
    ...overrides,
  };
}

describe('ProviderPaymentsService.listForEvent', () => {
  it('rejects with 403 when the caller has no provider membership', async () => {
    const { service, mocks } = buildService();
    mocks.providers.getMembership.mockResolvedValue(null);

    await expect(
      service.listForEvent('user-1', 'event-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.prisma.event.findUnique).not.toHaveBeenCalled();
  });

  it('rejects with 404 when the event does not exist', async () => {
    const { service, mocks } = buildService();
    mocks.providers.getMembership.mockResolvedValue({
      providerId: 'provider-1',
      role: 'owner',
    });
    mocks.prisma.event.findUnique.mockResolvedValue(null);

    await expect(
      service.listForEvent('user-1', 'missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects with 403 when the event belongs to a different provider', async () => {
    const { service, mocks } = buildService();
    mocks.providers.getMembership.mockResolvedValue({
      providerId: 'provider-1',
      role: 'owner',
    });
    mocks.prisma.event.findUnique.mockResolvedValue({
      id: 'event-1',
      providerId: 'provider-other',
      title: 'Other',
    });

    await expect(
      service.listForEvent('user-1', 'event-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.orders.listForEvent).not.toHaveBeenCalled();
  });

  it('returns orders + summary when the caller owns the event', async () => {
    const { service, mocks } = buildService();
    mocks.providers.getMembership.mockResolvedValue({
      providerId: 'provider-1',
      role: 'owner',
    });
    mocks.prisma.event.findUnique.mockResolvedValue({
      id: 'event-1',
      providerId: 'provider-1',
      title: 'Test Event',
    });
    mocks.orders.listForEvent.mockResolvedValue([
      fakeOrder({ id: 'a', status: 'paid', amountCents: 20000 }),
      fakeOrder({ id: 'b', status: 'pending_payment' }),
    ]);
    mocks.orders.summaryForEvent.mockResolvedValue({
      paidCount: 1,
      pendingCount: 1,
      failedCount: 0,
      cancelledCount: 0,
      refundedCount: 0,
      paidAmountCents: 20000,
    });

    const result = await service.listForEvent('user-1', 'event-1');

    expect(result.eventId).toBe('event-1');
    expect(result.eventTitle).toBe('Test Event');
    expect(result.summary.paidCount).toBe(1);
    expect(result.summary.paidAmountCents).toBe(20000);
    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toMatchObject({
      orderId: 'a',
      status: 'paid',
      buyerUserId: 'buyer-1',
    });
  });
});
