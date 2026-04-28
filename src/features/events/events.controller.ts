import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { parseDate, parseList } from './events.types';

@Controller('events')
export class EventsController {
  constructor(private readonly prisma: PrismaService) {}

  private buildWhere(params: {
    city?: string;
    cities?: string | string[];
    types?: string | string[];
    from?: string;
    to?: string;
  }) {
    const cities = [
      ...new Set([params.city, ...parseList(params.cities)]),
    ].filter(Boolean) as string[];
    const types = parseList(params.types);
    const from = parseDate(params.from);
    const to = parseDate(params.to);

    return {
      ...(cities.length > 0 ? { city: { in: cities } } : {}),
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
    @Query('types') types?: string | string[],
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const where = this.buildWhere({ city, cities, types, from, to });

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
    @Query('types') types?: string | string[],
  ) {
    const where = this.buildWhere({ cities, types });

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
    @Query('types') types?: string | string[],
  ) {
    const where = this.buildWhere({ cities, types });

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

    if (!event) throw new NotFoundException('Event not found');

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

    return {
      ...event,
      attendeeCount: attendees.length,
      attendees,
      types: (event.interests ?? []).map((x) => x.interest.slug),
      gallery: (event.media ?? []).map((m) => ({ id: m.id, url: m.url })),
      providerReviews: (event.provider?.reviews ?? []).map((r) => ({
        id: r.id,
        authorName: r.authorName,
        body: r.body,
        rating: r.rating,
        createdAt: r.createdAt,
      })),
    };
  }
}
