import { InternalServerErrorException } from '@nestjs/common';
import { AccountService } from './features/account/account.service';

describe('AccountService', () => {
  it('deletes account when supabase succeeds', async () => {
    const supabaseAdmin: any = {
      db: {
        auth: {
          admin: {
            deleteUser: jest.fn().mockResolvedValue({ error: null }),
          },
        },
      },
    };
    const service = new AccountService(supabaseAdmin);

    await expect(service.deleteAccount('u1')).resolves.toBeUndefined();
    expect(supabaseAdmin.db.auth.admin.deleteUser).toHaveBeenCalledWith('u1', true);
  });

  it('throws when supabase returns error', async () => {
    const supabaseAdmin: any = {
      db: {
        auth: {
          admin: {
            deleteUser: jest
              .fn()
              .mockResolvedValue({ error: { message: 'boom' } }),
          },
        },
      },
    };
    const service = new AccountService(supabaseAdmin);

    await expect(service.deleteAccount('u1')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
