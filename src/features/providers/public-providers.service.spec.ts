import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { ProvidersController } from './providers.controller';
import { PublicProvidersService } from './public-providers.service';

const PROVIDER_ID = '55555555-5555-4555-8555-555555555555';

function makePrisma() {
  const prisma: any = {
    $queryRaw: jest.fn(() => Promise.resolve([])),
    $executeRaw: jest.fn(() => Promise.resolve(1)),
    provider: { findUnique: jest.fn(), findMany: jest.fn() },
    event: { findMany: jest.fn(() => Promise.resolve([])) },
  };
  return prisma as unknown as PrismaService;
}

/** Mirrors the order of the Promise.all in getPublicProfile. */
function mockProfileAggregates(
  prisma: PrismaService,
  overrides: {
    followers?: number;
    counts?: Array<{ event_type: string; total: number }>;
    city?: string | null;
    rating?: { avg_rating: number | null; total: number };
    email?: string | null;
    logoColor?: string | null;
  } = {},
) {
  (prisma.$queryRaw as unknown as jest.Mock)
    .mockResolvedValueOnce([{ total: overrides.followers ?? 0 }])
    .mockResolvedValueOnce(overrides.counts ?? [])
    .mockResolvedValueOnce(overrides.city ? [{ city: overrides.city }] : [])
    .mockResolvedValueOnce([overrides.rating ?? { avg_rating: null, total: 0 }])
    .mockResolvedValueOnce(overrides.email ? [{ email: overrides.email }] : [])
    .mockResolvedValueOnce(
      overrides.logoColor ? [{ logo_color: overrides.logoColor }] : [],
    );
}

describe('PublicProvidersService profile', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws 404 for an unknown comercio', async () => {
    const prisma = makePrisma();
    (prisma.provider.findUnique as unknown as jest.Mock).mockResolvedValueOnce(
      null,
    );
    const service = new PublicProvidersService(prisma);

    await expect(service.getPublicProfile(PROVIDER_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('aggregates counters, city, rating and contact', async () => {
    const prisma = makePrisma();
    (prisma.provider.findUnique as unknown as jest.Mock).mockResolvedValueOnce({
      id: PROVIDER_ID,
      name: 'Estudio Barre',
      handle: 'barrehn',
      description: 'Barre y pilates',
      websiteUrl: null,
      logoUrl: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      reviews: [
        {
          id: 'r1',
          authorName: 'Ana',
          body: 'Excelente',
          rating: 5,
          createdAt: new Date('2026-02-01T00:00:00Z'),
        },
      ],
    });
    mockProfileAggregates(prisma, {
      followers: 1200,
      counts: [
        { event_type: 'single', total: 2 },
        { event_type: 'recurring_class', total: 3 },
      ],
      city: 'Tegucigalpa',
      rating: { avg_rating: 4.766, total: 9 },
      email: '  owner@barre.hn ',
      logoColor: '#F67010',
    });

    const service = new PublicProvidersService(prisma);
    const res = await service.getPublicProfile(PROVIDER_ID);

    expect(res).toMatchObject({
      id: PROVIDER_ID,
      name: 'Estudio Barre',
      handle: 'barrehn',
      city: 'Tegucigalpa',
      email: 'owner@barre.hn',
      brandLogoColor: '#F67010',
      followerCount: 1200,
      eventCount: 2,
      classCount: 3,
      reviewCount: 9,
    });
    // One decimal is enough for a star rating.
    expect(res.rating).toBe(4.8);
    expect(res.reviews).toHaveLength(1);
  });

  it('reports null rating and zeroed counters for a brand-new comercio', async () => {
    const prisma = makePrisma();
    (prisma.provider.findUnique as unknown as jest.Mock).mockResolvedValueOnce({
      id: PROVIDER_ID,
      name: 'Nuevo',
      handle: null,
      description: null,
      websiteUrl: null,
      logoUrl: null,
      createdAt: new Date('2026-08-01T00:00:00Z'),
      reviews: [],
    });
    mockProfileAggregates(prisma);

    const service = new PublicProvidersService(prisma);
    const res = await service.getPublicProfile(PROVIDER_ID);

    expect(res.rating).toBeNull();
    expect(res.city).toBeNull();
    expect(res.email).toBeNull();
    expect(res).toMatchObject({
      followerCount: 0,
      eventCount: 0,
      classCount: 0,
      reviewCount: 0,
    });
  });
});

describe('PublicProvidersService catalogue', () => {
  beforeEach(() => jest.clearAllMocks());

  function serviceWithProvider() {
    const prisma = makePrisma();
    (prisma.provider.findUnique as unknown as jest.Mock).mockResolvedValue({
      id: PROVIDER_ID,
    });
    return { prisma, service: new PublicProvidersService(prisma) };
  }

  function findManyArgs(prisma: PrismaService) {
    return (prisma.event.findMany as unknown as jest.Mock).mock.calls[0][0];
  }

  it('keeps recurring classes in "upcoming" whatever their first session was', async () => {
    const { prisma, service } = serviceWithProvider();
    await service.listPublicEvents(PROVIDER_ID, { scope: 'upcoming' });

    const where = findManyArgs(prisma).where;
    expect(where.OR).toEqual(
      expect.arrayContaining([{ eventType: 'recurring_class' }]),
    );
    expect(where.status).toEqual({ in: ['published', 'sold_out'] });
    expect(findManyArgs(prisma).orderBy[0]).toEqual({ startsAt: 'asc' });
  });

  it('excludes recurring classes from "past"', async () => {
    const { prisma, service } = serviceWithProvider();
    await service.listPublicEvents(PROVIDER_ID, { scope: 'past' });

    const where = findManyArgs(prisma).where;
    expect(where.eventType).toEqual({ not: 'recurring_class' });
    expect(where.startsAt.lt).toBeInstanceOf(Date);
    expect(findManyArgs(prisma).orderBy[0]).toEqual({ startsAt: 'desc' });
  });

  it('defaults to upcoming and narrows by type', async () => {
    const { prisma, service } = serviceWithProvider();
    await service.listPublicEvents(PROVIDER_ID, { type: 'recurring_class' });

    const where = findManyArgs(prisma).where;
    expect(where.eventType).toBe('recurring_class');
    expect(where.OR).toBeDefined();
  });

  it('applies no date filter for scope=all', async () => {
    const { prisma, service } = serviceWithProvider();
    await service.listPublicEvents(PROVIDER_ID, { scope: 'all' });

    const where = findManyArgs(prisma).where;
    expect(where.OR).toBeUndefined();
    expect(where.startsAt).toBeUndefined();
  });

  it('throws 404 for an unknown comercio', async () => {
    const prisma = makePrisma();
    (prisma.provider.findUnique as unknown as jest.Mock).mockResolvedValueOnce(
      null,
    );
    const service = new PublicProvidersService(prisma);

    await expect(service.listPublicEvents(PROVIDER_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('ProvidersController query validation', () => {
  function makeController() {
    const publicProviders = {
      getPublicProfile: jest.fn(() => Promise.resolve({} as never)),
      listPublicEvents: jest.fn(() => Promise.resolve([] as never)),
    } as unknown as PublicProvidersService;
    const controller = new ProvidersController(makePrisma(), publicProviders);
    return { controller, publicProviders };
  }

  it('rejects an unknown scope or type', () => {
    const { controller } = makeController();
    expect(() => controller.listEvents(PROVIDER_ID, 'ayer')).toThrow(
      BadRequestException,
    );
    expect(() =>
      controller.listEvents(PROVIDER_ID, undefined, 'clases'),
    ).toThrow(BadRequestException);
  });

  it('rejects a non-positive limit and caps the maximum', () => {
    const { controller, publicProviders } = makeController();
    expect(() =>
      controller.listEvents(PROVIDER_ID, undefined, undefined, '0'),
    ).toThrow(BadRequestException);

    void controller.listEvents(PROVIDER_ID, undefined, undefined, '9999');
    expect(publicProviders.listPublicEvents).toHaveBeenCalledWith(
      PROVIDER_ID,
      expect.objectContaining({ limit: 100 }),
    );
  });
});
