import type { Prisma } from '../../../generated/prisma';

/** Matches provider app: scanner/home treat published + sold_out as live. */
export const ACTIVE_EVENT_STATUSES = ['published', 'sold_out'] as const;

/** Published or sold_out and not past `ends_at` (when set). */
export function activeEventsWhere(now = new Date()): Prisma.EventWhereInput {
  return {
    status: { in: [...ACTIVE_EVENT_STATUSES] },
    OR: [{ endsAt: null }, { endsAt: { gte: now } }],
  };
}
