import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PaymentOrderStatus } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentOrdersRepository } from '../payments/payment-orders.repository';
import { PaymentsReconciliationService } from '../payments/payments-reconciliation.service';
import { PaygateService } from '../paygate/paygate.service';
import { PostHogQueryService } from '../../shared/posthog/posthog-query.service';
import { AdminSecretGuard } from './admin-secret.guard';
import { activeEventsWhere } from './admin.metrics';
import {
  mapAdminEventDetail,
  mapAdminEventListItem,
} from './admin.event-mapper';
import type {
  AdminEventActionResponse,
  AdminEventDetailItem,
  AdminEventListItem,
  AdminEventListResponse,
  AdminOverviewMetricsResponse,
  AdminPlatformStatusResponse,
} from './admin.types';

type AdminNotificationAudience = 'clients' | 'providers';
type AdminNotificationTab = 'amigos' | 'eventos' | 'menciones';

const ALLOWED_STATUSES = new Set([
  'draft',
  'published',
  'sold_out',
  'ended',
  'suspended',
]);

@UseGuards(AdminSecretGuard)
@Controller('admin')
@SkipThrottle({
  default: true,
  'payment-initiate': true,
  'paygate-webhook': true,
})
export class AdminController {
  private readonly logger = new Logger(AdminController.name);
  private payoutInfraReady = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: PaymentOrdersRepository,
    private readonly reconciliation: PaymentsReconciliationService,
    private readonly paygate: PaygateService,
    private readonly posthogQuery: PostHogQueryService,
  ) {}

  @Post('notifications/broadcast')
  async broadcastNotification(
    @Body()
    body: {
      audience?: AdminNotificationAudience;
      categoryLabel?: string | null;
      title?: string;
      description?: string | null;
      tabs?: AdminNotificationTab[];
      dedupeKey?: string | null;
    },
  ) {
    const audience = body?.audience;
    if (audience !== 'clients' && audience !== 'providers') {
      throw new BadRequestException('audience debe ser clients o providers');
    }
    const title = (body?.title ?? '').trim();
    if (!title) throw new BadRequestException('title es requerido');

    const tabs = Array.isArray(body?.tabs) && body.tabs.length > 0
      ? body.tabs
      : (['eventos'] as AdminNotificationTab[]);

    const dedupeKey = (body?.dedupeKey ?? '').trim() || null;

    // Insert per-user notifications by selecting the target audience.
    // Providers are profiles that have a matching row in `providers`.
    const sql = audience === 'providers'
      ? this.prisma.$executeRaw`
          INSERT INTO notifications (user_id, dedupe_key, category_label, title, description, relevant_tabs)
          SELECT p.user_id,
                 ${dedupeKey},
                 ${body.categoryLabel ?? null},
                 ${title},
                 ${body.description ?? null},
                 ${tabs}::notification_tab[]
          FROM profiles p
          JOIN providers pr ON pr.id = p.user_id
          ON CONFLICT (user_id, dedupe_key) DO NOTHING
        `
      : this.prisma.$executeRaw`
          INSERT INTO notifications (user_id, dedupe_key, category_label, title, description, relevant_tabs)
          SELECT p.user_id,
                 ${dedupeKey},
                 ${body.categoryLabel ?? null},
                 ${title},
                 ${body.description ?? null},
                 ${tabs}::notification_tab[]
          FROM profiles p
          LEFT JOIN providers pr ON pr.id = p.user_id
          WHERE pr.id IS NULL
          ON CONFLICT (user_id, dedupe_key) DO NOTHING
        `;

    await sql;
    return { ok: true };
  }

  @Get('overview-metrics')
  async getOverviewMetrics(): Promise<AdminOverviewMetricsResponse> {
    const from = new Date();
    from.setDate(from.getDate() - 30);

    const [activeEvents, totalEvents, tickets30d, gmv30d, posthogErrors30d] =
      await Promise.all([
      this.safeOverviewMetric('activeEvents', () =>
        this.prisma.event.count({ where: activeEventsWhere() }),
      ),
      this.safeOverviewMetric('totalEvents', () => this.prisma.event.count()),
      this.safeOverviewMetric('tickets30d', () =>
        this.prisma.ticket.count({
          where: { createdAt: { gte: from } },
        }),
      ),
      this.safeOverviewMetric('gmv30d', async () => {
        const result = await this.prisma.paymentOrder.aggregate({
          where: { status: 'paid', createdAt: { gte: from } },
          _sum: { amountCents: true },
        });
        return (result._sum.amountCents ?? 0) / 100;
      }),
      this.posthogQuery.countExceptionsLast30Days(),
    ]);

    return {
      activeEvents,
      totalEvents,
      tickets30d,
      posthogErrors30d,
      gmv30d,
    };
  }

  @Get('platform-status')
  async platformStatus(): Promise<AdminPlatformStatusResponse> {
    const windowMinutes = Number(process.env.MASS_SIGNUP_WINDOW_MINUTES) || 10;
    const threshold = Number(process.env.MASS_SIGNUP_THRESHOLD) || 30;
    const cooldownMinutes =
      Number(process.env.MASS_SIGNUP_COOLDOWN_MINUTES) || 60;
    const cron = process.env.MASS_SIGNUP_CRON ?? '*/1 * * * *';

    const recipients = (process.env.ROOT_ADMIN_EMAILS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const resendConfigured = Boolean((process.env.RESEND_API_KEY ?? '').trim());
    const recipientsConfigured = recipients.length > 0;

    const adminAuditLogsReady = await this.prisma.adminAuditLog
      .count({ take: 1 })
      .then(() => true)
      .catch(() => false);

    const paygateHealth = await this.paygate
      .health()
      .then((h) => ({ configured: h.configured, connectivityStatus: h.connectivity.status }))
      .catch(() => ({ configured: false, connectivityStatus: 'unknown' }));

    return {
      adminAuditLogsReady,
      paygate: paygateHealth,
      massSignupAlerts: {
        mode: 'cron',
        enabled: recipientsConfigured && resendConfigured,
        windowMinutes,
        threshold,
        cooldownMinutes,
        cron,
        recipientsConfigured,
        resendConfigured,
      },
    };
  }

  /** Best-effort KPI — missing tables or partial migrations must not 500 the dashboard. */
  private async safeOverviewMetric(
    label: string,
    fn: () => Promise<number>,
  ): Promise<number> {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`overview-metrics ${label} unavailable: ${message}`);
      return 0;
    }
  }

  @Get('events')
  async listEvents(
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('city') city?: string,
    @Query('providerId') providerId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ): Promise<AdminEventListResponse> {
    const take = clampLimit(limit, 200, 50);
    const where = buildWhere({ q, status, city, providerId, from, to });

    const [rows, total] = await Promise.all([
      this.prisma.event.findMany({
        where,
        include: { provider: true },
        orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
        take,
      }),
      this.prisma.event.count({ where }),
    ]);

    const items: AdminEventListItem[] = rows.map(mapAdminEventListItem);

    return { total, items };
  }

  @Get('events/:id')
  async getEvent(@Param('id') id: string): Promise<AdminEventDetailItem> {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: { provider: true },
    });
    if (!event) throw new NotFoundException('Event not found');
    return mapAdminEventDetail(event);
  }

  @Patch('events/:id/status')
  async updateEventStatus(
    @Param('id') id: string,
    @Body('status') status?: string,
  ): Promise<AdminEventActionResponse> {
    if (!status || !ALLOWED_STATUSES.has(status)) {
      throw new BadRequestException(
        `status must be one of ${Array.from(ALLOWED_STATUSES).join(', ')}`,
      );
    }
    const event = await this.prisma.event.findUnique({ where: { id } });
    if (!event) throw new NotFoundException('Event not found');

    const updated = await this.prisma.event.update({
      where: { id },
      data: { status, updatedAt: new Date() },
    });

    return { ok: true, id: updated.id, status: updated.status };
  }

  @Get('payouts/recent')
  async listRecentPayouts(@Query('limit') limit?: string) {
    const take = clampLimit(limit, 100, 20);
    await this.ensurePayoutRequestsTable();

    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        provider_id: string;
        provider_name: string | null;
        amount_cents: bigint;
        method: string;
        status: string;
        created_at: Date;
      }>
    >`
      SELECT
        r.id,
        r.provider_id,
        p.name AS provider_name,
        (r.amount * 100)::bigint AS amount_cents,
        r.method,
        r.status,
        r.created_at
      FROM provider_payout_requests r
      LEFT JOIN providers p ON p.id = r.provider_id
      ORDER BY r.created_at DESC
      LIMIT ${take}
    `;

    return {
      items: rows.map((row) => ({
        id: row.id,
        providerId: row.provider_id,
        providerName: row.provider_name?.trim() || 'Comercio sin nombre',
        amount: Number(row.amount_cents) / 100,
        method: row.method,
        status: row.status,
        createdAt: row.created_at.toISOString(),
      })),
    };
  }

  @Get('payments/summary')
  async getPaymentsSummary() {
    const [paidOrders, pendingOrders, failedOrders, gmvResult] =
      await Promise.all([
        this.orders.countByStatus('paid'),
        this.orders.countByStatus('pending_payment'),
        this.orders.countByStatus('failed'),
        this.prisma.paymentOrder.aggregate({
          where: { status: 'paid' },
          _sum: { amountCents: true },
        }),
      ]);

    const gmvCents = gmvResult._sum.amountCents ?? 0;

    return {
      gmvCents,
      paidOrdersCount: paidOrders,
      pendingOrdersCount: pendingOrders,
      failedOrdersCount: failedOrders,
      lastUpdated: new Date().toISOString(),
    };
  }

  private static readonly VALID_ORDER_STATUSES = new Set([
    'pending_payment',
    'paid',
    'failed',
    'cancelled',
    'refunded',
  ]);

  @Get('payments/orders')
  async listOrders(
    @Query('status') status?: string,
    @Query('eventId') eventId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    if (status && !AdminController.VALID_ORDER_STATUSES.has(status)) {
      throw new BadRequestException(
        `status must be one of: ${Array.from(AdminController.VALID_ORDER_STATUSES).join(', ')}`,
      );
    }
    if (startDate && Number.isNaN(new Date(startDate).getTime())) {
      throw new BadRequestException('startDate no es una fecha válida');
    }
    if (endDate && Number.isNaN(new Date(endDate).getTime())) {
      throw new BadRequestException('endDate no es una fecha válida');
    }
    if (startDate && endDate) {
      const startMs = new Date(startDate).getTime();
      const endMs = new Date(endDate).getTime();
      if (startMs > endMs) {
        throw new BadRequestException(
          'startDate no puede ser posterior a endDate',
        );
      }
    }
    return this.orders.listAdmin({
      status: status ? (status as PaymentOrderStatus) : undefined,
      eventId: eventId || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      limit: clampLimit(limit, 200, 50),
      offset: clampOffset(offset),
    });
  }

  @Post('payments/orders/:orderId/override')
  async overrideOrderStatus(
    @Param('orderId') orderId: string,
    @Body('status') status?: string,
    @Body('reason') reason?: string,
  ) {
    const valid = new Set(['paid', 'cancelled', 'failed']);
    if (!status || !valid.has(status)) {
      throw new BadRequestException(
        'status must be one of: paid, cancelled, failed',
      );
    }
    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      throw new BadRequestException('reason is required for manual override');
    }

    const existing = await this.prisma.paymentOrder.findUnique({
      where: { id: orderId },
    });
    if (!existing) {
      throw new NotFoundException('Orden de pago no encontrada');
    }

    const result = await this.prisma.paymentOrder.update({
      where: { id: orderId },
      data: {
        status: status as PaymentOrderStatus,
        resolutionSource: 'manual',
        updatedAt: new Date(),
      },
    });

    this.logger.log(
      `Manual override order=${orderId} from=${existing.status} to=${status} reason="${reason.trim()}"`,
    );

    let ticketsMinted: boolean | null = null;
    if (status === 'paid') {
      const existingTickets = await this.prisma.ticket.count({
        where: { paymentOrderId: orderId, cancelledAt: null },
      });
      ticketsMinted =
        existingTickets > 0
          ? true
          : await this.reconciliation.backfillTicketsForPaidOrder(result);
    }

    return {
      ok: true,
      orderId: result.id,
      status: result.status,
      ticketsMinted,
    };
  }

  /** Same DDL as ProvidersService.ensureInfrastructure — table may not exist until first provider call. */
  private async ensurePayoutRequestsTable() {
    if (this.payoutInfraReady) return;

    await this.prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS provider_payout_requests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        amount numeric(12,2) NOT NULL,
        method text NOT NULL,
        status text NOT NULL DEFAULT 'pending',
        created_by uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await this.prisma.$executeRaw`
      CREATE INDEX IF NOT EXISTS provider_payout_requests_provider_idx
      ON provider_payout_requests(provider_id, created_at DESC)
    `;
    this.payoutInfraReady = true;
  }
}

function clampOffset(raw: string | undefined, fallback = 0) {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

interface WhereParams {
  q?: string;
  status?: string;
  city?: string;
  providerId?: string;
  from?: string;
  to?: string;
}

function buildWhere(params: WhereParams) {
  const where: Record<string, unknown> = {};
  if (params.q) {
    where.title = { contains: params.q, mode: 'insensitive' };
  }
  if (params.status) {
    where.status = params.status;
  }
  if (params.city) {
    where.city = { equals: params.city, mode: 'insensitive' };
  }
  if (params.providerId) {
    where.providerId = params.providerId;
  }
  if (params.from || params.to) {
    where.startsAt = {
      ...(params.from ? { gte: new Date(params.from) } : {}),
      ...(params.to ? { lte: new Date(params.to) } : {}),
    };
  }
  return where;
}

function clampLimit(raw: string | undefined, max: number, fallback: number) {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.floor(parsed));
}
