import { BadRequestException } from '@nestjs/common';
import { ClassProgramsService } from './class-programs.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProvidersService } from '../providers/providers.service';

type PrismaMock = {
  $queryRaw: jest.Mock;
  $executeRaw: jest.Mock;
  $transaction: jest.Mock;
};

function makeService() {
  const prisma = {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    $transaction: jest.fn(),
  } satisfies PrismaMock;
  const providers = {
    requireMembership: jest.fn().mockResolvedValue({
      providerId: '11111111-1111-1111-1111-111111111111',
      role: 'owner',
    }),
  } as unknown as jest.Mocked<ProvidersService>;
  return {
    service: new ClassProgramsService(
      prisma as unknown as PrismaService,
      providers,
    ),
    prisma,
  };
}

const programRow = {
  id: '22222222-2222-2222-2222-222222222222',
  provider_id: '11111111-1111-1111-1111-111111111111',
  title: 'Erei Crossfit',
  description: null,
  discipline: 'Crossfit',
  instructor_name: 'Francisco Guillen',
  duration_minutes: 60,
  capacity_per_session: 8,
  location_name: null,
  address: null,
  city: null,
  latitude: null,
  longitude: null,
  cover_image_url: null,
  theme_color: null,
  status: 'published',
  created_at: new Date('2026-08-01T00:00:00.000Z'),
  updated_at: new Date('2026-08-01T00:00:00.000Z'),
};

describe('ClassProgramsService', () => {
  it('rejects creating a program without required basics', async () => {
    const { service } = makeService();

    await expect(
      service.createProviderProgram('user-1', {
        durationMinutes: 60,
        capacityPerSession: 10,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unlimited package without validityDays', async () => {
    const { service } = makeService();

    await expect(
      service.createProviderProgram('user-1', {
        title: 'Erei Crossfit',
        durationMinutes: 60,
        capacityPerSession: 10,
        packages: [{ name: 'Ilimitado', kind: 'unlimited', price: 1200 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('computes availability from templates and active reservations', async () => {
    const { service, prisma } = makeService();
    prisma.$queryRaw
      .mockResolvedValueOnce([programRow])
      .mockResolvedValueOnce([
        {
          id: '33333333-3333-3333-3333-333333333333',
          program_id: programRow.id,
          weekday: 2,
          start_time: '09:00',
          duration_minutes: null,
          capacity: 6,
          instructor_name: null,
          active: true,
        },
      ])
      .mockResolvedValueOnce([
        {
          session_date: '2026-08-04',
          start_time: '09:00',
          reserved_count: 4,
        },
      ]);

    const result = await service.getAvailability(programRow.id, {
      from: '2026-08-04',
      days: 1,
    });

    expect(result).toEqual([
      {
        date: '2026-08-04',
        startTime: '09:00',
        durationMinutes: 60,
        instructorName: 'Francisco Guillen',
        capacity: 6,
        reservedCount: 4,
        availableSpots: 2,
        canReserve: true,
      },
    ]);
  });
});
