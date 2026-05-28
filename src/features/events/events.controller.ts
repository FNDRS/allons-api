import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { parseDate, parseList } from './events.types';

const PUBLIC_EVENT_STATUSES = ['published', 'sold_out'] as const;

@Controller('events')
export class EventsController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Inclusive filters (`city` / `cities`) are mutually exclusive with `exclude_cities`;
   * sending both yields HTTP 400.
   */
  private buildWhere(params: {
    city?: string;
    cities?: string | string[];
    excludeCities?: string | string[];
    types?: string | string[];
    from?: string;
    to?: string;
  }) {
    const cities = [
      ...new Set([params.city, ...parseList(params.cities)]),
    ].filter(Boolean) as string[];
    const excludeCities = parseList(params.excludeCities);
    const types = parseList(params.types);
    const from = parseDate(params.from);
    const to = parseDate(params.to);

    if (cities.length > 0 && excludeCities.length > 0) {
      throw new BadRequestException(
        'Usa city/cities (inclusivo) o exclude_cities (exclusivo); no ambos a la vez.',
      );
    }

    let cityClause: Record<string, unknown> = {};
    if (excludeCities.length > 0) {
      cityClause = { city: { notIn: excludeCities } };
    } else if (cities.length > 0) {
      cityClause = { city: { in: cities } };
    }

    return {
      ...cityClause,
      status: { in: [...PUBLIC_EVENT_STATUSES] },
      ...(types.length > 0
        ? {
            interests: {
              some: {
                interest: {
                  slug: { in: types },
                },
              },
            },
          }
        : {}),
      ...(from || to
        ? {
            startsAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    };
  }

  @Get()
  async list(
    @Query('city') city?: string,
    @Query('cities') cities?: string | string[],
    @Query('exclude_cities') exclude_cities?: string | string[],
    @Query('types') types?: string | string[],
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const where = this.buildWhere({
      city,
      cities,
      excludeCities: exclude_cities,
      types,
      from,
      to,
    });

    return this.prisma.event
      .findMany({
        where,
        include: { provider: true, interests: { include: { interest: true } } },
        orderBy: [{ startsAt: 'asc' }, { createdAt: 'desc' }],
      })
      .then((rows) =>
        rows.map((e) => ({
          ...e,
          types: (e.interests ?? []).map((x) => x.interest.slug),
        })),
      );
  }

  @Get('top')
  async top(
    @Query('cities') cities?: string | string[],
    @Query('exclude_cities') exclude_cities?: string | string[],
    @Query('types') types?: string | string[],
  ) {
    const where = this.buildWhere({
      cities,
      excludeCities: exclude_cities,
      types,
    });

    return this.prisma.event
      .findMany({
        where: {
          OR: [{ startsAt: { gte: new Date() } }, { startsAt: null }],
          ...where,
        },
        include: { provider: true, interests: { include: { interest: true } } },
        orderBy: [{ startsAt: 'asc' }, { createdAt: 'desc' }],
        take: 5,
      })
      .then((rows) =>
        rows.map((e) => ({
          ...e,
          types: (e.interests ?? []).map((x) => x.interest.slug),
        })),
      );
  }

  @Get('friends')
  async friends(
    @Query('cities') cities?: string | string[],
    @Query('exclude_cities') exclude_cities?: string | string[],
    @Query('types') types?: string | string[],
  ) {
    const where = this.buildWhere({
      cities,
      excludeCities: exclude_cities,
      types,
    });

    return this.prisma.event
      .findMany({
        where,
        include: { provider: true, interests: { include: { interest: true } } },
        orderBy: { createdAt: 'desc' },
        take: 6,
      })
      .then((rows) =>
        rows.map((e) => ({
          ...e,
          types: (e.interests ?? []).map((x) => x.interest.slug),
        })),
      );
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: {
        provider: {
          include: {
            reviews: { orderBy: { createdAt: 'desc' }, take: 10 },
          },
        },
        interests: { include: { interest: true } },
        media: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
        _count: { select: { attendees: true } },
      },
    });

    if (!event) throw new NotFoundException('Evento no encontrado');

    const status = String((event as { status?: string }).status ?? 'draft');
    if (!PUBLIC_EVENT_STATUSES.includes(status as (typeof PUBLIC_EVENT_STATUSES)[number])) {
      throw new NotFoundException('Evento no encontrado');
    }

    const ticketTypeRows = await this.prisma.$queryRaw<
      Array<{ id: string; name: string; price: number }>
    >`
      SELECT id, name, price::float8 AS price
      FROM provider_event_ticket_types
      WHERE event_id = ${id}::uuid
        AND active = true
      ORDER BY created_at ASC
    `;

    const entryTypes = (ticketTypeRows ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      priceCents: Math.round(Number(row.price) * 100),
    }));

    const refundPolicyRaw = String(
      (event as { refundPolicy?: string }).refundPolicy ?? 'none',
    );
    const refundPolicy =
      refundPolicyRaw === 'partial' || refundPolicyRaw === 'full'
        ? refundPolicyRaw
        : 'none';

    const attendeeRows = await this.prisma.$queryRaw<
      Array<{
        holder_email: string;
        holder_name: string;
        user_id: string | null;
        full_name: string | null;
        username: string | null;
        avatar_url: string | null;
        avatar_color: string | null;
      }>
    >`
      SELECT
        th.holder_email,
        th.holder_name,
        p.user_id,
        p.full_name,
        p.username,
        p.avatar_url,
        p.avatar_color
      FROM tickets t
      JOIN ticket_holders th ON th.ticket_id = t.id
      LEFT JOIN profiles p ON p.user_id = th.holder_user_id
      WHERE t.event_id = ${id}::uuid
    `;

    const seen = new Set<string>();
    const attendees = attendeeRows
      .map((row) => ({
        id: row.user_id ?? row.holder_email.toLowerCase(),
        name: row.full_name ?? row.username ?? row.holder_name,
        avatarUrl: row.avatar_url,
        avatarColor: row.avatar_color ?? '#5a4a4a',
      }))
      .filter((row) => {
        if (seen.has(row.id)) return false;
        seen.add(row.id);
        return true;
      });

    const coverUrl = event.coverImageUrl?.trim() ?? '';
    const mediaGallery = (event.media ?? []).map((m) => ({
      id: m.id,
      url: m.url,
    }));
    const gallery =
      coverUrl && !mediaGallery.some((m) => m.url === coverUrl)
        ? [{ id: 'cover', url: coverUrl }, ...mediaGallery]
        : mediaGallery;

    return {
      ...event,
      attendeeCount: attendees.length,
      attendees,
      types: (event.interests ?? []).map((x) => x.interest.slug),
      gallery,
      providerReviews: (event.provider?.reviews ?? []).map((r) => ({
        id: r.id,
        authorName: r.authorName,
        body: r.body,
        rating: r.rating,
        createdAt: r.createdAt,
      })),
      entryTypes,
      refundPolicy,
      refundPartialPct:
        (event as { refundPartialPct?: number | null }).refundPartialPct ??
        null,
      refundDeadlineDays:
        (event as { refundDeadlineDays?: number | null }).refundDeadlineDays ??
        null,
    };
  }
}
