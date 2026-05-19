import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';
import { parseTicketQrPayload } from './ticket-qr.utils';

type ProviderRole = 'owner' | 'admin' | 'staff_scanner';

interface ProviderMembership {
  providerId: string;
  role: ProviderRole;
}

interface EventAggregateRow {
  event_id: string;
  sold_count: number;
  total_tickets: number;
  scanned_count: number;
  revenue: number;
}

@Injectable()
export class ProvidersService {
  private infraReady = false;
  private readonly logger = new Logger(ProvidersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseAdmin: SupabaseAdminService,
    private readonly config: ConfigService,
  ) {}

  private async ensureInfrastructure() {
    if (this.infraReady) return;

    await this.prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS provider_members (
        provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        user_id uuid NOT NULL,
        role text NOT NULL DEFAULT 'owner',
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (provider_id, user_id)
      )
    `;
    await this.prisma.$executeRaw`
      CREATE INDEX IF NOT EXISTS provider_members_user_idx
      ON provider_members(user_id)
    `;
    await this.prisma.$executeRaw`
      ALTER TABLE provider_members
      ADD COLUMN IF NOT EXISTS full_name text
    `;
    await this.prisma.$executeRaw`
      ALTER TABLE provider_members
      ADD COLUMN IF NOT EXISTS email text
    `;
    await this.prisma.$executeRaw`
      ALTER TABLE provider_members
      ADD COLUMN IF NOT EXISTS phone text
    `;
    await this.prisma.$executeRaw`
      ALTER TABLE provider_members
      ADD COLUMN IF NOT EXISTS avatar_color text
    `;

    await this.prisma.$executeRaw`
      ALTER TABLE events
      ADD COLUMN IF NOT EXISTS event_type text NOT NULL DEFAULT 'single'
    `;
    await this.prisma.$executeRaw`
      ALTER TABLE events
      ADD COLUMN IF NOT EXISTS recurrence text
    `;
    await this.prisma.$executeRaw`
      ALTER TABLE events
      ADD COLUMN IF NOT EXISTS recurrence_custom jsonb
    `;
    await this.prisma.$executeRaw`
      ALTER TABLE events
      ADD COLUMN IF NOT EXISTS ticket_mode text NOT NULL DEFAULT 'paid'
    `;
    await this.prisma.$executeRaw`
      ALTER TABLE events
      ADD COLUMN IF NOT EXISTS capacity integer NOT NULL DEFAULT 0
    `;
    await this.prisma.$executeRaw`
      ALTER TABLE events
      ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft'
    `;

    await this.prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS provider_event_ticket_types (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        name text NOT NULL,
        kind text NOT NULL DEFAULT 'general',
        price numeric(12,2) NOT NULL DEFAULT 0,
        total integer NOT NULL DEFAULT 0,
        sold_count integer NOT NULL DEFAULT 0,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await this.prisma.$executeRaw`
      CREATE INDEX IF NOT EXISTS provider_event_ticket_types_event_idx
      ON provider_event_ticket_types(event_id)
    `;

    await this.prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS provider_scan_records (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        ticket_id uuid,
        ticket_code text NOT NULL,
        attendee_name text,
        ticket_type text,
        scanned_by uuid NOT NULL,
        status text NOT NULL,
        scanned_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await this.prisma.$executeRaw`
      CREATE INDEX IF NOT EXISTS provider_scan_records_event_idx
      ON provider_scan_records(event_id, scanned_at DESC)
    `;
    await this.prisma.$executeRaw`
      CREATE UNIQUE INDEX IF NOT EXISTS provider_scan_records_ticket_valid_unique
      ON provider_scan_records(ticket_id)
      WHERE status = 'valid' AND ticket_id IS NOT NULL
    `;

    await this.prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS provider_activity_log (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        type text NOT NULL,
        message text NOT NULL,
        meta text,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await this.prisma.$executeRaw`
      CREATE INDEX IF NOT EXISTS provider_activity_log_provider_idx
      ON provider_activity_log(provider_id, created_at DESC)
    `;

    await this.prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS provider_payout_requests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        amount numeric(12,2) NOT NULL,
        method text NOT NULL,
        status text NOT NULL DEFAULT 'pending',
        created_by uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await this.prisma.$executeRaw`
      CREATE INDEX IF NOT EXISTS provider_payout_requests_provider_idx
      ON provider_payout_requests(provider_id, created_at DESC)
    `;
    await this.prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS provider_brand_settings (
        provider_id uuid PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
        logo_color text NOT NULL DEFAULT '#F67010',
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await this.prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS provider_discounts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        event_id uuid REFERENCES events(id) ON DELETE SET NULL,
        code text NOT NULL,
        percent integer NOT NULL,
        max_uses integer NOT NULL DEFAULT 0,
        uses integer NOT NULL DEFAULT 0,
        active boolean NOT NULL DEFAULT true,
        created_by uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await this.prisma.$executeRaw`
      CREATE UNIQUE INDEX IF NOT EXISTS provider_discounts_provider_code_unique
      ON provider_discounts(provider_id, code)
    `;
    await this.prisma.$executeRaw`
      CREATE INDEX IF NOT EXISTS provider_discounts_provider_idx
      ON provider_discounts(provider_id, created_at DESC)
    `;

    this.infraReady = true;
  }

  /**
   * Public lookup that mirrors `ensureDefaultMembership` without the
   * side effects (no auto-provisioning of legacy providers, no profile
   * mutation). Use when callers only need to know which provider the
   * user manages, not bootstrap one.
   */
  async getMembership(userId: string): Promise<ProviderMembership | null> {
    await this.ensureInfrastructure();
    const rows = await this.prisma.$queryRaw<ProviderMembership[]>`
      SELECT provider_id AS "providerId", role
      FROM provider_members
      WHERE user_id = ${userId}::uuid
        AND active = true
      ORDER BY
        CASE role
          WHEN 'owner' THEN 0
          WHEN 'admin' THEN 1
          ELSE 2
        END ASC,
        created_at ASC
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  private async ensureDefaultMembership(
    userId: string,
  ): Promise<ProviderMembership | null> {
    const byUser = await this.prisma.$queryRaw<ProviderMembership[]>`
      SELECT provider_id AS "providerId", role
      FROM provider_members
      WHERE user_id = ${userId}::uuid
        AND active = true
      ORDER BY
        CASE role
          WHEN 'owner' THEN 0
          WHEN 'admin' THEN 1
          ELSE 2
        END ASC,
        created_at ASC
      LIMIT 1
    `;
    if (byUser[0]) return byUser[0];

    const legacyProvider = await this.prisma.provider.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (legacyProvider) {
      await this.prisma.$executeRaw`
        INSERT INTO provider_members (provider_id, user_id, role, active)
        VALUES (${legacyProvider.id}::uuid, ${userId}::uuid, 'owner', true)
        ON CONFLICT (provider_id, user_id)
        DO UPDATE SET active = true, role = 'owner', updated_at = now()
      `;
      return { providerId: legacyProvider.id, role: 'owner' };
    }

    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      select: { fullName: true, username: true },
    });
    const providerName =
      profile?.fullName?.trim() || profile?.username?.trim() || 'Mi comercio';

    const provider = await this.prisma.provider.create({
      data: {
        name: providerName,
      },
      select: { id: true },
    });
    await this.prisma.$executeRaw`
      INSERT INTO provider_members (provider_id, user_id, role, active)
      VALUES (${provider.id}::uuid, ${userId}::uuid, 'owner', true)
      ON CONFLICT (provider_id, user_id)
      DO UPDATE SET active = true, role = 'owner', updated_at = now()
    `;
    await this.prisma.$executeRaw`
      INSERT INTO provider_brand_settings (provider_id, logo_color, updated_at)
      VALUES (${provider.id}::uuid, '#F67010', now())
      ON CONFLICT (provider_id) DO NOTHING
    `;
    await this.appendActivity(
      provider.id,
      'staff',
      'Provider inicial creado automÃ¡ticamente',
      userId,
    );
    return { providerId: provider.id, role: 'owner' };
  }

  async requireMembership(
    userId: string,
    allowedRoles: ProviderRole[] = ['owner', 'admin', 'staff_scanner'],
  ) {
    await this.ensureInfrastructure();
    const membership = await this.ensureDefaultMembership(userId);
    if (!membership) {
      throw new ForbiddenException('No tienes acceso provider');
    }
    if (!allowedRoles.includes(membership.role)) {
      throw new ForbiddenException('No tienes permisos suficientes');
    }
    return membership;
  }

  private async appendActivity(
    providerId: string,
    type: 'sale' | 'scan' | 'event' | 'staff' | 'payout',
    message: string,
    meta?: string | null,
  ) {
    await this.prisma.$executeRaw`
      INSERT INTO provider_activity_log (provider_id, type, message, meta)
      VALUES (${providerId}::uuid, ${type}, ${message}, ${meta ?? null})
    `;
  }

  private toEventStatus(value?: string | null) {
    return value === 'published' ||
      value === 'sold_out' ||
      value === 'ended' ||
      value === 'draft'
      ? value
      : 'draft';
  }

  private safeString(raw: unknown): string {
    if (typeof raw === 'string') return raw;
    if (typeof raw === 'number') return String(raw);
    if (typeof raw === 'boolean') return raw ? 'true' : 'false';
    if (typeof raw === 'bigint') return String(raw);
    return '';
  }

  /** Avatar URLs stored in auth metadata must be absolute https (no javascript:/data:). */
  private requireHttpsAvatarUrl(raw: string, field: string): string {
    const trimmed = raw.trim();
    if (!trimmed) {
      throw new BadRequestException(`${field} no puede estar vacÃ­o`);
    }
    try {
      const u = new URL(trimmed);
      if (u.protocol !== 'https:') {
        throw new BadRequestException(`${field} debe ser una URL https`);
      }
      return trimmed;
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException(`${field} debe ser una URL vÃ¡lida`);
    }
  }

  private normalizeGalleryUrls(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const unique = new Set<string>();
    for (const item of raw) {
      const candidate =
        typeof item === 'string'
          ? item
          : item && typeof item === 'object' && 'url' in item
            ? typeof (item as { url?: unknown }).url === 'string'
              ? ((item as { url?: string }).url ?? '')
              : ''
            : '';
      const url = candidate.trim();
      if (url) unique.add(url);
    }
    return Array.from(unique);
  }

  private async syncEventGallery(eventId: string, rawGallery: unknown) {
    if (rawGallery === undefined) return;
    const urls = this.normalizeGalleryUrls(rawGallery);
    await this.prisma.eventMedia.deleteMany({
      where: { eventId },
    });
    if (urls.length === 0) return;
    await this.prisma.eventMedia.createMany({
      data: urls.map((url, idx) => ({
        eventId,
        url,
        sortOrder: idx + 1,
      })),
    });
  }

  private mapRoleToMemberRole(raw: unknown): ProviderRole {
    const role = this.safeString(raw).toLowerCase();
    if (role === 'owner') return 'owner';
    if (role === 'admin' || role === 'finance') return 'admin';
    return 'staff_scanner';
  }

  private mapMemberRoleToClientRole(raw: unknown): 'scanner' | 'admin' {
    const role = this.safeString(raw).toLowerCase();
    return role === 'staff_scanner' ? 'scanner' : 'admin';
  }

  private async getEventAggregates(providerId: string) {
    const rows = await this.prisma.$queryRaw<EventAggregateRow[]>`
      SELECT
        e.id AS event_id,
        COALESCE(tt.sold_count, 0)::int AS sold_count,
        COALESCE(tt.total_tickets, 0)::int AS total_tickets,
        COALESCE(sc.scanned_count, 0)::int AS scanned_count,
        COALESCE(tt.revenue, 0)::float8 AS revenue
      FROM events e
      LEFT JOIN (
        SELECT
          event_id,
          SUM(total)::int AS total_tickets,
          SUM(sold_count)::int AS sold_count,
          SUM((sold_count * price))::float8 AS revenue
        FROM provider_event_ticket_types
        GROUP BY event_id
      ) tt ON tt.event_id = e.id
      LEFT JOIN (
        SELECT
          event_id,
          COUNT(*)::int AS scanned_count
        FROM provider_scan_records
        WHERE status = 'valid'
        GROUP BY event_id
      ) sc ON sc.event_id = e.id
      WHERE e.provider_id = ${providerId}::uuid
    `;
    return new Map(rows.map((row) => [row.event_id, row]));
  }

  async listProviderEvents(userId: string) {
    const member = await this.requireMembership(userId);
    const [events, aggregates] = await Promise.all([
      this.prisma.event.findMany({
        where: { providerId: member.providerId },
        orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
        include: {
          media: {
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
            select: { id: true, url: true, sortOrder: true },
          },
        },
      }),
      this.getEventAggregates(member.providerId),
    ]);
    return events.map((event) => {
      const agg = aggregates.get(event.id);
      const ticketsSold = agg?.sold_count ?? 0;
      const scans = agg?.scanned_count ?? 0;
      const declaredCapacity = Number((event as any).capacity ?? 0);
      const capacityFromTickets = Number(agg?.total_tickets ?? 0);
      return {
        ...event,
        status: this.toEventStatus((event as any).status),
        eventType: (event as any).eventType ?? 'single',
        recurrence: (event as any).recurrence ?? null,
        recurrenceCustom: (event as any).recurrenceCustom ?? null,
        ticketMode: (event as any).ticketMode ?? 'paid',
        capacity: declaredCapacity > 0 ? declaredCapacity : capacityFromTickets,
        ticketsSold,
        revenue: Number(agg?.revenue ?? 0),
        attendees: ticketsSold,
        scans,
        gallery: (event as any).media ?? [],
      };
    });
  }

  async getProviderProfile(userId: string) {
    const member = await this.requireMembership(userId);
    const provider = await this.prisma.provider.findUnique({
      where: { id: member.providerId },
      select: {
        id: true,
        name: true,
        handle: true,
        description: true,
        websiteUrl: true,
        logoUrl: true,
      },
    });
    if (!provider) throw new NotFoundException('Provider no encontrado');
    const settings = await this.prisma.$queryRaw<
      Array<{ logo_color: string | null }>
    >`
      SELECT logo_color
      FROM provider_brand_settings
      WHERE provider_id = ${member.providerId}::uuid
      LIMIT 1
    `;
    return {
      ...provider,
      brandLogoColor: settings[0]?.logo_color ?? '#F67010',
    };
  }

  async updateProviderProfile(userId: string, body: Record<string, unknown>) {
    const member = await this.requireMembership(userId, ['owner', 'admin']);
    if (body.name !== undefined && !this.safeString(body.name).trim()) {
      throw new BadRequestException('name es requerido');
    }
    await this.prisma.provider.update({
      where: { id: member.providerId },
      data: {
        name:
          body.name !== undefined
            ? this.safeString(body.name).trim()
            : undefined,
        handle:
          body.handle === null
            ? null
            : body.handle
              ? this.safeString(body.handle).trim().replace(/^@+/, '')
              : undefined,
        description:
          body.description === null
            ? null
            : body.description
              ? this.safeString(body.description)
              : undefined,
        websiteUrl:
          body.websiteUrl === null
            ? null
            : body.websiteUrl
              ? this.safeString(body.websiteUrl)
              : undefined,
        logoUrl:
          body.logoUrl === null
            ? null
            : body.logoUrl
              ? this.safeString(body.logoUrl)
              : undefined,
      },
    });
    if (body.brandLogoColor !== undefined) {
      const brandLogoColor =
        this.safeString(body.brandLogoColor).trim() || '#F67010';
      await this.prisma.$executeRaw`
        INSERT INTO provider_brand_settings (provider_id, logo_color, updated_at)
        VALUES (${member.providerId}::uuid, ${brandLogoColor}, now())
        ON CONFLICT (provider_id)
        DO UPDATE SET logo_color = EXCLUDED.logo_color, updated_at = now()
      `;
    }
    await this.appendActivity(
      member.providerId,
      'staff',
      'Perfil de marca actualizado',
      null,
    );
    return this.getProviderProfile(userId);
  }

  async listProviderStaff(userId: string) {
    const member = await this.requireMembership(userId);
    const rows = await this.prisma.$queryRaw<
      Array<{
        user_id: string;
        full_name: string | null;
        email: string | null;
        phone: string | null;
        role: string;
        avatar_color: string | null;
        active: boolean;
        created_at: Date;
        updated_at: Date;
        profile_name: string | null;
        profile_avatar_color: string | null;
      }>
    >`
      SELECT
        pm.user_id,
        pm.full_name,
        pm.email,
        pm.phone,
        pm.role,
        pm.avatar_color,
        pm.active,
        pm.created_at,
        pm.updated_at,
        p.full_name AS profile_name,
        p.avatar_color AS profile_avatar_color
      FROM provider_members pm
      LEFT JOIN profiles p ON p.user_id = pm.user_id
      WHERE pm.provider_id = ${member.providerId}::uuid
      ORDER BY
        CASE pm.role
          WHEN 'owner' THEN 0
          WHEN 'admin' THEN 1
          ELSE 2
        END ASC,
        pm.created_at ASC
    `;
    return rows.map((row) => ({
      userId: row.user_id,
      name: row.full_name ?? row.profile_name ?? 'Miembro',
      email: row.email,
      phone: row.phone,
      role: this.mapMemberRoleToClientRole(row.role),
      avatarColor: row.avatar_color ?? row.profile_avatar_color ?? '#F67010',
      active: row.active,
      invitedAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async upsertProviderStaff(userId: string, body: Record<string, unknown>) {
    const member = await this.requireMembership(userId, ['owner', 'admin']);
    const targetUserId = this.safeString(body.userId).trim();
    if (!targetUserId) {
      throw new BadRequestException('userId es requerido');
    }
    const role = this.mapRoleToMemberRole(body.role);
    await this.prisma.$executeRaw`
      INSERT INTO provider_members (
        provider_id, user_id, role, active, full_name, email, phone, avatar_color, updated_at
      )
      VALUES (
        ${member.providerId}::uuid,
        ${targetUserId}::uuid,
        ${role},
        true,
        ${body.name ? this.safeString(body.name) : null},
        ${body.email ? this.safeString(body.email).toLowerCase() : null},
        ${body.phone ? this.safeString(body.phone) : null},
        ${body.avatarColor ? this.safeString(body.avatarColor) : null},
        now()
      )
      ON CONFLICT (provider_id, user_id)
      DO UPDATE SET
        role = EXCLUDED.role,
        active = true,
        full_name = COALESCE(EXCLUDED.full_name, provider_members.full_name),
        email = COALESCE(EXCLUDED.email, provider_members.email),
        phone = COALESCE(EXCLUDED.phone, provider_members.phone),
        avatar_color = COALESCE(EXCLUDED.avatar_color, provider_members.avatar_color),
        updated_at = now()
    `;
    await this.appendActivity(
      member.providerId,
      'staff',
      `Miembro actualizado: ${body.name ? this.safeString(body.name) : targetUserId}`,
      targetUserId,
    );
    return this.listProviderStaff(userId);
  }

  async inviteProviderStaff(userId: string, body: Record<string, unknown>) {
    await this.requireMembership(userId, ['owner', 'admin']);
    const email = this.safeString(body.email).trim().toLowerCase();
    const name = this.safeString(body.name).trim();
    const role = (this.safeString(body.role) || 'scanner').toLowerCase();
    const phone = body.phone ? this.safeString(body.phone) : null;
    const avatarColor = body.avatarColor
      ? this.safeString(body.avatarColor)
      : null;
    const brandName = body.brandName ? this.safeString(body.brandName) : null;
    const brandHandle = body.brandHandle
      ? this.safeString(body.brandHandle)
      : null;
    const redirectTo = body.redirectTo
      ? this.safeString(body.redirectTo)
      : undefined;
    const avatarUrlRaw = this.safeString(body.avatarUrl ?? '').trim();
    const avatarUrl = avatarUrlRaw
      ? this.requireHttpsAvatarUrl(avatarUrlRaw, 'avatarUrl')
      : null;

    if (!email || !name) {
      throw new BadRequestException('email y name son requeridos');
    }
    if (!['scanner', 'admin', 'finance'].includes(role)) {
      throw new BadRequestException('role invÃ¡lido');
    }

    const metadata = {
      role: 'staff',
      full_name: name,
      phone,
      staff_role: role,
      avatar_color: avatarColor,
      brand_name: brandName,
      brand_handle: brandHandle,
      invited_by: userId,
      invited_at: new Date().toISOString(),
      ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
    };
    const temporaryPassword = this.generateTemporaryPassword();

    let status: 'invited' | 'updated' = 'invited';
    let invitedUserId: string | null = null;
    let invitedEmail = email;

    const lookup = await this.supabaseAdmin.db.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    if (lookup.error) {
      throw new BadRequestException(lookup.error.message);
    }
    const match = lookup.data.users.find(
      (row) => row.email?.toLowerCase() === email,
    );

    if (match) {
      status = 'updated';
      const updated = await this.supabaseAdmin.db.auth.admin.updateUserById(
        match.id,
        {
          password: temporaryPassword,
          user_metadata: {
            ...(match.user_metadata ?? {}),
            ...metadata,
            login_email: email,
            temporary_password: temporaryPassword,
          },
        },
      );
      if (updated.error) {
        throw new BadRequestException(updated.error.message);
      }
      invitedUserId = updated.data.user?.id ?? match.id;
      invitedEmail = updated.data.user?.email ?? match.email ?? email;
    } else {
      const invited = await this.supabaseAdmin.db.auth.admin.inviteUserByEmail(
        email,
        {
          data: {
            ...metadata,
            login_email: email,
            temporary_password: temporaryPassword,
          },
          redirectTo,
        },
      );
      if (invited.error) {
        throw new BadRequestException(invited.error.message);
      }
      invitedUserId = invited.data.user?.id ?? null;
      invitedEmail = invited.data.user?.email ?? email;
      if (invitedUserId) {
        const setPassword =
          await this.supabaseAdmin.db.auth.admin.updateUserById(invitedUserId, {
            password: temporaryPassword,
          });
        if (setPassword.error) {
          throw new BadRequestException(setPassword.error.message);
        }
      }
    }

    if (!invitedUserId) {
      throw new BadRequestException(
        'No fue posible resolver el usuario invitado',
      );
    }

    await this.upsertProviderStaff(userId, {
      userId: invitedUserId,
      name,
      email: invitedEmail,
      phone,
      role: role === 'admin' ? 'admin' : 'scanner',
      avatarColor,
    });

    return {
      status,
      userId: invitedUserId,
      email: invitedEmail,
      temporaryPassword,
    };
  }

  private generateTemporaryPassword() {
    const random = Math.random().toString(36).slice(2, 10);
    return `Allons#${random}9`;
  }

  async updateProviderStaff(
    userId: string,
    targetUserId: string,
    body: Record<string, unknown>,
  ) {
    const member = await this.requireMembership(userId, ['owner', 'admin']);
    const role =
      body.role !== undefined ? this.mapRoleToMemberRole(body.role) : null;
    const existing = await this.prisma.$queryRaw<Array<{ user_id: string }>>`
      SELECT user_id
      FROM provider_members
      WHERE provider_id = ${member.providerId}::uuid
        AND user_id = ${targetUserId}::uuid
      LIMIT 1
    `;
    if (!existing[0]) throw new NotFoundException('Miembro no encontrado');
    await this.prisma.$executeRaw`
      UPDATE provider_members
      SET
        role = COALESCE(${role}, role),
        active = CASE
          WHEN ${body.active !== undefined} THEN ${Boolean(body.active)}
          ELSE active
        END,
        full_name = CASE
          WHEN ${body.name !== undefined} THEN ${body.name ? this.safeString(body.name) : null}
          ELSE full_name
        END,
        email = CASE
          WHEN ${body.email !== undefined} THEN ${body.email ? this.safeString(body.email).toLowerCase() : null}
          ELSE email
        END,
        phone = CASE
          WHEN ${body.phone !== undefined} THEN ${body.phone ? this.safeString(body.phone) : null}
          ELSE phone
        END,
        avatar_color = CASE
          WHEN ${body.avatarColor !== undefined} THEN ${body.avatarColor ? this.safeString(body.avatarColor) : null}
          ELSE avatar_color
        END,
        updated_at = now()
      WHERE provider_id = ${member.providerId}::uuid
        AND user_id = ${targetUserId}::uuid
    `;
    await this.appendActivity(
      member.providerId,
      'staff',
      `Miembro modificado: ${targetUserId}`,
      targetUserId,
    );
    return { updated: true };
  }

  async removeProviderStaff(userId: string, targetUserId: string) {
    const member = await this.requireMembership(userId, ['owner', 'admin']);
    const existing = await this.prisma.$queryRaw<
      Array<{ user_id: string; role: string }>
    >`
      SELECT user_id, role
      FROM provider_members
      WHERE provider_id = ${member.providerId}::uuid
        AND user_id = ${targetUserId}::uuid
      LIMIT 1
    `;
    if (!existing[0]) throw new NotFoundException('Miembro no encontrado');
    if (existing[0].role === 'owner') {
      throw new BadRequestException('No puedes eliminar al owner del comercio');
    }
    if (targetUserId === userId) {
      throw new BadRequestException('No puedes eliminar tu propio usuario');
    }
    await this.prisma.$executeRaw`
      DELETE FROM provider_members
      WHERE provider_id = ${member.providerId}::uuid
        AND user_id = ${targetUserId}::uuid
    `;
    await this.appendActivity(
      member.providerId,
      'staff',
      `Miembro eliminado: ${targetUserId}`,
      targetUserId,
    );
    return { deleted: true };
  }

  async listProviderDiscounts(userId: string) {
    const member = await this.requireMembership(userId);
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        code: string;
        percent: number;
        uses: number;
        max_uses: number;
        active: boolean;
        event_id: string | null;
        event_title: string | null;
        created_at: Date;
      }>
    >`
      SELECT
        d.id,
        d.code,
        d.percent,
        d.uses,
        d.max_uses,
        d.active,
        d.event_id,
        e.title AS event_title,
        d.created_at
      FROM provider_discounts d
      LEFT JOIN events e ON e.id = d.event_id
      WHERE d.provider_id = ${member.providerId}::uuid
      ORDER BY d.created_at DESC
    `;
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      percent: row.percent,
      uses: row.uses,
      maxUses: row.max_uses,
      active: row.active,
      eventId: row.event_id,
      eventTitle: row.event_title,
      createdAt: row.created_at,
    }));
  }

  async createProviderDiscount(userId: string, body: Record<string, unknown>) {
    const member = await this.requireMembership(userId, ['owner', 'admin']);
    const code = this.safeString(body.code).trim().toUpperCase();
    if (!code || code.length < 3) {
      throw new BadRequestException('code invÃ¡lido');
    }
    const percent = Number(body.percent ?? 0);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      throw new BadRequestException('percent invÃ¡lido');
    }
    const maxUses = Math.max(1, Number(body.maxUses ?? 1));
    const eventId = body.eventId ? this.safeString(body.eventId) : null;
    await this.prisma.$executeRaw`
      INSERT INTO provider_discounts (
        provider_id, event_id, code, percent, max_uses, uses, active, created_by, updated_at
      )
      VALUES (
        ${member.providerId}::uuid,
        ${eventId ? `${eventId}` : null}::uuid,
        ${code},
        ${Math.round(percent)},
        ${Math.round(maxUses)},
        0,
        true,
        ${userId}::uuid,
        now()
      )
    `;
    await this.appendActivity(
      member.providerId,
      'event',
      `Descuento creado: ${code}`,
      eventId,
    );
    return this.listProviderDiscounts(userId);
  }

  async updateProviderDiscount(
    userId: string,
    discountId: string,
    body: Record<string, unknown>,
  ) {
    const member = await this.requireMembership(userId, ['owner', 'admin']);
    const eventId =
      body.eventId === null
        ? null
        : body.eventId
          ? this.safeString(body.eventId)
          : undefined;
    await this.prisma.$executeRaw`
      UPDATE provider_discounts
      SET
        code = CASE WHEN ${body.code !== undefined} THEN ${this.safeString(body.code).toUpperCase()} ELSE code END,
        percent = CASE WHEN ${body.percent !== undefined} THEN ${Math.round(Number(body.percent ?? 0))} ELSE percent END,
        max_uses = CASE WHEN ${body.maxUses !== undefined} THEN ${Math.round(Number(body.maxUses ?? 0))} ELSE max_uses END,
        active = CASE WHEN ${body.active !== undefined} THEN ${Boolean(body.active)} ELSE active END,
        event_id = CASE WHEN ${body.eventId !== undefined} THEN ${eventId ? `${eventId}` : null}::uuid ELSE event_id END,
        updated_at = now()
      WHERE id = ${discountId}::uuid
        AND provider_id = ${member.providerId}::uuid
    `;
    return { updated: true };
  }

  async deleteProviderDiscount(userId: string, discountId: string) {
    const member = await this.requireMembership(userId, ['owner', 'admin']);
    await this.prisma.$executeRaw`
      DELETE FROM provider_discounts
      WHERE id = ${discountId}::uuid
        AND provider_id = ${member.providerId}::uuid
    `;
    return { deleted: true };
  }

  async getProviderEvent(userId: string, eventId: string) {
    const member = await this.requireMembership(userId);
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, providerId: member.providerId },
      include: {
        media: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          select: { id: true, url: true, sortOrder: true },
        },
      },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');

    const ticketTypes = await this.listTicketTypesForEvent(userId, eventId);
    const sold = ticketTypes.reduce((sum, row) => sum + row.sold, 0);
    const scans = await this.prisma.$queryRaw<Array<{ total: number }>>`
      SELECT COUNT(*)::int AS total
      FROM provider_scan_records
      WHERE event_id = ${eventId}::uuid
        AND status = 'valid'
    `;
    return {
      ...event,
      status: this.toEventStatus((event as any).status),
      eventType: (event as any).eventType ?? 'single',
      recurrence: (event as any).recurrence ?? null,
      recurrenceCustom: (event as any).recurrenceCustom ?? null,
      ticketMode: (event as any).ticketMode ?? 'paid',
      capacity: Number((event as any).capacity ?? 0),
      ticketsSold: sold,
      revenue: ticketTypes.reduce((sum, row) => sum + row.sold * row.price, 0),
      attendees: sold,
      scans: scans[0]?.total ?? 0,
      ticketTypes,
      gallery: (event as any).media ?? [],
    };
  }

  async createProviderEvent(userId: string, body: Record<string, unknown>) {
    const title = this.safeString(body.title).trim();
    this.logger.log(
      `createProviderEvent:start userId=${userId} title="${title}" eventType=${String(
        this.safeString(body.eventType) || 'single',
      )} status=${this.safeString(body.status) || 'draft'}`,
    );
    try {
      const member = await this.requireMembership(userId, ['owner', 'admin']);
      if (!title) throw new BadRequestException('title es requerido');
      const creatorProfile = await this.prisma.profile.findUnique({
        where: { userId },
        select: { userId: true },
      });
      this.logger.debug(
        `createProviderEvent:membership providerId=${member.providerId} creatorProfile=${creatorProfile?.userId ? 'found' : 'missing'}`,
      );

      const created = await this.prisma.event.create({
        data: {
          providerId: member.providerId,
          // `events.created_by` has an FK to `profiles.user_id`; avoid P2003 when
          // account exists in auth but profile row has not been created yet.
          createdBy: creatorProfile?.userId ?? null,
          title,
          description: body.description
            ? this.safeString(body.description)
            : null,
          startsAt: (() => {
            const raw = this.safeString(body.startsAt).trim();
            return raw ? new Date(raw) : null;
          })(),
          endsAt: (() => {
            const raw = this.safeString(body.endsAt).trim();
            return raw ? new Date(raw) : null;
          })(),
          city: body.city ? this.safeString(body.city) : null,
          venue: body.venue ? this.safeString(body.venue) : null,
          address: body.address ? this.safeString(body.address) : null,
          coverImageUrl: body.coverImageUrl
            ? this.safeString(body.coverImageUrl)
            : null,
          themeColor: body.themeColor ? this.safeString(body.themeColor) : null,
          smokingAllowed: Boolean(body.smokingAllowed),
          petFriendly: Boolean(body.petFriendly),
          parkingAvailable: Boolean(body.parkingAvailable),
          minAge: body.minAge ? Number(body.minAge) : null,
        },
      });
      this.logger.log(`createProviderEvent:created eventId=${created.id}`);

      await this.prisma.$executeRaw`
        UPDATE events
        SET
          event_type = ${this.safeString(body.eventType) || 'single'},
          recurrence = ${body.recurrence ? this.safeString(body.recurrence) : null},
          recurrence_custom = ${
            body.recurrenceCustom ? JSON.stringify(body.recurrenceCustom) : null
          }::jsonb,
          ticket_mode = ${this.safeString(body.ticketMode) || 'paid'},
          capacity = ${Number(body.capacity ?? 0)},
          status = ${this.safeString(body.status) || 'draft'}
        WHERE id = ${created.id}::uuid
      `;
      this.logger.debug(
        `createProviderEvent:metadata-updated eventId=${created.id}`,
      );

      await this.syncEventGallery(created.id, body.gallery);
      this.logger.debug(
        `createProviderEvent:gallery-synced eventId=${created.id} galleryCount=${Array.isArray(body.gallery) ? body.gallery.length : 0}`,
      );

      await this.appendActivity(
        member.providerId,
        'event',
        `Evento creado: ${created.title}`,
        created.id,
      );
      return this.getProviderEvent(userId, created.id);
    } catch (error: any) {
      this.logger.error(
        `createProviderEvent:failed userId=${userId} title="${title}" message=${error?.message ?? 'unknown'}`,
        error?.stack,
      );
      throw error;
    }
  }

  async updateProviderEvent(
    userId: string,
    eventId: string,
    body: Record<string, unknown>,
  ) {
    const member = await this.requireMembership(userId, ['owner', 'admin']);
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, providerId: member.providerId },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');

    await this.prisma.event.update({
      where: { id: eventId },
      data: {
        title: body.title ? this.safeString(body.title) : undefined,
        description:
          body.description === null
            ? null
            : body.description
              ? this.safeString(body.description)
              : undefined,
        startsAt: (() => {
          const raw = this.safeString(body.startsAt).trim();
          return raw ? new Date(raw) : undefined;
        })(),
        endsAt: (() => {
          const raw = this.safeString(body.endsAt).trim();
          return raw ? new Date(raw) : undefined;
        })(),
        city:
          body.city === null
            ? null
            : body.city
              ? this.safeString(body.city)
              : undefined,
        venue:
          body.venue === null
            ? null
            : body.venue
              ? this.safeString(body.venue)
              : undefined,
        address:
          body.address === null
            ? null
            : body.address
              ? this.safeString(body.address)
              : undefined,
        coverImageUrl:
          body.coverImageUrl === null
            ? null
            : body.coverImageUrl
              ? this.safeString(body.coverImageUrl)
              : undefined,
        themeColor:
          body.themeColor === null
            ? null
            : body.themeColor
              ? this.safeString(body.themeColor)
              : undefined,
        smokingAllowed:
          typeof body.smokingAllowed === 'boolean'
            ? body.smokingAllowed
            : undefined,
        petFriendly:
          typeof body.petFriendly === 'boolean' ? body.petFriendly : undefined,
        parkingAvailable:
          typeof body.parkingAvailable === 'boolean'
            ? body.parkingAvailable
            : undefined,
        minAge:
          body.minAge === null
            ? null
            : typeof body.minAge === 'number'
              ? Number(body.minAge)
              : undefined,
      },
    });

    await this.prisma.$executeRaw`
      UPDATE events
      SET
        event_type = COALESCE(${body.eventType ? this.safeString(body.eventType) : null}, event_type),
        recurrence = CASE WHEN ${body.recurrence !== undefined} THEN ${body.recurrence ? this.safeString(body.recurrence) : null} ELSE recurrence END,
        recurrence_custom = CASE
          WHEN ${body.recurrenceCustom !== undefined}
          THEN ${body.recurrenceCustom ? JSON.stringify(body.recurrenceCustom) : null}::jsonb
          ELSE recurrence_custom
        END,
        ticket_mode = COALESCE(${body.ticketMode ? this.safeString(body.ticketMode) : null}, ticket_mode),
        capacity = CASE
          WHEN ${body.capacity !== undefined}
          THEN ${Number(body.capacity ?? 0)}
          ELSE capacity
        END,
        status = COALESCE(${body.status ? this.safeString(body.status) : null}, status),
        updated_at = now()
      WHERE id = ${eventId}::uuid
    `;
    await this.syncEventGallery(eventId, body.gallery);

    await this.appendActivity(
      member.providerId,
      'event',
      `Evento actualizado: ${event.title}`,
      eventId,
    );
    return this.getProviderEvent(userId, eventId);
  }

  async deleteProviderEvent(userId: string, eventId: string) {
    const member = await this.requireMembership(userId, ['owner', 'admin']);
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, providerId: member.providerId },
      select: { id: true, title: true },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');
    await this.prisma.$transaction(async (tx) => {
      // Keep discounts but detach them from deleted event.
      await tx.$executeRaw`
        UPDATE provider_discounts
        SET event_id = NULL, updated_at = now()
        WHERE provider_id = ${member.providerId}::uuid
          AND event_id = ${event.id}::uuid
      `;
      // Defensive cleanup: older deployments may not have cascade constraints.
      await tx.$executeRaw`
        DELETE FROM provider_scan_records
        WHERE provider_id = ${member.providerId}::uuid
          AND event_id = ${event.id}::uuid
      `;
      await tx.$executeRaw`
        DELETE FROM provider_event_ticket_types
        WHERE provider_id = ${member.providerId}::uuid
          AND event_id = ${event.id}::uuid
      `;
      await tx.eventMedia.deleteMany({ where: { eventId: event.id } });
      await tx.eventInterest.deleteMany({ where: { eventId: event.id } });
      await tx.eventAttendee.deleteMany({ where: { eventId: event.id } });
      await tx.event.delete({ where: { id: event.id } });
    });
    await this.appendActivity(
      member.providerId,
      'event',
      `Evento eliminado: ${event.title}`,
      event.id,
    );
    return { deleted: true };
  }

  async listTicketTypesForEvent(userId: string, eventId: string) {
    const member = await this.requireMembership(userId);
    const allowed = await this.prisma.event.findFirst({
      where: { id: eventId, providerId: member.providerId },
      select: { id: true },
    });
    if (!allowed) throw new NotFoundException('Evento no encontrado');
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        event_id: string;
        name: string;
        kind: string;
        price: number;
        total: number;
        sold_count: number;
      }>
    >`
      SELECT id, event_id, name, kind, price::float8 AS price, total, sold_count
      FROM provider_event_ticket_types
      WHERE provider_id = ${member.providerId}::uuid
        AND event_id = ${eventId}::uuid
        AND active = true
      ORDER BY created_at ASC
    `;
    return rows.map((row) => ({
      id: row.id,
      eventId: row.event_id,
      name: row.name,
      kind: row.kind,
      price: Number(row.price),
      total: row.total,
      sold: row.sold_count,
    }));
  }

  async createTicketType(
    userId: string,
    eventId: string,
    body: Record<string, unknown>,
  ) {
    const member = await this.requireMembership(userId, ['owner', 'admin']);
    const name = this.safeString(body.name).trim();
    if (!name) throw new BadRequestException('name es requerido');
    await this.prisma.$executeRaw`
      INSERT INTO provider_event_ticket_types (
        provider_id, event_id, name, kind, price, total, sold_count, active
      )
      VALUES (
        ${member.providerId}::uuid,
        ${eventId}::uuid,
        ${name},
        ${this.safeString(body.kind) || 'general'},
        ${Number(body.price ?? 0)},
        ${Number(body.total ?? 0)},
        0,
        true
      )
    `;
    await this.appendActivity(
      member.providerId,
      'event',
      `Nuevo tipo de ticket: ${name}`,
      eventId,
    );
    return this.listTicketTypesForEvent(userId, eventId);
  }

  async updateTicketType(
    userId: string,
    ticketTypeId: string,
    body: Record<string, unknown>,
  ) {
    const member = await this.requireMembership(userId, ['owner', 'admin']);
    await this.prisma.$executeRaw`
      UPDATE provider_event_ticket_types
      SET
        name = COALESCE(${body.name ? this.safeString(body.name) : null}, name),
        kind = COALESCE(${body.kind ? this.safeString(body.kind) : null}, kind),
        price = CASE WHEN ${body.price !== undefined} THEN ${Number(body.price ?? 0)} ELSE price END,
        total = CASE WHEN ${body.total !== undefined} THEN ${Number(body.total ?? 0)} ELSE total END,
        active = CASE WHEN ${body.active !== undefined} THEN ${Boolean(body.active)} ELSE active END,
        updated_at = now()
      WHERE id = ${ticketTypeId}::uuid
        AND provider_id = ${member.providerId}::uuid
    `;
    return { updated: true };
  }

  async deleteTicketType(userId: string, ticketTypeId: string) {
    const member = await this.requireMembership(userId, ['owner', 'admin']);
    await this.prisma.$executeRaw`
      UPDATE provider_event_ticket_types
      SET active = false, updated_at = now()
      WHERE id = ${ticketTypeId}::uuid
        AND provider_id = ${member.providerId}::uuid
    `;
    return { deleted: true };
  }

  async validateScan(userId: string, body: Record<string, unknown>) {
    const member = await this.requireMembership(userId, [
      'owner',
      'admin',
      'staff_scanner',
    ]);
    const eventId = this.safeString(body.eventId).trim();
    const rawCode = this.safeString(body.ticketCode).trim();
    if (!eventId || !rawCode) {
      throw new BadRequestException('eventId y ticketCode son requeridos');
    }
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, providerId: member.providerId },
      select: { id: true, title: true },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');

    const qrSecret = this.config.get<string>('TICKET_QR_SECRET') ?? null;
    const parsed = parseTicketQrPayload(rawCode, qrSecret);
    const ticketId = parsed?.ticketId ?? null;
    // QRs carry an `eventId` that must match the scanned event. If the
    // QR is signed but the event mismatches, refuse early (otherwise a
    // staff member at event B could redeem event A's ticket).
    const eventMismatch =
      parsed?.eventId !== null &&
      parsed?.eventId !== undefined &&
      parsed.eventId !== eventId;

    // The stored `ticket_code` should be the canonical id, not the raw
    // QR JSON. Falls back to the raw input only if we couldn't parse a
    // ticket id (e.g. manual entry of a non-UUID code).
    const persistedCode = ticketId ?? rawCode;

    let status: 'valid' | 'duplicate' | 'invalid' | 'cancelled' = 'invalid';
    let attendeeName = 'Invitado';
    const ticketType = 'General';

    if (ticketId && !eventMismatch) {
      // Atomic block: lock the ticket row, recheck duplicates, insert
      // the scan record âÿÿ all in one transaction. Two scans of the
      // same ticket racing in different staff sessions now serialize:
      // the second one sees the first scan's row and lands as
      // `duplicate`.
      const txResult = await this.prisma.$transaction(async (tx) => {
        const ticketRows = await tx.$queryRaw<
          Array<{ id: string; cancelled_at: Date | null }>
        >`
          SELECT id, cancelled_at FROM tickets
          WHERE id = ${ticketId}::uuid AND event_id = ${eventId}::uuid
          FOR UPDATE
        `;
        if (ticketRows.length === 0) {
          return { status: 'invalid' as const, attendeeName };
        }

        const holderRows = await tx.$queryRaw<
          Array<{ holder_name: string | null }>
        >`
          SELECT holder_name FROM ticket_holders
          WHERE ticket_id = ${ticketId}::uuid
          LIMIT 1
        `;
        const resolvedName = holderRows[0]?.holder_name ?? 'Invitado';

        // Soft-deleted tickets are still queryable on purpose: scanning
        // one should report "cancelado", not "invalid" âÿÿ otherwise the
        // doorperson can't tell a fraudulent code apart from a real
        // ticket the buyer cancelled this morning.
        if (ticketRows[0].cancelled_at) {
          await tx.$executeRaw`
            INSERT INTO provider_scan_records (
              provider_id,
              event_id,
              ticket_id,
              ticket_code,
              attendee_name,
              ticket_type,
              scanned_by,
              status
            )
            VALUES (
              ${member.providerId}::uuid,
              ${eventId}::uuid,
              ${ticketId}::uuid,
              ${persistedCode},
              ${resolvedName},
              ${ticketType},
              ${userId}::uuid,
              'cancelled'
            )
          `;
          return { status: 'cancelled' as const, attendeeName: resolvedName };
        }

        const duplicateRows = await tx.$queryRaw<Array<{ total: number }>>`
          SELECT COUNT(*)::int AS total
          FROM provider_scan_records
          WHERE ticket_id = ${ticketId}::uuid AND status = 'valid'
        `;
        const isDuplicate = (duplicateRows[0]?.total ?? 0) > 0;
        const txStatus: 'valid' | 'duplicate' = isDuplicate
          ? 'duplicate'
          : 'valid';

        await tx.$executeRaw`
          INSERT INTO provider_scan_records (
            provider_id,
            event_id,
            ticket_id,
            ticket_code,
            attendee_name,
            ticket_type,
            scanned_by,
            status
          )
          VALUES (
            ${member.providerId}::uuid,
            ${eventId}::uuid,
            ${ticketId}::uuid,
            ${persistedCode},
            ${resolvedName},
            ${ticketType},
            ${userId}::uuid,
            ${txStatus}
          )
        `;

        return { status: txStatus, attendeeName: resolvedName };
      });
      status = txResult.status;
      attendeeName = txResult.attendeeName;
    } else {
      // Couldn't resolve a ticket id (bad signature, unknown format,
      // event mismatch). Persist an `invalid` audit row outside the
      // transaction since there's no ticket to lock against.
      await this.prisma.$executeRaw`
        INSERT INTO provider_scan_records (
          provider_id,
          event_id,
          ticket_id,
          ticket_code,
          attendee_name,
          ticket_type,
          scanned_by,
          status
        )
        VALUES (
          ${member.providerId}::uuid,
          ${eventId}::uuid,
          ${null}::uuid,
          ${persistedCode},
          ${attendeeName},
          ${ticketType},
          ${userId}::uuid,
          'invalid'
        )
      `;
    }

    if (status === 'valid') {
      await this.appendActivity(
        member.providerId,
        'scan',
        `Acceso validado en ${event.title}`,
        attendeeName,
      );
    }

    return {
      status,
      attendeeName,
      ticketCode: persistedCode,
      eventId,
      verified: parsed?.verified ?? false,
    };
  }

  async getScanRecords(userId: string, eventId?: string) {
    const member = await this.requireMembership(userId);
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        event_id: string;
        ticket_code: string;
        attendee_name: string | null;
        ticket_type: string | null;
        status: string;
        scanned_at: Date;
        event_title: string;
      }>
    >`
      SELECT
        sr.id,
        sr.event_id,
        sr.ticket_code,
        sr.attendee_name,
        sr.ticket_type,
        sr.status,
        sr.scanned_at,
        e.title AS event_title
      FROM provider_scan_records sr
      JOIN events e ON e.id = sr.event_id
      WHERE sr.provider_id = ${member.providerId}::uuid
        AND (${eventId ?? null}::uuid IS NULL OR sr.event_id = ${eventId ?? null}::uuid)
      ORDER BY sr.scanned_at DESC
      LIMIT 50
    `;
    return rows.map((row) => ({
      id: row.id,
      eventId: row.event_id,
      eventTitle: row.event_title,
      ticketCode: row.ticket_code,
      attendeeName: row.attendee_name ?? 'Invitado',
      ticketType: row.ticket_type ?? 'General',
      status: row.status,
      scannedAt: row.scanned_at,
      scannedBy: 'Staff',
    }));
  }

  async getActivity(userId: string) {
    const member = await this.requireMembership(userId);
    return this.prisma.$queryRaw<
      Array<{
        id: string;
        type: string;
        message: string;
        meta: string | null;
        date: Date;
      }>
    >`
      SELECT
        id,
        type,
        message,
        meta,
        created_at AS date
      FROM provider_activity_log
      WHERE provider_id = ${member.providerId}::uuid
      ORDER BY created_at DESC
      LIMIT 120
    `;
  }

  async getDashboard(userId: string) {
    const member = await this.requireMembership(userId);
    const events = await this.listProviderEvents(userId);

    const gross = events.reduce((sum, row) => sum + row.revenue, 0);
    const platformFee = 10;
    const feeAmount = (gross * platformFee) / 100;
    const pendingRows = await this.prisma.$queryRaw<Array<{ total: number }>>`
      SELECT COALESCE(SUM(amount), 0)::float8 AS total
      FROM provider_payout_requests
      WHERE provider_id = ${member.providerId}::uuid
        AND status = 'pending'
    `;
    const completedRows = await this.prisma.$queryRaw<Array<{ total: number }>>`
      SELECT COALESCE(SUM(amount), 0)::float8 AS total
      FROM provider_payout_requests
      WHERE provider_id = ${member.providerId}::uuid
        AND status = 'completed'
    `;
    const pendingBalance = Number(pendingRows[0]?.total ?? 0);
    const paidOut = Number(completedRows[0]?.total ?? 0);
    const availableBalance = Math.max(
      gross - feeAmount - pendingBalance - paidOut,
      0,
    );

    const payouts = await this.listPayouts(userId);
    const activity = await this.getActivity(userId);

    return {
      availableBalance,
      pendingBalance,
      platformFee,
      totals: {
        gross,
        fees: feeAmount,
        net: gross - feeAmount,
        soldTickets: events.reduce((sum, row) => sum + row.ticketsSold, 0),
        scans: events.reduce((sum, row) => sum + row.scans, 0),
      },
      events,
      payouts,
      activity,
    };
  }

  async listPayouts(userId: string) {
    const member = await this.requireMembership(userId);
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        amount: number;
        method: string;
        status: string;
        date: Date;
      }>
    >`
      SELECT
        id,
        amount::float8 AS amount,
        method,
        status,
        created_at AS date
      FROM provider_payout_requests
      WHERE provider_id = ${member.providerId}::uuid
      ORDER BY created_at DESC
      LIMIT 200
    `;
    return rows.map((row) => ({
      id: row.id,
      amount: Number(row.amount),
      method: row.method,
      status: row.status,
      date: row.date,
    }));
  }

  async requestPayout(userId: string, body: Record<string, unknown>) {
    const member = await this.requireMembership(userId, ['owner', 'admin']);
    const amount = Number(body.amount ?? 0);
    const method =
      this.safeString(body.method).trim() || 'BAC Honduras Â· ****4521';
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('amount invÃ¡lido');
    }

    const dashboard = await this.getDashboard(userId);
    if (amount > dashboard.availableBalance) {
      throw new BadRequestException('Saldo insuficiente');
    }

    await this.prisma.$executeRaw`
      INSERT INTO provider_payout_requests (
        provider_id,
        amount,
        method,
        status,
        created_by
      )
      VALUES (
        ${member.providerId}::uuid,
        ${amount},
        ${method},
        'pending',
        ${userId}::uuid
      )
    `;
    await this.appendActivity(
      member.providerId,
      'payout',
      `Retiro solicitado por L. ${amount.toFixed(2)}`,
      method,
    );
    return { requested: true };
  }
}
