import { deriveSubscription } from './subscription.types';

const EMPTY_USAGE = { activeEvents: 0, members: 0, staff: 0 };

describe('deriveSubscription', () => {
  it('derives expired when subscription_status is active but period_end is past', () => {
    const sub = deriveSubscription(
      {
        subscription_plan: 'basico',
        subscription_status: 'active',
        subscription_period_end: new Date(Date.now() - 86_400_000).toISOString(),
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
        subscription_period_end: new Date(Date.now() + 86_400_000).toISOString(),
      },
      EMPTY_USAGE,
      true,
    );

    expect(sub.status).toBe('active');
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
