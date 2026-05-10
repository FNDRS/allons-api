import { InternalServerErrorException } from '@nestjs/common';
import type { SupabaseAdminService } from './shared/supabase/supabase-admin.service';
import type { PrismaService } from './prisma/prisma.service';
import { AccountService } from './features/account/account.service';

describe('AccountService', () => {
  it('deletes account when supabase succeeds', async () => {
    const supabaseAdmin = {
      db: {
        auth: {
          admin: {
            updateUserById: jest.fn().mockResolvedValue({ error: null }),
          },
        },
      },
    } as unknown as SupabaseAdminService;
    const prisma = {
      $executeRaw: jest.fn(() => Promise.resolve(1)),
    } as unknown as PrismaService;
    const service = new AccountService(supabaseAdmin, prisma);

    await expect(service.deleteAccount('u1')).resolves.toEqual({
      success: true,
      disabled: true,
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(supabaseAdmin.db.auth.admin.updateUserById).toHaveBeenCalledWith(
      'u1',
      { ban_duration: '876000h' },
    );
  });

  it('throws when supabase returns error', async () => {
    const supabaseAdmin = {
      db: {
        auth: {
          admin: {
            updateUserById: jest
              .fn()
              .mockResolvedValue({ error: { message: 'boom' } }),
          },
        },
      },
    } as unknown as SupabaseAdminService;
    const prisma = {
      $executeRaw: jest.fn(() => Promise.resolve(1)),
    } as unknown as PrismaService;
    const service = new AccountService(supabaseAdmin, prisma);

    await expect(service.deleteAccount('u1')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
