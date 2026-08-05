import { ClassReminderService } from './class-reminder.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';

function buildService() {
  const prisma = { $queryRaw: jest.fn() };
  const notifications = { notifyClassSessionSoon: jest.fn() };
  const service = new ClassReminderService(
    prisma as unknown as PrismaService,
    notifications as unknown as NotificationsService,
  );
  return { service, prisma, notifications };
}

const row = {
  id: 'res-1',
  user_id: 'user-1',
  program_title: 'Yoga Suave',
  provider_name: 'Studio Mixto',
  start_time: '09:00',
};

/** Joins the tagged-template fragments with '?' to mark each bound value. */
function sqlOf(prisma: { $queryRaw: jest.Mock }) {
  const [fragments] = prisma.$queryRaw.mock.calls[0] as [string[]];
  return fragments.join('?');
}

describe('ClassReminderService.sendSessionReminders', () => {
  // These assertions exist because the sweep's correctness lives entirely in
  // SQL that a mocked $queryRaw never executes. The make_interval cast already
  // reached production once for exactly this reason, so each guarantee is
  // pinned to the emitted text rather than to behaviour.
  describe('the claim statement', () => {
    it('casts the reminder window to int', async () => {
      // Prisma binds a JS number as bigint and there is no
      // make_interval(hours => bigint), so without the cast every sweep dies
      // with 42883 -- silently, since the service swallows its own errors.
      const { service, prisma } = buildService();
      prisma.$queryRaw.mockResolvedValueOnce([]);

      await service.sendSessionReminders();

      expect(sqlOf(prisma)).toMatch(/make_interval\(hours => \?::int\)/);
    });

    it('claims and marks in a single UPDATE ... RETURNING', async () => {
      // Enqueuing first and marking afterwards double-sends whenever the
      // process dies in between.
      const { service, prisma } = buildService();
      prisma.$queryRaw.mockResolvedValueOnce([]);

      await service.sendSessionReminders();

      const sql = sqlOf(prisma);
      expect(sql).toMatch(/UPDATE class_session_reservations r/);
      expect(sql).toMatch(/SET reminded_at = now\(\)/);
      expect(sql).toMatch(/RETURNING/);
    });

    it('re-asserts the pending predicate on the UPDATE, not only in the CTE', async () => {
      // Under READ COMMITTED a second writer that blocked on the row lock
      // re-checks only the UPDATE's own predicate once released. Without these
      // the id still matched and the same reminder went out twice.
      const { service, prisma } = buildService();
      prisma.$queryRaw.mockResolvedValueOnce([]);

      await service.sendSessionReminders();

      const afterUpdate = sqlOf(prisma).split(
        'UPDATE class_session_reservations',
      )[1];
      expect(afterUpdate).toMatch(/AND r\.reminded_at IS NULL/);
      expect(afterUpdate).toMatch(/AND r\.status = 'reserved'/);
    });

    it('skips rows another instance is already claiming', async () => {
      const { service, prisma } = buildService();
      prisma.$queryRaw.mockResolvedValueOnce([]);

      await service.sendSessionReminders();

      expect(sqlOf(prisma)).toMatch(/FOR UPDATE SKIP LOCKED/);
    });

    it('compares sessions on Honduras time, not the UTC session clock', async () => {
      // A session is naive local wall time; against a bare now() a 07:00 class
      // reads as 07:00 UTC, six hours early.
      const { service, prisma } = buildService();
      prisma.$queryRaw.mockResolvedValueOnce([]);

      await service.sendSessionReminders();

      expect(sqlOf(prisma)).toContain(
        "now() AT TIME ZONE 'America/Tegucigalpa'",
      );
    });

    it('binds the window and the batch size', async () => {
      const { service, prisma } = buildService();
      prisma.$queryRaw.mockResolvedValueOnce([]);

      await service.sendSessionReminders();

      const [, ...values] = prisma.$queryRaw.mock.calls[0];
      expect(values).toEqual([2, 200]);
    });
  });

  it('queues one push per claimed reservation', async () => {
    const { service, prisma, notifications } = buildService();
    prisma.$queryRaw.mockResolvedValueOnce([
      row,
      { ...row, id: 'res-2', user_id: 'user-2' },
    ]);

    await service.sendSessionReminders();

    expect(notifications.notifyClassSessionSoon).toHaveBeenCalledTimes(2);
    expect(notifications.notifyClassSessionSoon).toHaveBeenCalledWith(
      'user-1',
      'Yoga Suave',
      'Studio Mixto',
      '09:00',
    );
  });

  it('does not notify when nothing is due', async () => {
    const { service, prisma, notifications } = buildService();
    prisma.$queryRaw.mockResolvedValueOnce([]);

    await service.sendSessionReminders();

    expect(notifications.notifyClassSessionSoon).not.toHaveBeenCalled();
  });

  it('keeps going when one reservation fails to enqueue', async () => {
    const { service, prisma, notifications } = buildService();
    prisma.$queryRaw.mockResolvedValueOnce([
      row,
      { ...row, id: 'res-2', user_id: 'user-2' },
    ]);
    notifications.notifyClassSessionSoon
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);

    await expect(service.sendSessionReminders()).resolves.toBeUndefined();

    expect(notifications.notifyClassSessionSoon).toHaveBeenCalledTimes(2);
  });

  it('swallows a failing sweep so the cron keeps running', async () => {
    const { service, prisma, notifications } = buildService();
    prisma.$queryRaw.mockRejectedValueOnce(new Error('connection lost'));

    await expect(service.sendSessionReminders()).resolves.toBeUndefined();

    expect(notifications.notifyClassSessionSoon).not.toHaveBeenCalled();
  });
});
