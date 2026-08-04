import type { PrismaService } from '../../prisma/prisma.service';
import { ClassProgramsRepository } from './class-programs.repository';

function buildRepository() {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(undefined),
    $queryRaw: jest.fn(),
  };
  const prisma = {
    $transaction: jest.fn((callback: (tx: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const repository = new ClassProgramsRepository(
    prisma as unknown as PrismaService,
  );
  return { repository, prisma, tx };
}

const payload = {
  programId: '22222222-2222-2222-2222-222222222222',
  date: '2026-08-04',
  startTime: '09:00',
};

describe('ClassProgramsRepository.createReservation', () => {
  it('creates a reservation and decrements a finite pass in one transaction', async () => {
    const { repository, prisma, tx } = buildRepository();
    tx.$queryRaw
      .mockResolvedValueOnce([
        {
          template_id: '33333333-3333-3333-3333-333333333333',
          provider_id: '11111111-1111-1111-1111-111111111111',
          program_id: payload.programId,
          duration_minutes: 60,
          instructor_name: 'Francisco Guillen',
          capacity: 8,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: '66666666-6666-6666-6666-666666666666',
          credits_remaining: 3,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ reserved_count: 2 }])
      .mockResolvedValueOnce([
        {
          id: '55555555-5555-5555-5555-555555555555',
          user_id: '77777777-7777-7777-7777-777777777777',
          provider_id: '11111111-1111-1111-1111-111111111111',
          program_id: payload.programId,
          template_id: '33333333-3333-3333-3333-333333333333',
          pass_id: '66666666-6666-6666-6666-666666666666',
          session_date: payload.date,
          start_time: payload.startTime,
          duration_minutes: 60,
          instructor_name: 'Francisco Guillen',
          status: 'reserved',
          created_at: new Date('2026-08-04T12:00:00.000Z'),
        },
      ]);

    const result = await repository.createReservation(
      '77777777-7777-7777-7777-777777777777',
      payload,
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: true,
      reservation: { id: '55555555-5555-5555-5555-555555555555' },
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(5);
  });

  it('returns capacity_full before inserting when the occurrence is full', async () => {
    const { repository, tx } = buildRepository();
    tx.$queryRaw
      .mockResolvedValueOnce([
        {
          template_id: '33333333-3333-3333-3333-333333333333',
          provider_id: '11111111-1111-1111-1111-111111111111',
          program_id: payload.programId,
          duration_minutes: 60,
          instructor_name: null,
          capacity: 2,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: '66666666-6666-6666-6666-666666666666',
          credits_remaining: null,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ reserved_count: 2 }]);

    const result = await repository.createReservation(
      '77777777-7777-7777-7777-777777777777',
      payload,
    );

    expect(result).toEqual({ ok: false, reason: 'capacity_full' });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(4);
  });
});
