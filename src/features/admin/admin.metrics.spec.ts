import { activeEventsWhere } from './admin.metrics';

describe('activeEventsWhere', () => {
  const now = new Date('2026-05-27T12:00:00.000Z');

  it('includes published and sold_out statuses', () => {
    expect(activeEventsWhere(now).status).toEqual({
      in: ['published', 'sold_out'],
    });
  });

  it('keeps events without end date or with future end date', () => {
    expect(activeEventsWhere(now).OR).toEqual([
      { endsAt: null },
      { endsAt: { gte: now } },
    ]);
  });
});
