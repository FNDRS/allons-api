import { Prisma } from '../../../generated/prisma';
import type { PrismaService } from '../../prisma/prisma.service';

export async function attachMinPriceCents<T extends { id: string }>(
  prisma: PrismaService,
  events: T[],
): Promise<Array<T & { minPriceCents: number | null }>> {
  if (events.length === 0) return [];

  const rows = await prisma.$queryRaw<
    Array<{ event_id: string; min_price: number | null }>
  >(Prisma.sql`
    SELECT event_id, MIN(price)::float8 AS min_price
    FROM provider_event_ticket_types
    WHERE event_id IN (${Prisma.join(
      events.map((event) => Prisma.sql`${event.id}::uuid`),
    )})
      AND active = true
    GROUP BY event_id
  `);

  const minPriceByEventId = new Map(
    rows.map((row) => [
      row.event_id,
      Math.round(Number(row.min_price) * 100),
    ]),
  );

  return events.map((event) => ({
    ...event,
    minPriceCents: minPriceByEventId.get(event.id) ?? null,
  }));
}
