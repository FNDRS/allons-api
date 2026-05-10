import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminSecretGuard } from './admin-secret.guard';
import type {
  AdminEventActionResponse,
  AdminEventListItem,
  AdminEventListResponse,
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
  constructor(private readonly prisma: PrismaService) {}

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
