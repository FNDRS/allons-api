import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * How far ahead of a session its reminder goes out.
 *
 * Two hours rather than a fixed morning sweep: a 6am class would get its
 * "today" reminder after it had already finished, and a 4am push for it would
 * be worse than none. Two hours is on the day, as asked, and useful at any
 * hour a comercio schedules.
 */
// Cast to int at the call site: Prisma binds a JS number as bigint, and
// `make_interval(hours => bigint)` does not exist — it fails at runtime with
// 42883, which no mocked unit test would catch.
const REMIND_AHEAD_HOURS = 2;
/** Rows per sweep. A backlog drains over the following ticks rather than in one. */
const BATCH = 200;

type PendingReminder = {
  id: string;
  user_id: string;
  program_title: string;
  provider_name: string;
  start_time: string;
};

/**
 * Queues a push for class sessions starting soon.
 *
 * Delivery is the `push_outbox` worker's job (`deliverPushOutbox`, every
 * minute); this only enqueues, and marks `reminded_at` in the same statement
 * that selects the row so a restart or an overlapping run cannot send twice.
 */
@Injectable()
export class ClassReminderService {
  private readonly logger = new Logger(ClassReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('*/15 * * * *', { name: 'class-session-reminders' })
  async sendSessionReminders(): Promise<void> {
    try {
      // Claim-then-notify in one statement: the UPDATE ... RETURNING marks the
      // rows as reminded and hands them back atomically, so a second run
      // overlapping this one sees nothing to do. Enqueuing first and marking
      // afterwards would double-send whenever the process died in between.
      const claimed = await this.prisma.$queryRaw<PendingReminder[]>`
        WITH due AS (
          SELECT id
          FROM class_session_reservations
          WHERE reminded_at IS NULL
            AND status = 'reserved'
            AND (session_date::date + start_time::time)
                BETWEEN (now() AT TIME ZONE 'America/Tegucigalpa')
                    AND (now() AT TIME ZONE 'America/Tegucigalpa')
                        + make_interval(hours => ${REMIND_AHEAD_HOURS}::int)
          ORDER BY (session_date::date + start_time::time) ASC
          LIMIT ${BATCH}
          -- Skip rows another instance is already claiming instead of queueing
          -- behind them; whatever it claims, it also notifies.
          FOR UPDATE SKIP LOCKED
        ),
        claimed AS (
          UPDATE class_session_reservations r
          SET reminded_at = now()
          WHERE r.id IN (SELECT id FROM due)
            -- Re-asserted on the UPDATE itself, not just in the CTE. Under READ
            -- COMMITTED a second writer that blocked on the row lock re-checks
            -- only this predicate once released; without it the id still
            -- matched and the same reminder went out twice.
            AND r.reminded_at IS NULL
            AND r.status = 'reserved'
          RETURNING r.id, r.user_id, r.program_id, r.start_time
        )
        SELECT c.id::text AS id,
               c.user_id::text AS user_id,
               cp.title AS program_title,
               p.name AS provider_name,
               to_char(c.start_time, 'HH24:MI') AS start_time
        FROM claimed c
        JOIN class_programs cp ON cp.id = c.program_id
        JOIN providers p ON p.id = cp.provider_id
      `;

      if (claimed.length === 0) return;

      let queued = 0;
      for (const row of claimed) {
        try {
          await this.notifications.notifyClassSessionSoon(
            row.user_id,
            row.program_title,
            row.provider_name,
            row.start_time,
          );
          queued += 1;
        } catch (err) {
          // The row stays marked: retrying it later would be more likely to
          // arrive after the class than to help, and a missed reminder is
          // preferable to a duplicate one.
          this.logger.warn(
            `class reminder enqueue failed for reservation=${row.id}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
      this.logger.log(
        `class reminders: claimed=${claimed.length} queued=${queued}`,
      );
    } catch (err) {
      this.logger.error(
        `class reminder sweep failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
