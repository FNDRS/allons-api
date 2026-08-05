import { isEventOpenForReservation } from './event-reservability.util';

const NOW = new Date('2026-08-05T12:00:00.000Z');
const hoursFromNow = (h: number) =>
  new Date(NOW.getTime() + h * 60 * 60 * 1000);

describe('isEventOpenForReservation', () => {
  it('accepts an event that has not started', () => {
    expect(
      isEventOpenForReservation(
        { startsAt: hoursFromNow(2), status: 'published' },
        NOW,
      ),
    ).toBe(true);
  });

  it('rejects an event that already started', () => {
    expect(
      isEventOpenForReservation(
        { startsAt: hoursFromNow(-1), status: 'published' },
        NOW,
      ),
    ).toBe(false);
  });

  // The boundary the client already advertises as the deadline.
  it('rejects an event starting exactly now', () => {
    expect(
      isEventOpenForReservation({ startsAt: NOW, status: 'published' }, NOW),
    ).toBe(false);
  });

  it('rejects an ended event even when it is still in the future', () => {
    expect(
      isEventOpenForReservation(
        { startsAt: hoursFromNow(48), status: 'ended' },
        NOW,
      ),
    ).toBe(false);
  });

  // Undated events are treated as always-current by the listing endpoints, so
  // closing reservations on them would make them unbookable forever.
  it('accepts an undated event', () => {
    expect(
      isEventOpenForReservation({ startsAt: null, status: 'published' }, NOW),
    ).toBe(true);
  });

  it('accepts an event with no startsAt field at all', () => {
    expect(isEventOpenForReservation({ status: 'published' }, NOW)).toBe(true);
  });

  it('accepts an ISO string date, the shape a JSON payload carries', () => {
    expect(
      isEventOpenForReservation({ startsAt: '2026-08-06T12:00:00.000Z' }, NOW),
    ).toBe(true);
    expect(
      isEventOpenForReservation({ startsAt: '2026-08-04T12:00:00.000Z' }, NOW),
    ).toBe(false);
  });

  // Rather than blocking a sale over data we cannot read.
  it('accepts rather than rejects when the date is unparseable', () => {
    expect(isEventOpenForReservation({ startsAt: 'not-a-date' }, NOW)).toBe(
      true,
    );
  });

  it('leaves sold_out to the capacity check, not this one', () => {
    expect(
      isEventOpenForReservation(
        { startsAt: hoursFromNow(5), status: 'sold_out' },
        NOW,
      ),
    ).toBe(true);
  });
});

describe('isEventOpenForReservation — recurring classes', () => {
  // A recurring class's startsAt is its first session, and the program runs
  // weekly from there. The public catalog lists them as upcoming forever, so
  // the start-time cutoff must not apply.
  it('stays open long after its first session', () => {
    expect(
      isEventOpenForReservation(
        {
          startsAt: hoursFromNow(-24 * 90),
          status: 'published',
          eventType: 'recurring_class',
        },
        NOW,
      ),
    ).toBe(true);
  });

  it('stays open when its first session is today', () => {
    expect(
      isEventOpenForReservation(
        { startsAt: NOW, status: 'published', eventType: 'recurring_class' },
        NOW,
      ),
    ).toBe(true);
  });

  // `ended` is the comercio's own statement and still wins over the type.
  it('closes when the comercio marks the class ended', () => {
    expect(
      isEventOpenForReservation(
        {
          startsAt: hoursFromNow(-24),
          status: 'ended',
          eventType: 'recurring_class',
        },
        NOW,
      ),
    ).toBe(false);
  });

  it('still applies the cutoff to a single event', () => {
    expect(
      isEventOpenForReservation(
        {
          startsAt: hoursFromNow(-1),
          status: 'published',
          eventType: 'single',
        },
        NOW,
      ),
    ).toBe(false);
  });

  it('treats a missing eventType as a single event', () => {
    expect(isEventOpenForReservation({ startsAt: hoursFromNow(-1) }, NOW)).toBe(
      false,
    );
  });
});
