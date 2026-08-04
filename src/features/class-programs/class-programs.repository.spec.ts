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
    $queryRaw: jest.fn(),
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
          template_count: 1,
        },
      ])
      .mockResolvedValueOnce([{ elapsed: false }])
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
    expect(tx.$queryRaw).toHaveBeenCalledTimes(6);
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
          template_count: 1,
        },
      ])
      .mockResolvedValueOnce([{ elapsed: false }])
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
    expect(tx.$queryRaw).toHaveBeenCalledTimes(5);
  });

  it('returns occurrence_elapsed before locking or decrementing a pass', async () => {
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
          template_count: 1,
        },
      ])
      .mockResolvedValueOnce([{ elapsed: true }]);

    const result = await repository.createReservation(
      '77777777-7777-7777-7777-777777777777',
      payload,
    );

    expect(result).toEqual({ ok: false, reason: 'occurrence_elapsed' });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('returns template_ambiguous when multiple active templates match the slot', async () => {
    const { repository, tx } = buildRepository();
    tx.$queryRaw.mockResolvedValueOnce([
      {
        template_id: '33333333-3333-3333-3333-333333333333',
        provider_id: '11111111-1111-1111-1111-111111111111',
        program_id: payload.programId,
        duration_minutes: 60,
        instructor_name: null,
        capacity: 2,
        template_count: 2,
      },
    ]);

    const result = await repository.createReservation(
      '77777777-7777-7777-7777-777777777777',
      payload,
    );

    expect(result).toEqual({ ok: false, reason: 'template_ambiguous' });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });
});

describe('ClassProgramsRepository.listUserClassPasses', () => {
  it('binds the optional provider/program filters into the query', async () => {
    const { repository, prisma } = buildRepository();
    const rows = [{ id: 'pass-1' }];
    prisma.$queryRaw.mockResolvedValueOnce(rows);

    const result = await repository.listUserClassPasses('user-1', {
      providerId: 'provider-1',
      programId: null,
    });

    expect(result).toBe(rows);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const [, sqlFragment] = prisma.$queryRaw.mock.calls[0];
    expect(sqlFragment.values).toEqual(['user-1', 'provider-1']);
  });

  it('omits provider/program filters when neither is given', async () => {
    const { repository, prisma } = buildRepository();
    prisma.$queryRaw.mockResolvedValueOnce([]);

    await repository.listUserClassPasses('user-1', {
      providerId: null,
      programId: null,
    });

    const [, sqlFragment] = prisma.$queryRaw.mock.calls[0];
    expect(sqlFragment.values).toEqual(['user-1']);
  });

  it('excludes passes with no credits left, but keeps unlimited ones', async () => {
    const { repository, prisma } = buildRepository();
    prisma.$queryRaw.mockResolvedValueOnce([]);

    await repository.listUserClassPasses('user-1', {
      providerId: null,
      programId: null,
    });

    const [, sqlFragment] = prisma.$queryRaw.mock.calls[0];
    expect(sqlFragment.text).toContain(
      '(ucp.credits_remaining IS NULL OR ucp.credits_remaining > 0)',
    );
  });

  it('returns only published-program balances grouped by program', async () => {
    const { repository, prisma } = buildRepository();
    prisma.$queryRaw.mockResolvedValueOnce([]);

    await repository.listUserClassPasses('user-1', {
      providerId: null,
      programId: null,
    });

    const [strings, sqlFragment] = prisma.$queryRaw.mock.calls[0];
    const fullSql = `${strings.join(' ')} ${sqlFragment.text}`;
    expect(fullSql).toContain("cp.status = 'published'");
    expect(fullSql).toContain(
      'GROUP BY ucp.provider_id, ucp.program_id, cp.title',
    );
    expect(fullSql).toContain('sum(ucp.credits_remaining)::int');
  });
});
