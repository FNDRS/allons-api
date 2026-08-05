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
  event: { startsAt?: Date | string | null; status?: string | null },
  now: Date = new Date(),
): boolean {
  if (event.status === 'ended') return false;
  if (event.startsAt == null) return true;

  const startsAt =
    event.startsAt instanceof Date ? event.startsAt : new Date(event.startsAt);
  if (Number.isNaN(startsAt.getTime())) return true;

  return startsAt.getTime() > now.getTime();
}
