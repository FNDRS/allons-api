import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';

export interface FriendDto {
  userId: string;
  fullName: string | null;
  username: string | null;
  avatarUrl: string | null;
  avatarColor: string | null;
  location: string | null;
  isProvider?: boolean;
}

@Injectable()
export class FriendsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseAdmin: SupabaseAdminService,
  ) {}

  async ensureTable() {
    await this.prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS friendships (
        user_id uuid NOT NULL,
        friend_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, friend_id),
        CONSTRAINT friendships_no_self CHECK (user_id <> friend_id)
      )
    `;
  }

  async ensureProviderFollowsTable() {
    await this.prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS provider_follows (
        user_id uuid NOT NULL,
        provider_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, provider_id)
      )
    `;
  }

  async listFriends(userId: string, query?: string): Promise<FriendDto[]> {
    await this.ensureTable();
    await this.ensureProviderFollowsTable();
    const me = await this.prisma.profile.findUnique({ where: { userId } });
    const myLocation = me?.location ?? null;

    const rows = await this.prisma.$queryRaw<
      Array<{
        user_id: string;
        full_name: string | null;
        username: string | null;
        avatar_url: string | null;
        avatar_color: string | null;
        location: string | null;
      }>
    >`
      SELECT p.user_id, p.full_name, p.username, p.avatar_url, p.avatar_color, p.location
      FROM friendships f
      JOIN profiles p ON p.user_id = f.friend_id
      WHERE f.user_id = ${userId}::uuid
      ORDER BY
        CASE WHEN ${myLocation}::text IS NOT NULL AND p.location = ${myLocation} THEN 0 ELSE 1 END,
        COALESCE(p.full_name, p.username, '') ASC
    `;

    const filtered = filterByQuery(rows, query);
    const people = filtered.map(toFriendDto);
    const providers = await this.listFollowedProviders(userId, query);
    return [...people, ...providers];
  }

  async listSuggestions(userId: string, query?: string): Promise<FriendDto[]> {
    await this.ensureTable();
    await this.ensureProviderFollowsTable();
    const me = await this.prisma.profile.findUnique({ where: { userId } });
    const myLocation = me?.location ?? null;

    const rows = await this.prisma.$queryRaw<
      Array<{
        user_id: string;
        full_name: string | null;
        username: string | null;
        avatar_url: string | null;
        avatar_color: string | null;
        location: string | null;
      }>
    >`
      SELECT p.user_id, p.full_name, p.username, p.avatar_url, p.avatar_color, p.location
      FROM profiles p
      WHERE p.user_id <> ${userId}::uuid
        AND p.user_id NOT IN (
          SELECT friend_id FROM friendships WHERE user_id = ${userId}::uuid
        )
      ORDER BY
        CASE WHEN ${myLocation}::text IS NOT NULL AND p.location = ${myLocation} THEN 0 ELSE 1 END,
        COALESCE(p.full_name, p.username, '') ASC
    `;

    const filtered = filterByCityThenGlobal(rows, myLocation, query);
    const fromProfiles = filtered.map(toFriendDto);
    const fromProviders = await this.listProviderSuggestions(userId, query);
    if (fromProfiles.length > 0 || fromProviders.length > 0) {
      return [...fromProfiles, ...fromProviders];
    }

    const friendRows = await this.prisma.$queryRaw<
      Array<{ friend_id: string }>
    >`
      SELECT friend_id
      FROM friendships
      WHERE user_id = ${userId}::uuid
    `;
    const blocked = new Set(friendRows.map((r) => r.friend_id));
    blocked.add(userId);

    const authUsers = await this.listAuthUsersFallback();
    const fallback = authUsers
      .filter((u) => u.id && !blocked.has(u.id))
      .map((u) => ({
        userId: u.id,
        fullName:
          (typeof u.user_metadata?.name === 'string'
            ? u.user_metadata.name
            : null) ??
          (typeof u.user_metadata?.full_name === 'string'
            ? u.user_metadata.full_name
            : null),
        username:
          (typeof u.user_metadata?.username === 'string'
            ? u.user_metadata.username
            : null) ?? (u.email ? u.email.split('@')[0] : null),
        avatarUrl:
          (typeof u.user_metadata?.avatar_url === 'string'
            ? u.user_metadata.avatar_url
            : null) ??
          (typeof u.user_metadata?.picture === 'string'
            ? u.user_metadata.picture
            : null),
        avatarColor: '#5a4a4a',
        location:
          typeof u.user_metadata?.location === 'string'
            ? u.user_metadata.location
            : null,
        isProvider: false,
      }));
    return filterFriendDtosByQuery(fallback, query);
  }

  async addFriend(userId: string, friendUserId: string) {
    if (userId === friendUserId) {
      throw new BadRequestException('No te puedes agregar a ti mismo.');
    }
    await this.ensureTable();
    await this.ensureProviderFollowsTable();
    let target = await this.prisma.profile.findUnique({
      where: { userId: friendUserId },
    });
    if (!target) {
      target = await this.ensureProfileFromAuth(friendUserId);
    }
    if (!target) {
      const provider = await this.prisma.provider.findUnique({
        where: { id: friendUserId },
      });
      if (!provider) {
        throw new NotFoundException('Usuario o negocio no encontrado.');
      }
      await this.prisma.$executeRaw`
        INSERT INTO provider_follows (user_id, provider_id)
        VALUES (${userId}::uuid, ${friendUserId}::uuid)
        ON CONFLICT DO NOTHING
      `;
      return { added: true, isProvider: true };
    }
    try {
      await this.prisma.$executeRaw`
        INSERT INTO friendships (user_id, friend_id)
        VALUES (${userId}::uuid, ${friendUserId}::uuid)
        ON CONFLICT DO NOTHING
      `;
      await this.prisma.$executeRaw`
        INSERT INTO friendships (user_id, friend_id)
        VALUES (${friendUserId}::uuid, ${userId}::uuid)
        ON CONFLICT DO NOTHING
      `;
    } catch {
      throw new ConflictException('No se pudo agregar el amigo.');
    }
    return { added: true };
  }

  async removeFriend(userId: string, friendUserId: string) {
    await this.ensureTable();
    await this.ensureProviderFollowsTable();
    await this.prisma.$executeRaw`
      DELETE FROM friendships
      WHERE (user_id = ${userId}::uuid AND friend_id = ${friendUserId}::uuid)
         OR (user_id = ${friendUserId}::uuid AND friend_id = ${userId}::uuid)
    `;
    await this.prisma.$executeRaw`
      DELETE FROM provider_follows
      WHERE user_id = ${userId}::uuid AND provider_id = ${friendUserId}::uuid
    `;
    return { removed: true };
  }

  async areFriends(userId: string, otherUserId: string) {
    await this.ensureTable();
    const rows = await this.prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM friendships
        WHERE user_id = ${userId}::uuid AND friend_id = ${otherUserId}::uuid
      ) AS exists
    `;
    return Boolean(rows[0]?.exists);
  }

  private async listAuthUsersFallback() {
    try {
      const first = await this.supabaseAdmin.db.auth.admin.listUsers({
        page: 1,
        perPage: 200,
      });
      return first.data?.users ?? [];
    } catch {
      return [];
    }
  }

  private async ensureProfileFromAuth(friendUserId: string) {
    try {
      const auth =
        await this.supabaseAdmin.db.auth.admin.getUserById(friendUserId);
      const user = auth.data?.user;
      if (!user) return null;
      return this.prisma.profile.upsert({
        where: { userId: friendUserId },
        create: {
          userId: friendUserId,
          fullName:
            (typeof user.user_metadata?.name === 'string'
              ? user.user_metadata.name
              : undefined) ??
            (typeof user.user_metadata?.full_name === 'string'
              ? user.user_metadata.full_name
              : undefined) ??
            null,
          username:
            (typeof user.user_metadata?.username === 'string'
              ? user.user_metadata.username
              : undefined) ?? (user.email ? user.email.split('@')[0] : null),
          avatarUrl:
            (typeof user.user_metadata?.avatar_url === 'string'
              ? user.user_metadata.avatar_url
              : undefined) ??
            (typeof user.user_metadata?.picture === 'string'
              ? user.user_metadata.picture
              : undefined) ??
            null,
          avatarColor: '#5a4a4a',
          location:
            typeof user.user_metadata?.location === 'string'
              ? user.user_metadata.location
              : null,
        },
        update: {},
      });
    } catch {
      return null;
    }
  }

  private async listFollowedProviders(
    userId: string,
    query?: string,
  ): Promise<FriendDto[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        user_id: string;
        full_name: string;
        username: string | null;
        avatar_url: string | null;
      }>
    >`
      SELECT
        p.id AS user_id,
        p.name AS full_name,
        p.handle AS username,
        p.logo_url AS avatar_url
      FROM provider_follows pf
      JOIN providers p ON p.id = pf.provider_id
      WHERE pf.user_id = ${userId}::uuid
      ORDER BY p.name ASC
    `;
    const providers = rows.map((row) => ({
      userId: row.user_id,
      fullName: row.full_name,
      username: row.username,
      avatarUrl: row.avatar_url,
      avatarColor: '#5a4a4a',
      location: null,
      isProvider: true,
    }));
    return filterFriendDtosByQuery(providers, query);
  }

  private async listProviderSuggestions(
    userId: string,
    query?: string,
  ): Promise<FriendDto[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        user_id: string;
        full_name: string;
        username: string | null;
        avatar_url: string | null;
      }>
    >`
      SELECT
        p.id AS user_id,
        p.name AS full_name,
        p.handle AS username,
        p.logo_url AS avatar_url
      FROM providers p
      WHERE p.id NOT IN (
        SELECT provider_id
        FROM provider_follows
        WHERE user_id = ${userId}::uuid
      )
      ORDER BY p.name ASC
    `;
    const providers = rows.map((row) => ({
      userId: row.user_id,
      fullName: row.full_name,
      username: row.username,
      avatarUrl: row.avatar_url,
      avatarColor: '#5a4a4a',
      location: null,
      isProvider: true,
    }));
    return filterFriendDtosByQuery(providers, query);
  }
}

function filterByQuery<
  T extends {
    full_name: string | null;
    username: string | null;
    location: string | null;
  },
>(rows: T[], query?: string) {
  const q = (query ?? '').trim().toLowerCase();
  if (q.length === 0) return rows;
  return rows.filter((r) => {
    const haystack = [r.full_name ?? '', r.username ?? '', r.location ?? '']
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });
}

function toFriendDto(row: {
  user_id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  avatar_color: string | null;
  location: string | null;
}): FriendDto {
  return {
    userId: row.user_id,
    fullName: row.full_name,
    username: row.username,
    avatarUrl: row.avatar_url,
    avatarColor: row.avatar_color,
    location: row.location,
    isProvider: false,
  };
}

function filterFriendDtosByQuery(rows: FriendDto[], query?: string) {
  const q = (query ?? '').trim().toLowerCase();
  if (q.length === 0) return rows;
  return rows.filter((r) =>
    [r.fullName ?? '', r.username ?? '', r.location ?? '']
      .join(' ')
      .toLowerCase()
      .includes(q),
  );
}

function filterByCityThenGlobal<
  T extends {
    location: string | null;
    full_name: string | null;
    username: string | null;
  },
>(rows: T[], myLocation: string | null, query?: string) {
  if (!myLocation) return filterByQuery(rows, query);

  const sameCity = rows.filter((r) => r.location === myLocation);
  const sameCityFiltered = filterByQuery(sameCity, query);
  if (sameCityFiltered.length > 0) return sameCityFiltered;

  return filterByQuery(rows, query);
}
