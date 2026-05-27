import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../../shared/mail/mail.service';

const DEFAULT_WINDOW_MINUTES = 10;
const DEFAULT_THRESHOLD = 30;
const DEFAULT_COOLDOWN_MINUTES = 60;

function parseEmailList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

@Injectable()
export class AuthWebhooksService {
  private readonly logger = new Logger(AuthWebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /**
   * Fallback detector for plans without Supabase Auth Hooks.
   * Runs frequently and only alerts when threshold is crossed.
   */
  @Cron(process.env.MASS_SIGNUP_CRON ?? '*/1 * * * *')
  async runMassSignupDetector() {
    await this.detectAndAlert();
  }

  // Used by both the HTTP hook receiver and the cron fallback.
  async handleSignupHook() {
    await this.detectAndAlert();
  }

  private async detectAndAlert() {
    const windowMinutes =
      Number(process.env.MASS_SIGNUP_WINDOW_MINUTES) || DEFAULT_WINDOW_MINUTES;
    const threshold =
      Number(process.env.MASS_SIGNUP_THRESHOLD) || DEFAULT_THRESHOLD;
    const cooldownMinutes =
      Number(process.env.MASS_SIGNUP_COOLDOWN_MINUTES) ||
      DEFAULT_COOLDOWN_MINUTES;

    // Count signups in Supabase Auth schema.
    const [{ total } = { total: 0 }] = await this.prisma
      .$queryRaw<Array<{ total: number }>>`
        SELECT COUNT(*)::int AS total
        FROM auth.users
        WHERE created_at >= (now() - (${windowMinutes}::text || ' minutes')::interval)
      `
      .catch(() => [{ total: 0 }]);

    if (total < threshold) {
      // Keep noise down: log only when close to threshold.
      if (total >= Math.max(1, Math.floor(threshold * 0.8))) {
        this.logger.log(
          `[auth-hook] signup elevated (count=${total} window=${windowMinutes}m threshold=${threshold})`,
        );
      }
      return { alerted: false };
    }

    // Avoid alert storms in multi-instance deployments: reuse admin_audit_logs
    // as an immutable "sent marker".
    const cooldownFrom = new Date(Date.now() - cooldownMinutes * 60 * 1000);
    const recent = await this.prisma.adminAuditLog
      .findFirst({
        where: {
          action: 'auth.mass_signup_alert',
          outcome: 'success',
          occurredAt: { gte: cooldownFrom },
        },
        orderBy: { occurredAt: 'desc' },
        select: { id: true, occurredAt: true },
      })
      .catch(() => null);

    if (recent) {
      this.logger.warn(
        `[auth-hook] mass signup detected but cooldown active (count=${total} last=${recent.occurredAt.toISOString()})`,
      );
      return { alerted: false, cooldown: true };
    }

    const to = parseEmailList(process.env.ROOT_ADMIN_EMAILS);
    if (to.length === 0) {
      this.logger.warn(
        `[auth-hook] mass signup detected but ROOT_ADMIN_EMAILS is empty (count=${total})`,
      );
      return { alerted: false, missingRecipients: true };
    }

    const delivered = await this.mail.sendMassSignupAlert({
      to,
      count: total,
      windowMinutes,
      threshold,
    });

    await this.prisma.adminAuditLog
      .create({
        data: {
          actorUserId: null,
          actorEmail: null,
          source: 'route_handler',
          action: 'auth.mass_signup_alert',
          resourceType: 'auth',
          resourceId: 'signup',
          outcome: delivered ? 'success' : 'failure',
          stateAfter: {
            count: total,
            windowMinutes,
            threshold,
            delivered,
          },
        },
      })
      .catch(() => undefined);

    return { alerted: delivered };
  }
}
