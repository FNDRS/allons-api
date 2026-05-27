import { deriveSubscription } from './subscription.types';

const EMPTY_USAGE = { activeEvents: 0, members: 0, staff: 0 };

describe('deriveSubscription', () => {
  it('derives past_due when the paid term just ended (within grace)', () => {
    const sub = deriveSubscription(
      {
        subscription_plan: 'basico',
        subscription_status: 'active',
        subscription_period_end: new Date(
          Date.now() - 86_400_000,
        ).toISOString(),
      },
      EMPTY_USAGE,
      true,
    );

    expect(sub.status).toBe('past_due');
    expect(sub.planId).toBe('basico');
  });

  it('derives expired when the paid term ended past the grace window', () => {
    const sub = deriveSubscription(
      {
        subscription_plan: 'basico',
        subscription_status: 'active',
        subscription_period_end: new Date(
          Date.now() - 8 * 86_400_000,
        ).toISOString(),
      },
      EMPTY_USAGE,
      true,
    );

    expect(sub.status).toBe('expired');
    expect(sub.planId).toBe('basico');
  });

  it('keeps active when period_end is still in the future', () => {
    const sub = deriveSubscription(
      {
        subscription_plan: 'pro',
        subscription_status: 'active',
        subscription_period_end: new Date(
          Date.now() + 86_400_000,
        ).toISOString(),
      },
      EMPTY_USAGE,
      true,
    );

    expect(sub.status).toBe('active');
  });

  it('derives past_due on the exact grace boundary (7 days after term end)', () => {
    const sub = deriveSubscription(
      {
        subscription_plan: 'basico',
        subscription_status: 'active',
        subscription_period_end: new Date(
          Date.now() - 7 * 86_400_000,
        ).toISOString(),
      },
      EMPTY_USAGE,
      true,
    );

    expect(sub.status).toBe('past_due');
  });

  it('derives expired one ms after the grace boundary', () => {
    const graceMs = 7 * 86_400_000;
    const sub = deriveSubscription(
      {
        subscription_plan: 'basico',
        subscription_status: 'active',
        subscription_period_end: new Date(
          Date.now() - graceMs - 1,
        ).toISOString(),
      },
      EMPTY_USAGE,
      true,
    );

    expect(sub.status).toBe('expired');
  });

  it('derives past_due when period_end is exactly now', () => {
    const sub = deriveSubscription(
      {
        subscription_plan: 'pro',
        subscription_status: 'active',
        subscription_period_end: new Date().toISOString(),
      },
      EMPTY_USAGE,
      true,
    );

    expect(sub.status).toBe('past_due');
  });

  it('returns trialing when trial end is in the future and no paid plan', () => {
    const sub = deriveSubscription(
      {
        free_trial_end: new Date(Date.now() + 86_400_000).toISOString(),
      },
      EMPTY_USAGE,
      false,
    );

    expect(sub.status).toBe('trialing');
    expect(sub.planId).toBeNull();
  });
});
