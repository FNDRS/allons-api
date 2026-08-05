/**
 * Whether an event still accepts reservations.
 *
 * Reservations close when the event starts. That is not an arbitrary choice:
 * the client already tells the user so, labelling the deadline as "cierre de
 * reservas del evento" next to the event's start time, so the server should
 * enforce exactly what the UI promises.
 *
 * A null `startsAt` means undated, which the listing endpoints already treat as
 * always-current (`OR: [{ startsAt: { gte: now } }, { startsAt: null }]`), so
 * it stays open here too.
 *
 * `ended` is rejected regardless of the date: a comercio marking an event
 * finished is a stronger statement than the clock.
 */
export function isEventOpenForReservation(
  event: {
    startsAt?: Date | string | null;
    status?: string | null;
    eventType?: string | null;
  },
  now: Date = new Date(),
): boolean {
  if (event.status === 'ended') return false;

  // A recurring class's `startsAt` is its *first* session, not a deadline: the
  // program keeps running weekly afterwards. The public catalog says as much,
  // listing `recurring_class` as upcoming unconditionally and excluding it
  // from `past` outright (`public-providers.service.ts`), and `createTicket`
  // already branches on `isRecurringClass`. Applying the cutoff here would
  // have closed every ongoing class the day after its first session.
  if (event.eventType === 'recurring_class') return true;

  if (event.startsAt == null) return true;

  const startsAt =
    event.startsAt instanceof Date ? event.startsAt : new Date(event.startsAt);
  if (Number.isNaN(startsAt.getTime())) return true;

  return startsAt.getTime() > now.getTime();
}
