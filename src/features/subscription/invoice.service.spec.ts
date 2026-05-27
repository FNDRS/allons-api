import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { InvoiceService } from './invoice.service';
import type { SubscriptionService } from './subscription.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const PROVIDER_ID = '22222222-2222-4222-8222-222222222222';
const INVOICE_ID = '33333333-3333-4333-8333-333333333333';

interface Mocks {
  prisma: {
    providerInvoice: {
      create: jest.Mock;
      findMany: jest.Mock;
      groupBy: jest.Mock;
      findUnique: jest.Mock;
      updateMany: jest.Mock;
      update: jest.Mock;
    };
  };
  subscription: {
    getSubscription: jest.Mock;
    resolveOrCreateProviderId: jest.Mock;
    activateForProvider: jest.Mock;
  };
}

function buildService(): { service: InvoiceService; mocks: Mocks } {
  const mocks: Mocks = {
    prisma: {
      providerInvoice: {
        create: jest.fn(),
        findMany: jest.fn(),
        groupBy: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
      },
    },
    subscription: {
      getSubscription: jest.fn(),
      resolveOrCreateProviderId: jest.fn(),
      activateForProvider: jest.fn(),
    },
  };

  const service = new InvoiceService(
    mocks.prisma as unknown as PrismaService,
    mocks.subscription as unknown as SubscriptionService,
  );

  return { service, mocks };
}

describe('InvoiceService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('generate', () => {
    it('rejects non-UUID userId', async () => {
      const { service } = buildService();
      await expect(
        service.generate({ userId: 'not-a-uuid', planId: 'basico' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects non-UUID createdBy', async () => {
      const { service } = buildService();
      await expect(
        service.generate({
          userId: USER_ID,
          planId: 'basico',
          createdBy: 'admin@example.com',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('list', () => {
    it('applies the same filter to groupBy totals', async () => {
      const { service, mocks } = buildService();
      mocks.prisma.providerInvoice.findMany.mockResolvedValue([]);
      mocks.prisma.providerInvoice.groupBy.mockResolvedValue([]);

      await service.list({ providerId: PROVIDER_ID });

      expect(mocks.prisma.providerInvoice.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { providerId: PROVIDER_ID },
        }),
      );
    });
  });

  describe('markPaid', () => {
    const paidInvoice = {
      id: INVOICE_ID,
      providerId: PROVIDER_ID,
      planId: 'basico',
      status: 'paid',
      periodEnd: new Date('2027-01-01T00:00:00.000Z'),
    };

    it('re-activates when the invoice is already paid (heals failed activation)', async () => {
      const { service, mocks } = buildService();
      mocks.prisma.providerInvoice.findUnique.mockResolvedValue(paidInvoice);

      const result = await service.markPaid(INVOICE_ID);

      expect(result).toBe(paidInvoice);
      expect(mocks.subscription.activateForProvider).toHaveBeenCalledWith(
        PROVIDER_ID,
        'basico',
        paidInvoice.periodEnd.toISOString(),
      );
      expect(mocks.prisma.providerInvoice.updateMany).not.toHaveBeenCalled();
    });

    it('marks pending and activates using updateMany guard', async () => {
      const { service, mocks } = buildService();
      const pending = { ...paidInvoice, status: 'pending' };
      mocks.prisma.providerInvoice.findUnique
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce(paidInvoice);
      mocks.prisma.providerInvoice.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.markPaid(INVOICE_ID);

      expect(mocks.prisma.providerInvoice.updateMany).toHaveBeenCalledWith({
        where: { id: INVOICE_ID, status: 'pending' },
        data: expect.objectContaining({ status: 'paid' }),
      });
      expect(mocks.subscription.activateForProvider).toHaveBeenCalled();
      expect(result.status).toBe('paid');
    });

    it('throws when invoice id is not a UUID', async () => {
      const { service } = buildService();
      await expect(service.markPaid('bad-id')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws when invoice is missing', async () => {
      const { service, mocks } = buildService();
      mocks.prisma.providerInvoice.findUnique.mockResolvedValue(null);
      await expect(service.markPaid(INVOICE_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
