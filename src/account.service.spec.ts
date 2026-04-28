import { InternalServerErrorException } from '@nestjs/common';
import type { SupabaseAdminService } from './shared/supabase/supabase-admin.service';
import { AccountService } from './features/account/account.service';

describe('AccountService', () => {
  it('deletes account when supabase succeeds', async () => {
    const supabaseAdmin = {
      db: {
        auth: {
          admin: {
            deleteUser: jest.fn().mockResolvedValue({ error: null }),
          },
        },
      },
    } as unknown as SupabaseAdminService;
    const service = new AccountService(supabaseAdmin);

    await expect(service.deleteAccount('u1')).resolves.toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(supabaseAdmin.db.auth.admin.deleteUser).toHaveBeenCalledWith(
      'u1',
      true,
    );
  });

  it('throws when supabase returns error', async () => {
    const supabaseAdmin = {
      db: {
        auth: {
          admin: {
            deleteUser: jest
              .fn()
              .mockResolvedValue({ error: { message: 'boom' } }),
          },
        },
      },
    } as unknown as SupabaseAdminService;
    const service = new AccountService(supabaseAdmin);

    await expect(service.deleteAccount('u1')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
