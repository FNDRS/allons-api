import { computeEntryTypeRemaining } from './events-availability.util';

describe('computeEntryTypeRemaining', () => {
  const base = { capacity: 0, soldTickets: 0, total: 0, soldCount: 0 };

  it('returns null when neither cap is set — an uncapped event is not sold out', () => {
    expect(computeEntryTypeRemaining(base)).toBeNull();
  });

  it('uses the event capacity when only that is set', () => {
    expect(
      computeEntryTypeRemaining({ ...base, capacity: 10, soldTickets: 4 }),
    ).toBe(6);
  });

  it('uses the entry type total when only that is set', () => {
    expect(computeEntryTypeRemaining({ ...base, total: 8, soldCount: 3 })).toBe(
      5,
    );
  });

  // The event cap is the one checkout enforces, so it has to win when tighter
  // even if the tier still has allotment on paper.
  it('takes the event cap when it is tighter than the tier allotment', () => {
    expect(
      computeEntryTypeRemaining({
        capacity: 3,
        soldTickets: 2,
        total: 20,
        soldCount: 0,
      }),
    ).toBe(1);
  });

  it('takes the tier allotment when it is tighter than the event cap', () => {
    expect(
      computeEntryTypeRemaining({
        capacity: 100,
        soldTickets: 0,
        total: 5,
        soldCount: 5,
      }),
    ).toBe(0);
  });

  it('reports zero rather than a negative when a cap is already exceeded', () => {
    expect(
      computeEntryTypeRemaining({ ...base, capacity: 5, soldTickets: 9 }),
    ).toBe(0);
    expect(computeEntryTypeRemaining({ ...base, total: 5, soldCount: 9 })).toBe(
      0,
    );
  });

  // The seeded "last spot" case: capacity 3 with 2 live tickets.
  it('reports exactly one seat on a last-spot event', () => {
    expect(
      computeEntryTypeRemaining({
        capacity: 3,
        soldTickets: 2,
        total: 3,
        soldCount: 2,
      }),
    ).toBe(1);
  });

  // The seeded sold-out case: capacity 4 filled with 4 live tickets.
  it('reports zero on a sold-out event', () => {
    expect(
      computeEntryTypeRemaining({
        capacity: 4,
        soldTickets: 4,
        total: 4,
        soldCount: 4,
      }),
    ).toBe(0);
  });

  it('ignores a negative capacity the same way it ignores zero', () => {
    expect(
      computeEntryTypeRemaining({ ...base, capacity: -1, soldTickets: 3 }),
    ).toBeNull();
  });
});
