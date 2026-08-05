import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { computeEntryTypeRemaining } from './events-availability.util';
import { attachMinPriceCents } from './events-pricing.util';
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

    const rows = await this.prisma.event.findMany({
      where,
      include: { provider: true, interests: { include: { interest: true } } },
      orderBy: [{ startsAt: 'asc' }, { createdAt: 'desc' }],
    });
    const mapped = rows.map((e) => ({
      ...e,
      types: (e.interests ?? []).map((x) => x.interest.slug),
    }));
    return attachMinPriceCents(this.prisma, mapped);
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

    const rows = await this.prisma.event.findMany({
      where: {
        OR: [{ startsAt: { gte: new Date() } }, { startsAt: null }],
        ...where,
      },
      include: { provider: true, interests: { include: { interest: true } } },
      orderBy: [{ startsAt: 'asc' }, { createdAt: 'desc' }],
      take: 5,
    });
    const mapped = rows.map((e) => ({
      ...e,
      types: (e.interests ?? []).map((x) => x.interest.slug),
    }));
    return attachMinPriceCents(this.prisma, mapped);
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

    const rows = await this.prisma.event.findMany({
      where,
      include: { provider: true, interests: { include: { interest: true } } },
      orderBy: { createdAt: 'desc' },
      take: 6,
    });
    const mapped = rows.map((e) => ({
      ...e,
      types: (e.interests ?? []).map((x) => x.interest.slug),
    }));
    return attachMinPriceCents(this.prisma, mapped);
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
    if (
      !PUBLIC_EVENT_STATUSES.includes(
        status as (typeof PUBLIC_EVENT_STATUSES)[number],
      )
    ) {
      throw new NotFoundException('Evento no encontrado');
    }

    const ticketTypeRows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        price: number;
        total: number;
        sold_count: number;
        plan_kind: string | null;
        credits: number | null;
        validity_days: number | null;
      }>
    >`
      SELECT id, name, price::float8 AS price, total, sold_count,
             plan_kind, credits, validity_days
      FROM provider_event_ticket_types
      WHERE event_id = ${id}::uuid
        AND active = true
      ORDER BY sort_order ASC, created_at ASC
    `;

    // Both caps are derived from live `tickets` rows rather than from
    // `sold_count`, for two separate reasons:
    //
    // - the event cap is what checkout compares against `capacity`
    //   (`me-payments.service.ts`), so only the row count decides whether a
    //   purchase is accepted;
    // - the per-tier counter drifts. `cancelTicket` does not decrement the
    //   cancelled ticket's own `ticketTypeId`; it re-runs an ORDER BY and
    //   decrements whichever tier sorts first (`me.service.ts`). Cancelling a
    //   VIP ticket therefore decrements General, leaving VIP's `sold_count`
    //   inflated — which would have reported a tier as full while a seat was
    //   actually free, blocking a purchase checkout would have accepted.
    const [soldTickets, soldByTypeRows] = await Promise.all([
      this.prisma.ticket.count({ where: { eventId: id, cancelledAt: null } }),
      this.prisma.$queryRaw<Array<{ ticket_type_id: string; n: number }>>`
        SELECT ticket_type_id::text AS ticket_type_id, count(*)::int AS n
        FROM tickets
        WHERE event_id = ${id}::uuid
          AND cancelled_at IS NULL
          AND ticket_type_id IS NOT NULL
        GROUP BY ticket_type_id
      `,
    ]);
    const soldByTypeId = new Map(
      soldByTypeRows.map((row) => [row.ticket_type_id, Number(row.n)]),
    );
    const eventCapacity = Number(
      (event as { capacity?: number | null }).capacity ?? 0,
    );

    // For a recurring class these are the packages (paquetes); for a single
    // event they are the entry tiers. Same rows, `planKind` tells them apart.
    const entryTypes = (ticketTypeRows ?? []).map((row) => {
      const remaining = computeEntryTypeRemaining({
        capacity: eventCapacity,
        soldTickets,
        total: row.total,
        soldCount: soldByTypeId.get(row.id) ?? 0,
      });
      return {
        id: row.id,
        name: row.name,
        priceCents: Math.round(Number(row.price) * 100),
        planKind: row.plan_kind ?? null,
        credits: row.credits ?? null,
        validityDays: row.validity_days ?? null,
        // Derived from `remaining` rather than from `sold_count`, so the two
        // can never disagree — previously this could report soldOut while
        // `remaining` said seats were free, since only one of them had been
        // moved off the drifting counter. `null` remaining means uncapped,
        // which is never sold out.
        soldOut: remaining === 0,
        /** Seats still buyable, or null when neither cap applies. */
        remaining,
      };
    });

    const providerContactRows = event.providerId
      ? await this.prisma.$queryRaw<Array<{ email: string | null }>>`
          SELECT email
          FROM provider_members
          WHERE provider_id = ${event.providerId}::uuid
            AND active = true
            AND email IS NOT NULL
            AND btrim(email) <> ''
          ORDER BY
            CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END ASC,
            updated_at DESC
          LIMIT 1
        `
      : [];
    const providerEmail = providerContactRows[0]?.email?.trim() || null;

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
        // This endpoint is public (unauthenticated). Never expose holder_email
        // here. For attendees without a linked profile, derive a stable opaque
        // id from the email so de-duplication and client keys still work
        // without leaking the address itself.
        id:
          row.user_id ??
          `anon:${createHash('sha256')
            .update(row.holder_email.toLowerCase())
            .digest('hex')
            .slice(0, 16)}`,
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
      provider: event.provider
        ? {
            id: event.provider.id,
            name: event.provider.name,
            handle: event.provider.handle,
            description: event.provider.description,
            websiteUrl: event.provider.websiteUrl,
            logoUrl: event.provider.logoUrl,
            email: providerEmail,
          }
        : null,
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
