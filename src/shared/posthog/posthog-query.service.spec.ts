import { PostHogQueryService } from './posthog-query.service';

describe('PostHogQueryService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns null when PostHog query credentials are missing', async () => {
    delete process.env.POSTHOG_PERSONAL_API_KEY;
    delete process.env.POSTHOG_PROJECT_ID;
    const service = new PostHogQueryService();
    await expect(service.countExceptionsLast30Days()).resolves.toBeNull();
  });

  it('returns count from HogQL response', async () => {
    process.env.POSTHOG_PERSONAL_API_KEY = 'phx_test';
    process.env.POSTHOG_PROJECT_ID = '123';
    process.env.POSTHOG_HOST = 'https://us.i.posthog.com';

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [[42]] }),
    }) as typeof fetch;

    const service = new PostHogQueryService();
    await expect(service.countExceptionsLast30Days()).resolves.toBe(42);
  });
});
