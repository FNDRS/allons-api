import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import { attachMinPriceCents } from '../events/events-pricing.util';

/** Only these statuses are visible to clients (mirrors EventsController). */
const PUBLIC_EVENT_STATUSES = ['published', 'sold_out'] as const;

export type PublicProviderEventScope = 'upcoming' | 'past' | 'all';
export type PublicProviderEventType = 'single' | 'recurring_class';

export interface PublicProviderReviewDto {
  id: string;
  authorName: string;
  body: string;
  rating: number | null;
  createdAt: Date;
}

export interface PublicProviderProfileDto {
  id: string;
  name: string;
  handle: string | null;
  description: string | null;
  websiteUrl: string | null;
  logoUrl: string | null;
  brandLogoColor: string | null;
  /** Most frequent city across the comercio's public events. */
  city: string | null;
  /** Owner/admin contact — the same address GET /events/:id already exposes. */
  email: string | null;
  followerCount: number;
  eventCount: number;
  classCount: number;
  rating: number | null;
  reviewCount: number;
  reviews: PublicProviderReviewDto[];
  createdAt: Date;
}

/**
 * Client-facing comercio profile: the data behind the provider profile screen in
 * allons-mobile (info, counters, reviews, and the comercio's public catalogue).
 *
 * Deliberately excludes everything the provider panel owns (revenue, payouts,
 * staff, drafts). Follow state is NOT returned: these routes are unauthenticated
 * and the app already knows who it follows from GET /me/friends.
 */
@Injectable()
export class PublicProvidersService {
  constructor(private readonly prisma: PrismaService) {}

  async getPublicProfile(
    providerId: string,
  ): Promise<PublicProviderProfileDto> {
    const provider = await this.prisma.provider.findUnique({
      where: { id: providerId },
      include: {
        reviews: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });
    if (!provider) throw new NotFoundException('Comercio no encontrado');

    const [followerRows, eventCountRows, cityRows, ratingRows, contactRows] =
      await Promise.all([
        this.prisma.$queryRaw<Array<{ total: number }>>`
          SELECT COUNT(*)::int AS total
          FROM provider_follows
          WHERE provider_id = ${providerId}::uuid
        `,
        this.prisma.$queryRaw<Array<{ event_type: string; total: number }>>`
          SELECT event_type, COUNT(*)::int AS total
          FROM events
          WHERE provider_id = ${providerId}::uuid
            AND status IN (${Prisma.join([...PUBLIC_EVENT_STATUSES])})
          GROUP BY event_type
        `,
        this.prisma.$queryRaw<Array<{ city: string }>>`
          SELECT city
          FROM events
          WHERE provider_id = ${providerId}::uuid
            AND status IN (${Prisma.join([...PUBLIC_EVENT_STATUSES])})
            AND city IS NOT NULL
            AND btrim(city) <> ''
          GROUP BY city
          ORDER BY COUNT(*) DESC, city ASC
          LIMIT 1
        `,
        this.prisma.$queryRaw<
          Array<{ avg_rating: number | null; total: number }>
        >`
          SELECT AVG(rating)::float8 AS avg_rating, COUNT(*)::int AS total
          FROM provider_reviews
          WHERE provider_id = ${providerId}::uuid
            AND rating IS NOT NULL
        `,
        this.prisma.$queryRaw<Array<{ email: string | null }>>`
          SELECT email
          FROM provider_members
          WHERE provider_id = ${providerId}::uuid
            AND active = true
            AND email IS NOT NULL
            AND btrim(email) <> ''
          ORDER BY
            CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END ASC,
            updated_at DESC
          LIMIT 1
        `,
      ]);

    const brandRows = await this.prisma.$queryRaw<
      Array<{ logo_color: string | null }>
    >`
      SELECT logo_color
      FROM provider_brand_settings
      WHERE provider_id = ${providerId}::uuid
      LIMIT 1
    `;

    const countByType = new Map(
      eventCountRows.map((row) => [row.event_type, row.total]),
    );
    const avgRating = ratingRows[0]?.avg_rating ?? null;

    return {
      id: provider.id,
      name: provider.name,
      handle: provider.handle,
      description: provider.description,
      websiteUrl: provider.websiteUrl,
      logoUrl: provider.logoUrl,
      brandLogoColor: brandRows[0]?.logo_color ?? null,
      city: cityRows[0]?.city ?? null,
      email: contactRows[0]?.email?.trim() || null,
      followerCount: followerRows[0]?.total ?? 0,
      eventCount: countByType.get('single') ?? 0,
      classCount: countByType.get('recurring_class') ?? 0,
      rating: avgRating === null ? null : Math.round(avgRating * 10) / 10,
      reviewCount: ratingRows[0]?.total ?? 0,
      reviews: (provider.reviews ?? []).map((review) => ({
        id: review.id,
        authorName: review.authorName,
        body: review.body,
        rating: review.rating,
        createdAt: review.createdAt,
      })),
      createdAt: provider.createdAt,
    };
  }

  /**
   * The comercio's public catalogue.
   *
   * A recurring class is always `upcoming` while it is published: its `startsAt`
   * is the first session, so a class that started three months ago and still
   * runs weekly must not fall into `past`. Comercios end a program by moving it
   * out of the public statuses, which drops it from both scopes.
   */
  async listPublicEvents(
    providerId: string,
    options: {
      scope?: PublicProviderEventScope;
      type?: PublicProviderEventType;
      limit?: number;
    } = {},
  ) {
    const provider = await this.prisma.provider.findUnique({
      where: { id: providerId },
      select: { id: true },
    });
    if (!provider) throw new NotFoundException('Comercio no encontrado');

    const scope = options.scope ?? 'upcoming';
    const now = new Date();

    const scopeClause: Prisma.EventWhereInput =
      scope === 'all'
        ? {}
        : scope === 'past'
          ? { eventType: { not: 'recurring_class' }, startsAt: { lt: now } }
          : {
              OR: [
                { startsAt: { gte: now } },
                { startsAt: null },
                { eventType: 'recurring_class' },
              ],
            };

    const rows = await this.prisma.event.findMany({
      where: {
        providerId,
        status: { in: [...PUBLIC_EVENT_STATUSES] },
        ...(options.type ? { eventType: options.type } : {}),
        ...scopeClause,
      },
      include: {
        interests: { include: { interest: true } },
        media: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          select: { id: true, url: true },
        },
      },
      orderBy:
        scope === 'past'
          ? [{ startsAt: 'desc' }, { createdAt: 'desc' }]
          : [{ startsAt: 'asc' }, { createdAt: 'desc' }],
      take: options.limit ?? 50,
    });

    const mapped = rows.map((event) => ({
      ...event,
      types: (event.interests ?? []).map((x) => x.interest.slug),
    }));
    return attachMinPriceCents(this.prisma, mapped);
  }
}
