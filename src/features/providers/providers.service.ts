import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

type ProviderRole = 'owner' | 'admin' | 'staff_scanner';

interface ProviderMembership {
  providerId: string;
  role: ProviderRole;
}

interface EventAggregateRow {
  event_id: string;
  sold_count: number;
  scanned_count: number;
  revenue: number;
}

@Injectable()
export class ProvidersService {
  private infraReady = false;

  constructor(private readonly prisma: PrismaService) {}

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
    if (!legacyProvider) return null;

    await this.prisma.$executeRaw`
      INSERT INTO provider_members (provider_id, user_id, role, active)
      VALUES (${legacyProvider.id}::uuid, ${userId}::uuid, 'owner', true)
      ON CONFLICT (provider_id, user_id)
      DO UPDATE SET active = true, role = 'owner', updated_at = now()
    `;
    return { providerId: legacyProvider.id, role: 'owner' };
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

  private normalizeGalleryUrls(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const unique = new Set<string>();
    for (const item of raw) {
      const candidate =
        typeof item === 'string'
          ? item
          : item && typeof item === 'object' && 'url' in item
            ? String((item as { url?: unknown }).url ?? '')
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
    const role = String(raw ?? '').toLowerCase();
    if (role === 'owner') return 'owner';
    if (role === 'admin' || role === 'finance') return 'admin';
    return 'staff_scanner';
  }

  private mapMemberRoleToClientRole(raw: unknown): 'scanner' | 'admin' {
    const role = String(raw ?? '').toLowerCase();
    return role === 'staff_scanner' ? 'scanner' : 'admin';
  }

  private async getEventAggregates(providerId: string) {
    const rows = await this.prisma.$queryRaw<EventAggregateRow[]>`
      SELECT
        e.id AS event_id,
        COALESCE(tt.sold_count, 0)::int AS sold_count,
        COALESCE(sc.scanned_count, 0)::int AS scanned_count,
        COALESCE(tt.revenue, 0)::float8 AS revenue
      FROM events e
      LEFT JOIN (
        SELECT
          event_id,
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
      return {
        ...event,
        status: this.toEventStatus((event as any).status),
        eventType: (event as any).eventType ?? 'single',
        recurrence: (event as any).recurrence ?? null,
        recurrenceCustom: (event as any).recurrenceCustom ?? null,
        ticketMode: (event as any).ticketMode ?? 'paid',
        capacity: Number((event as any).capacity ?? 0),
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
    const settings = await this.prisma.$queryRaw<Array<{ logo_color: string | null }>>`
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
    await this.prisma.provider.update({
      where: { id: member.providerId },
      data: {
        name:
          body.name === null ? '' : body.name ? String(body.name).trim() : undefined,
        handle:
          body.handle === null
            ? null
            : body.handle
              ? String(body.handle).trim().replace(/^@+/, '')
              : undefined,
        description:
          body.description === null
            ? null
            : body.description
              ? String(body.description)
              : undefined,
        websiteUrl:
          body.websiteUrl === null
            ? null
            : body.websiteUrl
              ? String(body.websiteUrl)
              : undefined,
        logoUrl:
          body.logoUrl === null
            ? null
            : body.logoUrl
              ? String(body.logoUrl)
              : undefined,
      },
    });
    if (body.brandLogoColor !== undefined) {
      await this.prisma.$executeRaw`
        INSERT INTO provider_brand_settings (provider_id, logo_color, updated_at)
        VALUES (${member.providerId}::uuid, ${String(body.brandLogoColor ?? '#F67010')}, now())
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
    const targetUserId = String(body.userId ?? '').trim();
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
        ${body.name ? String(body.name) : null},
        ${body.email ? String(body.email).toLowerCase() : null},
        ${body.phone ? String(body.phone) : null},
        ${body.avatarColor ? String(body.avatarColor) : null},
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
      `Miembro actualizado: ${body.name ? String(body.name) : targetUserId}`,
      targetUserId,
    );
    return this.listProviderStaff(userId);
  }

  async updateProviderStaff(
    userId: string,
    targetUserId: string,
    body: Record<string, unknown>,
  ) {
    const member = await this.requireMembership(userId, ['owner', 'admin']);
    const role = body.role !== undefined ? this.mapRoleToMemberRole(body.role) : null;
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
          WHEN ${body.name !== undefined} THEN ${body.name ? String(body.name) : null}
          ELSE full_name
        END,
        email = CASE
          WHEN ${body.email !== undefined} THEN ${body.email ? String(body.email).toLowerCase() : null}
          ELSE email
        END,
        phone = CASE
          WHEN ${body.phone !== undefined} THEN ${body.phone ? String(body.phone) : null}
          ELSE phone
        END,
        avatar_color = CASE
          WHEN ${body.avatarColor !== undefined} THEN ${body.avatarColor ? String(body.avatarColor) : null}
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
    await this.prisma.$executeRaw`
      UPDATE provider_members
      SET active = false, updated_at = now()
      WHERE provider_id = ${member.providerId}::uuid
        AND user_id = ${targetUserId}::uuid
    `;
    await this.appendActivity(
      member.providerId,
      'staff',
      `Miembro desactivado: ${targetUserId}`,
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
    const code = String(body.code ?? '').trim().toUpperCase();
    if (!code || code.length < 3) {
      throw new BadRequestException('code inválido');
    }
    const percent = Number(body.percent ?? 0);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      throw new BadRequestException('percent inválido');
    }
    const maxUses = Math.max(1, Number(body.maxUses ?? 1));
    const eventId = body.eventId ? String(body.eventId) : null;
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
    const eventId = body.eventId === null ? null : body.eventId ? String(body.eventId) : undefined;
    await this.prisma.$executeRaw`
      UPDATE provider_discounts
      SET
        code = CASE WHEN ${body.code !== undefined} THEN ${String(body.code ?? '').toUpperCase()} ELSE code END,
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

  async createProviderEvent(
    userId: string,
    body: Record<string, unknown>,
  ) {
    const member = await this.requireMembership(userId, ['owner', 'admin']);
    const title = String(body.title ?? '').trim();
    if (!title) throw new BadRequestException('title es requerido');

    const created = await this.prisma.event.create({
      data: {
        providerId: member.providerId,
        createdBy: userId,
        title,
        description: body.description ? String(body.description) : null,
        startsAt: body.startsAt ? new Date(String(body.startsAt)) : null,
        endsAt: body.endsAt ? new Date(String(body.endsAt)) : null,
        city: body.city ? String(body.city) : null,
        venue: body.venue ? String(body.venue) : null,
        address: body.address ? String(body.address) : null,
        coverImageUrl: body.coverImageUrl ? String(body.coverImageUrl) : null,
        themeColor: body.themeColor ? String(body.themeColor) : null,
        smokingAllowed: Boolean(body.smokingAllowed),
        petFriendly: Boolean(body.petFriendly),
        parkingAvailable: Boolean(body.parkingAvailable),
        minAge: body.minAge ? Number(body.minAge) : null,
      },
    });

    await this.prisma.$executeRaw`
      UPDATE events
      SET
        event_type = ${String(body.eventType ?? 'single')},
        recurrence = ${
          body.recurrence ? String(body.recurrence) : null
        },
        recurrence_custom = ${
          body.recurrenceCustom
            ? JSON.stringify(body.recurrenceCustom)
            : null
        }::jsonb,
        ticket_mode = ${String(body.ticketMode ?? 'paid')},
        capacity = ${Number(body.capacity ?? 0)},
        status = ${String(body.status ?? 'draft')}
      WHERE id = ${created.id}::uuid
    `;
    await this.syncEventGallery(created.id, body.gallery);

    await this.appendActivity(
      member.providerId,
      'event',
      `Evento creado: ${created.title}`,
      created.id,
    );
    return this.getProviderEvent(userId, created.id);
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
        title: body.title ? String(body.title) : undefined,
        description:
          body.description === null
            ? null
            : body.description
              ? String(body.description)
              : undefined,
        startsAt: body.startsAt ? new Date(String(body.startsAt)) : undefined,
        endsAt: body.endsAt ? new Date(String(body.endsAt)) : undefined,
        city: body.city === null ? null : body.city ? String(body.city) : undefined,
        venue:
          body.venue === null ? null : body.venue ? String(body.venue) : undefined,
        address:
          body.address === null
            ? null
            : body.address
              ? String(body.address)
              : undefined,
        coverImageUrl:
          body.coverImageUrl === null
            ? null
            : body.coverImageUrl
              ? String(body.coverImageUrl)
              : undefined,
        themeColor:
          body.themeColor === null
            ? null
            : body.themeColor
              ? String(body.themeColor)
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
        event_type = COALESCE(${body.eventType ? String(body.eventType) : null}, event_type),
        recurrence = CASE WHEN ${body.recurrence !== undefined} THEN ${body.recurrence ? String(body.recurrence) : null} ELSE recurrence END,
        recurrence_custom = CASE
          WHEN ${body.recurrenceCustom !== undefined}
          THEN ${body.recurrenceCustom ? JSON.stringify(body.recurrenceCustom) : null}::jsonb
          ELSE recurrence_custom
        END,
        ticket_mode = COALESCE(${body.ticketMode ? String(body.ticketMode) : null}, ticket_mode),
        capacity = CASE
          WHEN ${body.capacity !== undefined}
          THEN ${Number(body.capacity ?? 0)}
          ELSE capacity
        END,
        status = COALESCE(${body.status ? String(body.status) : null}, status),
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
    await this.prisma.event.delete({ where: { id: event.id } });
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
    const name = String(body.name ?? '').trim();
    if (!name) throw new BadRequestException('name es requerido');
    await this.prisma.$executeRaw`
      INSERT INTO provider_event_ticket_types (
        provider_id, event_id, name, kind, price, total, sold_count, active
      )
      VALUES (
        ${member.providerId}::uuid,
        ${eventId}::uuid,
        ${name},
        ${String(body.kind ?? 'general')},
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
        name = COALESCE(${body.name ? String(body.name) : null}, name),
        kind = COALESCE(${body.kind ? String(body.kind) : null}, kind),
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

  private parseTicketId(rawCode: string): string | null {
    const trimmed = rawCode.trim();
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(trimmed)) return trimmed;
    try {
      const parsed = JSON.parse(trimmed) as { ticketId?: string };
      if (parsed?.ticketId && uuidRegex.test(parsed.ticketId)) {
        return parsed.ticketId;
      }
    } catch {
      return null;
    }
    return null;
  }

  async validateScan(userId: string, body: Record<string, unknown>) {
    const member = await this.requireMembership(userId, [
      'owner',
      'admin',
      'staff_scanner',
    ]);
    const eventId = String(body.eventId ?? '').trim();
    const ticketCode = String(body.ticketCode ?? '').trim();
    if (!eventId || !ticketCode) {
      throw new BadRequestException('eventId y ticketCode son requeridos');
    }
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, providerId: member.providerId },
      select: { id: true, title: true },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');

    const ticketId = this.parseTicketId(ticketCode);
    let status: 'valid' | 'duplicate' | 'invalid' = 'invalid';
    let attendeeName = 'Invitado';
    let ticketType = 'General';

    if (ticketId) {
      const ticket = await this.prisma.ticket.findFirst({
        where: { id: ticketId, eventId },
        select: { id: true },
      });
      if (ticket) {
        const duplicate = await this.prisma.$queryRaw<Array<{ total: number }>>`
          SELECT COUNT(*)::int AS total
          FROM provider_scan_records
          WHERE ticket_id = ${ticket.id}::uuid
            AND status = 'valid'
        `;
        if ((duplicate[0]?.total ?? 0) > 0) {
          status = 'duplicate';
        } else {
          status = 'valid';
          const holder = await this.prisma.$queryRaw<
            Array<{ holder_name: string | null }>
          >`
            SELECT holder_name
            FROM ticket_holders
            WHERE ticket_id = ${ticket.id}::uuid
            LIMIT 1
          `;
          attendeeName = holder[0]?.holder_name ?? attendeeName;
        }
      }
    }

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
        ${ticketId}::uuid,
        ${ticketCode},
        ${attendeeName},
        ${ticketType},
        ${userId}::uuid,
        ${status}
      )
    `;

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
      ticketCode,
      eventId,
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
      Array<{ id: string; type: string; message: string; meta: string | null; date: Date }>
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
    const availableBalance = Math.max(gross - feeAmount - pendingBalance - paidOut, 0);

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
    const method = String(body.method ?? '').trim() || 'BAC Honduras • ****4521';
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('amount inválido');
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
