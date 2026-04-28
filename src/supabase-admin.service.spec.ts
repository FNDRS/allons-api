import { UnauthorizedException } from '@nestjs/common';
import { SupabaseAdminService } from './shared/supabase/supabase-admin.service';

jest.mock('@supabase/supabase-js', () => {
  return {
    createClient: jest.fn(() => ({
      auth: {
        getUser: jest.fn(),
      },
    })),
  };
});

describe('SupabaseAdminService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('boots with missing env and throws on db access', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const service = new SupabaseAdminService();
    expect(() => service.db).toThrow(/not configured/i);
    await expect(service.getAuthenticatedUser('Bearer t')).rejects.toThrow(
      /not configured/i,
    );
  });

  it('rejects missing bearer token', async () => {
    process.env.SUPABASE_URL = 'http://localhost';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    const service = new SupabaseAdminService();

    await expect(
      service.getAuthenticatedUser(undefined),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      service.getAuthenticatedUser('Token abc'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects invalid token and returns user for valid token', async () => {
    process.env.SUPABASE_URL = 'http://localhost';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    const service = new SupabaseAdminService();

    (service as any).client.auth.getUser
      .mockResolvedValueOnce({
        data: { user: null },
        error: { message: 'bad' },
      })
      .mockResolvedValueOnce({ data: { user: { id: 'u1' } }, error: null });

    await expect(
      service.getAuthenticatedUser('Bearer bad'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.getAuthenticatedUser('Bearer ok')).resolves.toEqual({
      id: 'u1',
    });
  });
});
