/**
 * How many tickets of one entry type a client may still buy.
 *
 * Two independent caps apply, and the smaller one wins:
 *
 * - the event's own `capacity`, which is what checkout actually enforces —
 *   `me-payments.service.ts` counts live `tickets` rows against it and rejects
 *   the purchase, so this is the number that decides success or failure;
 * - the entry type's `total`, the per-tier allotment the comercio configured.
 *
 * Either cap at zero or below means "no limit" — the same reading the
 * `soldOut` flag and the checkout guard already use — so an event with
 * `capacity = 0` is unbounded rather than sold out.
 *
 * `null` means unbounded, which the client must treat as "no cap to show"
 * rather than as zero.
 */
export function computeEntryTypeRemaining(input: {
  /** `events.capacity`; 0 or less means no event-level limit. */
  capacity: number;
  /** Live, non-cancelled `tickets` rows for the event. */
  soldTickets: number;
  /** `provider_event_ticket_types.total`; 0 or less means no per-tier limit. */
  total: number;
  /**
   * Live, non-cancelled `tickets` rows carrying this entry type. Deliberately
   * not `provider_event_ticket_types.sold_count`: that counter drifts, because
   * `cancelTicket` decrements whichever tier sorts first rather than the
   * cancelled ticket's own.
   */
  soldCount: number;
}): number | null {
  const caps: number[] = [];

  if (input.capacity > 0) {
    caps.push(Math.max(0, input.capacity - input.soldTickets));
  }
  if (input.total > 0) {
    caps.push(Math.max(0, input.total - input.soldCount));
  }

  if (caps.length === 0) return null;
  return Math.min(...caps);
}
