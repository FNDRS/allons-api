import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';
import { FriendsService } from './friends.service';

function makePrisma() {
  return {
    $executeRaw: jest.fn(() => Promise.resolve(1)),
    $queryRaw: jest.fn(() => Promise.resolve([])),
    profile: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  } as any;
}

describe('FriendsService', () => {
  it('filters listFriends by query', async () => {
    const prisma = makePrisma() as unknown as PrismaService;
    prisma.profile.findUnique.mockResolvedValueOnce({
      userId: 'u1',
      location: 'MX',
    });
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        user_id: 'u2',
        full_name: 'Ana',
        username: null,
        avatar_url: null,
        avatar_color: null,
        location: 'MX',
      },
      {
        user_id: 'u3',
        full_name: 'Bob',
        username: 'b',
        avatar_url: null,
        avatar_color: null,
        location: 'US',
      },
    ]);

    const supabaseAdmin = { db: { auth: { admin: {} } } } as unknown as SupabaseAdminService;
    const service = new FriendsService(prisma, supabaseAdmin);

    const res = await service.listFriends('u1', 'ana');
    expect(res).toHaveLength(1);
    expect(res[0]?.userId).toBe('u2');
  });

  it('listSuggestions falls back to auth users when profiles are empty', async () => {
    const prisma = makePrisma() as unknown as PrismaService;
    prisma.profile.findUnique.mockResolvedValueOnce({
      userId: 'u1',
      location: null,
    });
    prisma.$queryRaw
      .mockResolvedValueOnce([]) // profile suggestions
      .mockResolvedValueOnce([{ friend_id: 'u9' }]); // blocked

    const supabaseAdmin = {
      db: {
        auth: {
          admin: {
            listUsers: jest.fn().mockResolvedValue({
              data: {
                users: [
                  { id: 'u9', email: 'blocked@x.com', user_metadata: {} },
                  {
                    id: 'u2',
                    email: 'ana@x.com',
                    user_metadata: { name: 'Ana', username: 'ana' },
                  },
                ],
              },
            }),
          },
        },
      },
    } as unknown as SupabaseAdminService;

    const service = new FriendsService(prisma, supabaseAdmin);
    const res = await service.listSuggestions('u1', 'ana');
    expect(res).toHaveLength(1);
    expect(res[0]?.userId).toBe('u2');
  });

  it('addFriend rejects self and missing user', async () => {
    const prisma = makePrisma() as unknown as PrismaService;
    const supabaseAdmin = {
      db: { auth: { admin: { getUserById: jest.fn() } } },
    } as unknown as SupabaseAdminService;
    const service = new FriendsService(prisma, supabaseAdmin);

    await expect(service.addFriend('u1', 'u1')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    prisma.profile.findUnique.mockResolvedValueOnce(null);
    supabaseAdmin.db.auth.admin.getUserById.mockResolvedValueOnce({
      data: { user: null },
    });
    await expect(service.addFriend('u1', 'u2')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
