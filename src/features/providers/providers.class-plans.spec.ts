import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { SubscriptionService } from '../subscription/subscription.service';
import { ProvidersService } from './providers.service';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const PROVIDER_ID = '55555555-5555-4555-8555-555555555555';

function makePrisma() {
  const prisma: any = {
    $executeRaw: jest.fn(() => Promise.resolve(1)),
    $queryRaw: jest.fn(() => Promise.resolve([])),
    event: { findFirst: jest.fn() },
    provider: { findUnique: jest.fn() },
    profile: { findUnique: jest.fn() },
  };
  prisma.$transaction = jest.fn((cb: (tx: typeof prisma) => unknown) =>
    Promise.resolve(cb(prisma)),
  );
  return prisma as unknown as PrismaService;
}

function makeService(prisma: PrismaService) {
  const service = new ProvidersService(
    prisma,
    {} as unknown as SupabaseAdminService,
    { get: jest.fn(() => null) } as unknown as ConfigService,
    {} as unknown as NotificationsService,
    {
      assertWithinTicketCap: jest.fn(() => Promise.resolve()),
    } as unknown as SubscriptionService,
  );
  (service as unknown as { infraReady: boolean }).infraReady = true;
  jest.spyOn(service, 'requireMembership').mockResolvedValue({
    providerId: PROVIDER_ID,
    role: 'owner',
  });
  jest.spyOn(service, 'listTicketTypesForEvent').mockResolvedValue([]);
  return service;
}

/** Flattened bind values of every `$executeRaw` call, for asserting SQL params. */
function executeRawValues(prisma: PrismaService) {
  return JSON.stringify(
    (prisma.$executeRaw as unknown as jest.Mock).mock.calls.flat(),
  );
}

describe('ProvidersService class plans (paquetes)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stores a pack with its credits and validity window', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);

    await service.createTicketType(USER_ID, EVENT_ID, {
      name: 'Pack 4 clases',
      price: 520,
      total: 0,
      planKind: 'pack',
      credits: 4,
      validityDays: 30,
      sortOrder: 2,
    });

    const values = executeRawValues(prisma);
    expect(values).toContain('pack');
    expect(values).toContain('Pack 4 clases');
    expect(JSON.parse(values)).toEqual(expect.arrayContaining([4, 30, 2]));
  });

  it('normalizes a drop-in to exactly one credit', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);

    await service.createTicketType(USER_ID, EVENT_ID, {
      name: 'Entrada por clase',
      price: 150,
      planKind: 'drop_in',
      credits: 99,
    });

    const values = JSON.parse(executeRawValues(prisma)) as unknown[];
    expect(values).toContain('drop_in');
    expect(values).not.toContain(99);
    expect(values).toContain(1);
  });

  it('rejects a pack without credits', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);

    await expect(
      service.createTicketType(USER_ID, EVENT_ID, {
        name: 'Pack sin créditos',
        price: 400,
        planKind: 'pack',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unlimited pass without a validity window', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);

    await expect(
      service.createTicketType(USER_ID, EVENT_ID, {
        name: 'Mensual ilimitado',
        price: 1200,
        planKind: 'unlimited',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unknown planKind', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);

    await expect(
      service.createTicketType(USER_ID, EVENT_ID, {
        name: 'Raro',
        price: 10,
        planKind: 'trimestral',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('leaves plan fields null for a single-event tier', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);

    await service.createTicketType(USER_ID, EVENT_ID, {
      name: 'VIP',
      kind: 'vip',
      price: 800,
      total: 50,
    });

    const values = JSON.parse(executeRawValues(prisma)) as unknown[];
    expect(values).toContain('vip');
    expect(values).not.toContain('pack');
    expect(values).not.toContain('drop_in');
  });

  it('updateTicketType leaves plan fields untouched when planKind is absent', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);

    await service.updateTicketType(USER_ID, 'tt1', { name: 'Nuevo nombre' });

    const values = JSON.parse(executeRawValues(prisma)) as unknown[];
    // `plan !== null` guards the plan columns; false means "keep current value".
    expect(values).toContain(false);
    expect(values).toContain('Nuevo nombre');
  });
});
