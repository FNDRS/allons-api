import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, type NotificationTab } from '../../../generated/prisma';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const PUSH_MAX_ATTEMPTS = 3;
const PUSH_BATCH = 100;

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

type NotificationSettings = {
  push: {
    eventReminders: boolean;
    friendActivity: boolean;
    marketing: boolean;
  };
  inApp: {
    eventReminders: boolean;
    friendActivity: boolean;
    marketing: boolean;
  };
};

const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  push: { eventReminders: true, friendActivity: true, marketing: false },
  inApp: { eventReminders: true, friendActivity: true, marketing: false },
};

function coerceNotificationSettings(input: unknown): NotificationSettings {
  if (!input || typeof input !== 'object') return DEFAULT_NOTIFICATION_SETTINGS;
  const obj = input as any;

  function readSection(section: any) {
    return {
      eventReminders:
        typeof section?.eventReminders === 'boolean'
          ? section.eventReminders
          : DEFAULT_NOTIFICATION_SETTINGS.push.eventReminders,
      friendActivity:
        typeof section?.friendActivity === 'boolean'
          ? section.friendActivity
          : DEFAULT_NOTIFICATION_SETTINGS.push.friendActivity,
      marketing:
        typeof section?.marketing === 'boolean'
          ? section.marketing
          : DEFAULT_NOTIFICATION_SETTINGS.push.marketing,
    };
  }

  return { push: readSection(obj.push), inApp: readSection(obj.inApp) };
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async getSettings(userId: string): Promise<NotificationSettings> {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      select: { notificationSettings: true },
    });
    return coerceNotificationSettings((profile as any)?.notificationSettings);
  }

  async createInAppNotification(args: {
    userId: string;
    dedupeKey?: string;
    categoryLabel?: string | null;
    title: string;
    description?: string | null;
    tabs: NotificationTab[];
  }) {
    const { userId, dedupeKey, categoryLabel, title, description, tabs } = args;
    await this.prisma.notification.create({
      data: {
        userId,
        dedupeKey: dedupeKey ?? null,
        categoryLabel: categoryLabel ?? null,
        title,
        description: description ?? null,
        relevantTabs: tabs,
      },
    });
  }

  private async enqueuePush(
    userId: string,
    title: string,
    body?: string | null,
  ) {
    // Queued; the delivery worker (deliverPushOutbox) sends it via Expo.
    await this.prisma.$executeRaw`
      INSERT INTO push_outbox (user_id, title, body, data)
      VALUES (${userId}::uuid, ${title}, ${body ?? null}, ${null}::jsonb)
    `;
  }

  /** Registers (or re-assigns) an Expo push token for the caller's device. */
  async registerPushToken(
    userId: string,
    token: string,
    platform?: string | null,
  ): Promise<void> {
    const trimmed = (token ?? '').trim();
    if (
      !trimmed.startsWith('ExponentPushToken[') &&
      !trimmed.startsWith('ExpoPushToken[')
    ) {
      throw new BadRequestException('Token de push inválido');
    }
    const plat = platform === 'ios' || platform === 'android' ? platform : null;
    await this.prisma.$executeRaw`
      INSERT INTO push_tokens (user_id, token, platform)
      VALUES (${userId}::uuid, ${trimmed}, ${plat})
      ON CONFLICT (token)
      DO UPDATE SET user_id = EXCLUDED.user_id,
                    platform = COALESCE(EXCLUDED.platform, push_tokens.platform),
                    updated_at = now()
    `;
  }

  /**
   * Delivers queued push_outbox rows via the Expo push service. Marks rows
   * sent/failed (with bounded retries) and prunes tokens Expo reports as
   * DeviceNotRegistered.
   */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'push-outbox-delivery' })
  async deliverPushOutbox(): Promise<void> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        user_id: string;
        title: string;
        body: string | null;
        data: unknown;
      }>
    >`
      SELECT id, user_id, title, body, data
      FROM push_outbox
      WHERE status = 'pending' AND attempts < ${PUSH_MAX_ATTEMPTS}
      ORDER BY created_at ASC
      LIMIT ${PUSH_BATCH}
    `;
    if (rows.length === 0) return;

    const userIds = [...new Set(rows.map((r) => r.user_id))];
    const tokenRows = await this.prisma.$queryRaw<
      Array<{ user_id: string; token: string }>
    >(
      Prisma.sql`SELECT user_id, token FROM push_tokens WHERE user_id IN (${Prisma.join(
        userIds.map((id) => Prisma.sql`${id}::uuid`),
      )})`,
    );
    const tokensByUser = new Map<string, string[]>();
    for (const t of tokenRows) {
      const list = tokensByUser.get(t.user_id) ?? [];
      list.push(t.token);
      tokensByUser.set(t.user_id, list);
    }

    // Expo returns tickets in the same order as the messages we send, so we
    // keep a parallel array mapping each message back to its row + token.
    const entries: { rowId: string; token: string }[] = [];
    const messages: Array<{
      to: string;
      title: string;
      body?: string;
      data?: unknown;
    }> = [];
    for (const r of rows) {
      for (const token of tokensByUser.get(r.user_id) ?? []) {
        entries.push({ rowId: r.id, token });
        messages.push({
          to: token,
          title: r.title,
          body: r.body ?? undefined,
          data: r.data ?? undefined,
        });
      }
    }

    const deliveredRows = new Set<string>();
    const deadTokens = new Set<string>();
    for (let i = 0; i < messages.length; i += PUSH_BATCH) {
      const chunk = messages.slice(i, i + PUSH_BATCH);
      const chunkEntries = entries.slice(i, i + PUSH_BATCH);
      let tickets: ExpoTicket[];
      try {
        tickets = await this.sendExpo(chunk);
      } catch (err) {
        this.logger.warn(`Expo push send failed: ${String(err)}`);
        continue;
      }
      tickets.forEach((ticket, idx) => {
        const entry = chunkEntries[idx];
        if (!entry) return;
        if (ticket.status === 'ok') deliveredRows.add(entry.rowId);
        else if (ticket.details?.error === 'DeviceNotRegistered')
          deadTokens.add(entry.token);
      });
    }

    const now = new Date();
    if (deliveredRows.size > 0) {
      await this.prisma.$executeRaw(
        Prisma.sql`UPDATE push_outbox SET status = 'sent', sent_at = ${now}, last_attempt_at = ${now}
                   WHERE id IN (${Prisma.join(
                     [...deliveredRows].map((id) => Prisma.sql`${id}::uuid`),
                   )})`,
      );
    }
    const failedRowIds = rows
      .map((r) => r.id)
      .filter((id) => !deliveredRows.has(id));
    if (failedRowIds.length > 0) {
      await this.prisma.$executeRaw(
        Prisma.sql`UPDATE push_outbox
                   SET attempts = attempts + 1,
                       last_attempt_at = ${now},
                       error = 'not delivered',
                       status = CASE WHEN attempts + 1 >= ${PUSH_MAX_ATTEMPTS} THEN 'failed' ELSE 'pending' END
                   WHERE status = 'pending' AND id IN (${Prisma.join(
                     failedRowIds.map((id) => Prisma.sql`${id}::uuid`),
                   )})`,
      );
    }
    if (deadTokens.size > 0) {
      await this.prisma.$executeRaw(
        Prisma.sql`DELETE FROM push_tokens WHERE token IN (${Prisma.join(
          [...deadTokens].map((t) => Prisma.sql`${t}`),
        )})`,
      );
    }
  }

  private async sendExpo(
    messages: Array<{
      to: string;
      title: string;
      body?: string;
      data?: unknown;
    }>,
  ): Promise<ExpoTicket[]> {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(messages),
    });
    if (!res.ok) throw new Error(`Expo push HTTP ${res.status}`);
    const json = (await res.json()) as { data?: ExpoTicket[] };
    return json.data ?? [];
  }

  /** Queues a push reminding a comercio owner that their plan is about to lapse. */
  async notifyProviderRenewalDue(
    userId: string,
    daysLeft: number,
  ): Promise<void> {
    const title = 'Tu plan vence pronto';
    const body =
      daysLeft <= 0
        ? 'Tu plan de Allons vence hoy. Renueva para no perder acceso.'
        : `Tu plan de Allons vence en ${daysLeft} ${daysLeft === 1 ? 'día' : 'días'}. Renueva para no perder acceso.`;
    await this.enqueuePush(userId, title, body);
  }

  async maybeNotifyFriendMessage(args: {
    recipientUserId: string;
    senderUserId: string;
    messageId: string;
    preview: string;
  }) {
    const settings = await this.getSettings(args.recipientUserId);
    if (!settings.inApp.friendActivity) return;

    const sender = await this.prisma.profile.findUnique({
      where: { userId: args.senderUserId },
      select: { fullName: true, username: true },
    });
    const senderName =
      (sender?.fullName ?? '').trim() ||
      (sender?.username ?? '').trim() ||
      'Nuevo mensaje';

    await this.createInAppNotification({
      userId: args.recipientUserId,
      dedupeKey: `msg:${args.messageId}`,
      categoryLabel: 'Mensajes',
      title: senderName,
      description: args.preview,
      tabs: ['amigos'],
    });

    if (settings.push.friendActivity) {
      void this.enqueuePush(args.recipientUserId, senderName, args.preview);
    }
  }

  async maybeNotifyProviderUpdate(args: {
    providerId: string;
    kind: 'event_published' | 'discount_created';
    title: string;
    description?: string | null;
    dedupeKey: string;
  }) {
    // Follow table is created lazily in me-service; ensure it exists here too.
    await this.prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS provider_follows (
        user_id uuid NOT NULL,
        provider_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, provider_id)
      )
    `;

    const followerRows = await this.prisma.$queryRaw<
      Array<{ user_id: string }>
    >`
      SELECT user_id
      FROM provider_follows
      WHERE provider_id = ${args.providerId}::uuid
    `;
    if (followerRows.length === 0) return;

    // Marketing setting gates promos/news.
    const toNotify: string[] = [];
    for (const row of followerRows) {
      const settings = await this.getSettings(row.user_id);
      if (!settings.inApp.marketing) continue;
      toNotify.push(row.user_id);
    }
    if (toNotify.length === 0) return;

    await this.prisma.notification.createMany({
      data: toNotify.map((userId) => ({
        userId,
        dedupeKey: args.dedupeKey,
        categoryLabel: 'Novedades',
        title: args.title,
        description: args.description ?? null,
        relevantTabs: ['eventos'],
      })),
      skipDuplicates: true,
    });

    // Optional push outbox.
    for (const userId of toNotify) {
      const settings = await this.getSettings(userId);
      if (!settings.push.marketing) continue;
      void this.enqueuePush(userId, args.title, args.description ?? null);
    }
  }

  // Every 15 minutes: create event reminders 6 hours before start.
  @Cron('*/15 * * * *')
  async runEventReminders() {
    const windowMinutes = 15;
    const hoursBefore = 6;
    const now = new Date();
    const from = new Date(
      now.getTime() + (hoursBefore * 60 - windowMinutes) * 60_000,
    );
    const to = new Date(
      now.getTime() + (hoursBefore * 60 + windowMinutes) * 60_000,
    );

    // Tickets for events starting in the reminder window.
    const rows = await this.prisma.$queryRaw<
      Array<{
        user_id: string;
        event_id: string;
        title: string;
        starts_at: Date;
      }>
    >`
      SELECT DISTINCT t.owner_id AS user_id, e.id AS event_id, e.title, e.starts_at
      FROM tickets t
      JOIN events e ON e.id = t.event_id
      WHERE t.cancelled_at IS NULL
        AND e.starts_at IS NOT NULL
        AND e.starts_at >= ${from}::timestamptz
        AND e.starts_at < ${to}::timestamptz
    `;

    if (rows.length === 0) return;

    let created = 0;
    for (const row of rows) {
      const settings = await this.getSettings(row.user_id);
      if (!settings.inApp.eventReminders) continue;

      const dedupeKey = `event_reminder:${row.event_id}:h${hoursBefore}`;
      try {
        await this.prisma.notification.create({
          data: {
            userId: row.user_id,
            dedupeKey,
            categoryLabel: 'Recordatorios',
            title: 'Tu evento empieza pronto',
            description: `${row.title} comienza en ~${hoursBefore} horas.`,
            relevantTabs: ['eventos'],
          },
        });
        created += 1;
      } catch {
        // Unique dedupeKey avoids duplicates.
      }

      if (settings.push.eventReminders) {
        void this.enqueuePush(
          row.user_id,
          'Tu evento empieza pronto',
          `${row.title} comienza en ~${hoursBefore} horas.`,
        );
      }
    }

    if (created > 0) {
      this.logger.log(
        `event reminders: created=${created} window=${from.toISOString()}..${to.toISOString()}`,
      );
    }
  }

  // Weekly Monday 9:00am server time.
  @Cron('0 9 * * 1')
  async runWeeklyRecommendations() {
    // Find users with interests.
    const userRows = await this.prisma.$queryRaw<Array<{ user_id: string }>>`
      SELECT DISTINCT user_id
      FROM profile_interests
      LIMIT 5000
    `;
    if (userRows.length === 0) return;

    const weekKey = weekOfYear(new Date());
    let created = 0;

    for (const { user_id } of userRows) {
      const settings = await this.getSettings(user_id);
      if (!settings.inApp.marketing) continue;

      const dedupeKey = `interest_weekly:${weekKey}`;
      // Skip if already created.
      const exists = await this.prisma.notification.findFirst({
        where: { userId: user_id, dedupeKey },
        select: { id: true },
      });
      if (exists) continue;

      // Match next 14 days; prioritize same city if profile has location.
      const profile = await this.prisma.profile.findUnique({
        where: { userId: user_id },
        select: { location: true },
      });
      const city = (profile?.location ?? '').trim();

      const events = await this.prisma.$queryRaw<
        Array<{ id: string; title: string }>
      >`
        SELECT e.id, e.title
        FROM events e
        JOIN event_interests ei ON ei.event_id = e.id
        JOIN interests i ON i.id = ei.interest_id
        JOIN profile_interests pi ON pi.interest_id = i.id
        WHERE pi.user_id = ${user_id}::uuid
          AND (e.starts_at IS NULL OR e.starts_at >= now())
          AND (e.starts_at IS NULL OR e.starts_at < (now() + interval '14 days'))
          AND (${city} = '' OR e.city = ${city})
          AND e.status = 'published'
        ORDER BY e.starts_at ASC NULLS LAST, e.created_at DESC
        LIMIT 3
      `;
      if (events.length === 0) continue;

      const top = events[0].title;
      await this.prisma.notification.create({
        data: {
          userId: user_id,
          dedupeKey,
          categoryLabel: 'Recomendaciones',
          title: 'Te podría interesar',
          description: `Nuevo evento: ${top}`,
          relevantTabs: ['eventos'],
        },
      });
      if (settings.push.marketing) {
        void this.enqueuePush(
          user_id,
          'Te podría interesar',
          `Nuevo evento: ${top}`,
        );
      }
      created += 1;
    }

    if (created > 0) {
      this.logger.log(
        `weekly recommendations: created=${created} week=${weekKey}`,
      );
    }
  }
}

function weekOfYear(date: Date) {
  // Simple ISO-ish week key: YYYY-WW. Good enough for dedupe keys.
  const target = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = target.getTime() - firstThursday.getTime();
  const week = 1 + Math.round(diff / (7 * 24 * 60 * 60 * 1000));
  const year = target.getUTCFullYear();
  return `${year}-W${String(week).padStart(2, '0')}`;
}
