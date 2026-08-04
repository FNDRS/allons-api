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

const reservationId = '55555555-5555-5555-5555-555555555555';
const userId = '77777777-7777-7777-7777-777777777777';
const passId = '66666666-6666-6666-6666-666666666666';

describe('ClassProgramsRepository.cancelReservation', () => {
  it('cancels and refunds a finite pass when cancelled within the refund window', async () => {
    const { repository, tx } = buildRepository();
    tx.$queryRaw
      .mockResolvedValueOnce([
        {
          id: reservationId,
          user_id: userId,
          pass_id: passId,
          session_date: '2026-08-10',
          start_time: '09:00',
          status: 'reserved',
        },
      ])
      .mockResolvedValueOnce([{ elapsed: false, refund_eligible: true }])
      .mockResolvedValueOnce([
        {
          id: reservationId,
          status: 'cancelled',
          cancelled_at: new Date('2026-08-04T12:00:00.000Z'),
        },
      ]);
    tx.$executeRaw.mockResolvedValueOnce(1);

    const result = await repository.cancelReservation(userId, reservationId);

    expect(result).toEqual({
      ok: true,
      reservation: {
        id: reservationId,
        status: 'cancelled',
        cancelled_at: new Date('2026-08-04T12:00:00.000Z'),
      },
      refunded: true,
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    // Belt-and-suspenders: the credit UPDATE is scoped to the cancelling
    // user, not just the pass id, so it can never refund the wrong account.
    const [, ...values] = tx.$executeRaw.mock.calls[0];
    expect(values).toEqual(expect.arrayContaining([passId, userId]));
  });

  it('cancels without a refund when outside the refund window', async () => {
    const { repository, tx } = buildRepository();
    tx.$queryRaw
      .mockResolvedValueOnce([
        {
          id: reservationId,
          user_id: userId,
          pass_id: passId,
          session_date: '2026-08-10',
          start_time: '09:00',
          status: 'reserved',
        },
      ])
      .mockResolvedValueOnce([{ elapsed: false, refund_eligible: false }])
      .mockResolvedValueOnce([
        {
          id: reservationId,
          status: 'cancelled',
          cancelled_at: new Date('2026-08-04T12:00:00.000Z'),
        },
      ]);

    const result = await repository.cancelReservation(userId, reservationId);

    expect(result).toMatchObject({ ok: true, refunded: false });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('reports no refund when the guarded credit UPDATE affects no rows (unlimited pass)', async () => {
    const { repository, tx } = buildRepository();
    tx.$queryRaw
      .mockResolvedValueOnce([
        {
          id: reservationId,
          user_id: userId,
          pass_id: passId,
          session_date: '2026-08-10',
          start_time: '09:00',
          status: 'reserved',
        },
      ])
      .mockResolvedValueOnce([{ elapsed: false, refund_eligible: true }])
      .mockResolvedValueOnce([
        {
          id: reservationId,
          status: 'cancelled',
          cancelled_at: new Date('2026-08-04T12:00:00.000Z'),
        },
      ]);
    tx.$executeRaw.mockResolvedValueOnce(0);

    const result = await repository.cancelReservation(userId, reservationId);

    expect(result).toMatchObject({ ok: true, refunded: false });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('returns not_found when the reservation does not exist', async () => {
    const { repository, tx } = buildRepository();
    tx.$queryRaw.mockResolvedValueOnce([]);

    const result = await repository.cancelReservation(userId, reservationId);

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns forbidden when the reservation belongs to another user', async () => {
    const { repository, tx } = buildRepository();
    tx.$queryRaw.mockResolvedValueOnce([
      {
        id: reservationId,
        user_id: 'someone-else',
        pass_id: passId,
        session_date: '2026-08-10',
        start_time: '09:00',
        status: 'reserved',
      },
    ]);

    const result = await repository.cancelReservation(userId, reservationId);

    expect(result).toEqual({ ok: false, reason: 'forbidden' });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns already_cancelled without re-cancelling', async () => {
    const { repository, tx } = buildRepository();
    tx.$queryRaw.mockResolvedValueOnce([
      {
        id: reservationId,
        user_id: userId,
        pass_id: passId,
        session_date: '2026-08-10',
        start_time: '09:00',
        status: 'cancelled',
      },
    ]);

    const result = await repository.cancelReservation(userId, reservationId);

    expect(result).toEqual({ ok: false, reason: 'already_cancelled' });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns occurrence_elapsed for a past session and does not update anything', async () => {
    const { repository, tx } = buildRepository();
    tx.$queryRaw
      .mockResolvedValueOnce([
        {
          id: reservationId,
          user_id: userId,
          pass_id: passId,
          session_date: '2020-01-01',
          start_time: '09:00',
          status: 'reserved',
        },
      ])
      .mockResolvedValueOnce([{ elapsed: true, refund_eligible: false }]);

    const result = await repository.cancelReservation(userId, reservationId);

    expect(result).toEqual({ ok: false, reason: 'occurrence_elapsed' });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});

describe('ClassProgramsRepository.getCivilToday', () => {
  it("returns the DB's Honduras civil date", async () => {
    const { repository, prisma } = buildRepository();
    prisma.$queryRaw.mockResolvedValueOnce([{ today: '2026-08-04' }]);

    await expect(repository.getCivilToday()).resolves.toBe('2026-08-04');
  });
});

describe('ClassProgramsRepository.getUserReservedOccurrences', () => {
  it("scopes the lookup to the caller's own reserved occurrences", async () => {
    const { repository, prisma } = buildRepository();
    const rows = [{ session_date: '2026-08-04', start_time: '09:00' }];
    prisma.$queryRaw.mockResolvedValueOnce(rows);

    const result = await repository.getUserReservedOccurrences(
      payload.programId,
      userId,
      '2026-08-04',
      '2026-08-10',
    );

    expect(result).toBe(rows);
    const [, ...values] = prisma.$queryRaw.mock.calls[0];
    expect(values).toEqual(
      expect.arrayContaining([
        payload.programId,
        userId,
        '2026-08-04',
        '2026-08-10',
      ]),
    );
  });
});
