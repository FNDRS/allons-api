import { ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';
import type { PaygateService } from '../paygate/paygate.service';
import { SubscriptionService } from './subscription.service';

interface Mocks {
  prisma: {
    providerSubscriptionOrder: {
      findUnique: jest.Mock;
      updateMany: jest.Mock;
      create: jest.Mock;
    };
    $queryRaw: jest.Mock;
  };
  supabaseAdmin: {
    getUserById: jest.Mock;
    db: {
      auth: {
        admin: {
          updateUserById: jest.Mock;
        };
      };
    };
  };
  paygate: {
    createPaymentLink: jest.Mock;
    getPaymentLinkDetail: jest.Mock;
  };
}

function buildService(): { service: SubscriptionService; mocks: Mocks } {
  const mocks: Mocks = {
    prisma: {
      providerSubscriptionOrder: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        create: jest.fn(),
      },
      $queryRaw: jest.fn(),
    },
    supabaseAdmin: {
      getUserById: jest.fn(),
      db: {
        auth: {
          admin: {
            updateUserById: jest.fn(),
          },
        },
      },
    },
    paygate: {
      createPaymentLink: jest.fn(),
      getPaymentLinkDetail: jest.fn(),
    },
  };

  const service = new SubscriptionService(
    mocks.prisma as unknown as PrismaService,
    mocks.supabaseAdmin as unknown as SupabaseAdminService,
    mocks.paygate as unknown as PaygateService,
  );

  return { service, mocks };
}

describe('SubscriptionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getSubscription', () => {
    it('returns 403 when caller has no provider membership or comercio metadata', async () => {
      const { service, mocks } = buildService();
      mocks.prisma.$queryRaw.mockResolvedValueOnce([]);
      mocks.supabaseAdmin.getUserById.mockResolvedValue({ user_metadata: {} });

      await expect(service.getSubscription('user-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('tryFulfillWebhook', () => {
    it('returns false when no subscription order matches', async () => {
      const { service, mocks } = buildService();
      mocks.prisma.providerSubscriptionOrder.findUnique.mockResolvedValue(null);

      const handled = await service.tryFulfillWebhook({
        paygateId: 'pg-1',
        orderRef: 'not-a-uuid',
        rawStatus: 'APPROVED',
        payload: {},
      });

      expect(handled).toBe(false);
    });

    it('activates the plan when order is already paid (idempotent webhook)', async () => {
      const { service, mocks } = buildService();
      const order = {
        id: 'order-1',
        providerId: 'prov-1',
        planId: 'basico',
        status: 'pending_payment',
      };
      mocks.prisma.providerSubscriptionOrder.findUnique
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce({ ...order, status: 'paid' });
      mocks.prisma.providerSubscriptionOrder.updateMany.mockResolvedValue({
        count: 0,
      });
      mocks.prisma.$queryRaw.mockResolvedValue([{ userId: 'owner-1' }]);
      mocks.supabaseAdmin.getUserById.mockResolvedValue({
        user_metadata: { subscription_status: 'trialing' },
      });
      mocks.supabaseAdmin.db.auth.admin.updateUserById.mockResolvedValue({});

      const handled = await service.tryFulfillWebhook({
        paygateId: 'pg-1',
        orderRef: null,
        rawStatus: 'APPROVED',
        payload: { ok: true },
      });

      expect(handled).toBe(true);
      expect(
        mocks.supabaseAdmin.db.auth.admin.updateUserById,
      ).toHaveBeenCalled();
    });
  });

  describe('assertCanPublishEvent', () => {
    it('throws 402 subscription_expired when the paid term ended past grace', async () => {
      const { service, mocks } = buildService();
      mocks.prisma.$queryRaw
        .mockResolvedValueOnce([{ userId: 'owner-1' }])
        .mockResolvedValueOnce([{ count: 0 }]);
      mocks.supabaseAdmin.getUserById.mockResolvedValue({
        user_metadata: {
          subscription_plan: 'basico',
          subscription_status: 'active',
          subscription_period_end: new Date(
            Date.now() - 8 * 86_400_000,
          ).toISOString(),
        },
      });

      await expect(
        service.assertCanPublishEvent('prov-1'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'subscription_expired' }),
        status: HttpStatus.PAYMENT_REQUIRED,
      });
    });

    it('throws 402 limit_exceeded when active events are at cap', async () => {
      const { service, mocks } = buildService();
      mocks.prisma.$queryRaw
        .mockResolvedValueOnce([{ userId: 'owner-1' }])
        .mockResolvedValueOnce([{ count: 4 }]);
      mocks.supabaseAdmin.getUserById.mockResolvedValue({
        user_metadata: {
          subscription_plan: 'basico',
          subscription_status: 'active',
          subscription_period_end: new Date(
            Date.now() + 86_400_000,
          ).toISOString(),
        },
      });

      let err: HttpException | undefined;
      try {
        await service.assertCanPublishEvent('prov-1');
      } catch (e) {
        err = e as HttpException;
      }

      expect(err?.getStatus()).toBe(HttpStatus.PAYMENT_REQUIRED);
      expect(err?.getResponse()).toMatchObject({
        code: 'limit_exceeded',
        limit: 4,
        used: 4,
        planId: 'basico',
      });
    });
  });

  describe('assertWithinTicketCap', () => {
    it('throws 402 when ticket total would exceed the plan cap', async () => {
      const { service, mocks } = buildService();
      mocks.prisma.$queryRaw
        .mockResolvedValueOnce([{ userId: 'owner-1' }])
        .mockResolvedValueOnce([{ total: 450 }]);
      mocks.supabaseAdmin.getUserById.mockResolvedValue({
        user_metadata: {
          subscription_plan: 'basico',
          subscription_status: 'active',
          subscription_period_end: new Date(
            Date.now() + 86_400_000,
          ).toISOString(),
        },
      });

      await expect(
        service.assertWithinTicketCap('prov-1', 'event-1', 100),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'limit_exceeded',
          limit: 500,
          used: 450,
        }),
      });
    });
  });
});
