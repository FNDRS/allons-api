import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';
import { NotificationsService } from '../notifications/notifications.service';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Remind comercio owners this many days before their paid term ends. */
const REMIND_WITHIN_MS = 7 * DAY_MS;
const PER_PAGE = 200;
const MAX_PAGES = 25;

/**
 * Daily sweep that queues a renewal push for comercio owners whose paid plan
 * ends within the reminder window. Dedupes per term via
 * `user_metadata.renewal_reminded_for`. Push delivery itself is handled by the
 * push_outbox worker (not yet implemented) — this only enqueues.
 */
@Injectable()
export class RenewalReminderService {
  private readonly logger = new Logger(RenewalReminderService.name);

  constructor(
    private readonly supabaseAdmin: SupabaseAdminService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM, {
    name: 'subscription-renewal-reminders',
  })
  async sendRenewalReminders(): Promise<void> {
    const now = Date.now();
    let reminded = 0;
    try {
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const { data, error } =
          await this.supabaseAdmin.db.auth.admin.listUsers({
            page,
            perPage: PER_PAGE,
          });
        if (error || !data?.users?.length) break;

        for (const user of data.users) {
          const meta = (user.user_metadata as Record<string, unknown>) ?? {};
          if (meta.role !== 'provider' || meta.comercio_role === 'member') {
            continue;
          }
          if (meta.subscription_status !== 'active') continue;
          const endRaw =
            typeof meta.subscription_period_end === 'string'
              ? meta.subscription_period_end
              : null;
          if (!endRaw) continue;
          const endMs = new Date(endRaw).getTime();
          if (!Number.isFinite(endMs)) continue;
          const remaining = endMs - now;
          if (remaining <= 0 || remaining > REMIND_WITHIN_MS) continue;
          if (meta.renewal_reminded_for === endRaw) continue; // already reminded this term

          const days = Math.ceil(remaining / DAY_MS);
          try {
            await this.notifications.notifyProviderRenewalDue(user.id, days);
            await this.supabaseAdmin.db.auth.admin.updateUserById(user.id, {
              user_metadata: { ...meta, renewal_reminded_for: endRaw },
            });
            reminded += 1;
          } catch (err) {
            this.logger.warn(
              `renewal reminder failed for ${user.id}: ${String(err)}`,
            );
          }
        }

        if (data.users.length < PER_PAGE) break;
      }
      if (reminded > 0) {
        this.logger.log(`subscription renewal reminders queued: ${reminded}`);
      }
    } catch (err) {
      this.logger.error(`renewal reminder sweep failed: ${String(err)}`);
    }
  }
}
