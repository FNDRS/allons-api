import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentOrdersRepository } from '../payments/payment-orders.repository';
import { AdminSecretGuard } from './admin-secret.guard';
import type {
  AdminEventActionResponse,
  AdminEventListItem,
  AdminEventListResponse,
  AdminOverviewMetricsResponse,
} from './admin.types';

const ALLOWED_STATUSES = new Set([
  'draft',
  'published',
  'sold_out',
  'ended',
  'suspended',
]);

@UseGuards(AdminSecretGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: PaymentOrdersRepository,
  ) {}

  @Get('overview-metrics')
  async getOverviewMetrics(): Promise<AdminOverviewMetricsResponse> {
    const from = new Date();
    from.setDate(from.getDate() - 30);

    const activeEventsPromise = this.prisma.event.count({
      where: {
        status: 'published',
        OR: [{ endsAt: null }, { endsAt: { gte: new Date() } }],
      },
    });
    const tickets30dPromise = this.prisma.ticket.count({
      where: { createdAt: { gte: from } },
    });

    const scans30dPromise = this.prisma.$queryRaw<Array<{ total: number }>>`
        SELECT COUNT(*)::int AS total
        FROM provider_scan_records
        WHERE status = 'valid'
          AND scanned_at >= ${from}::timestamptz
      `
      .then((rows) => Number(rows[0]?.total ?? 0))
      .catch(() => 0);

    const [activeEvents, tickets30d, scans30d] = await Promise.all([
      activeEventsPromise,
      tickets30dPromise,
      scans30dPromise,
    ]);

    return {
      activeEvents,
      tickets30d,
      scans30d,
      gmv30d: null,
    };
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

    const items: AdminEventListItem[] = rows.map((e) => ({
      id: e.id,
      title: e.title,
      description: e.description,
      status: e.status,
      eventType: e.eventType,
      recurrence: e.recurrence,
      startsAt: e.startsAt?.toISOString() ?? null,
      endsAt: e.endsAt?.toISOString() ?? null,
      city: e.city,
      venue: e.venue,
      themeColor: e.themeColor,
      capacity: e.capacity,
      ticketMode: e.ticketMode,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
      provider: e.provider
        ? {
            id: e.provider.id,
            name: e.provider.name,
            handle: e.provider.handle,
          }
        : null,
    }));

    return { total, items };
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

  @Get('payments/summary')
  async getPaymentsSummary() {
    const paidOrders = await this.orders.countByStatus('paid');
    const pendingOrders = await this.orders.countByStatus('pending_payment');
    const failedOrders = await this.orders.countByStatus('failed');
    const paidList = await this.orders.listByStatus('paid');

    const gmvCents = paidList.reduce((sum, o) => sum + o.amountCents, 0);

    return {
      gmvCents,
      paidOrdersCount: paidOrders,
      pendingOrdersCount: pendingOrders,
      failedOrdersCount: failedOrders,
      lastUpdated: new Date().toISOString(),
    };
  }

  @Get('payments/orders')
  async listOrders(
    @Query('status') status?: string,
    @Query('eventId') eventId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.orders.listAdmin({
      status: status || undefined,
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
    const result = await this.prisma.paymentOrder.update({
      where: { id: orderId },
      data: {
        status: status as any,
        updatedAt: new Date(),
      },
    });
    return { ok: true, orderId: result.id, status: result.status };
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
