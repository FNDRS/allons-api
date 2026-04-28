import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { parseList } from '../events/events.types';
import {
  ConversationsService,
  parseMessageBody,
} from '../conversations/conversations.service';
import { MailService } from '../../shared/mail/mail.service';
import { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';

interface UpdateProfileInput {
  fullName?: string | null;
  location?: string | null;
  avatarUrl?: string | null;
  avatarColor?: string | null;
}

export interface NotificationItemDto {
  id: string;
  categoryLabel: string;
  title: string;
  description: string;
  date: string;
  avatarColor: string;
  relevantTabs: string[];
}

export interface NotificationGroupDto {
  groupLabel: string;
  items: NotificationItemDto[];
}

@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversationsService: ConversationsService,
    private readonly mailService: MailService,
    private readonly supabaseAdmin: SupabaseAdminService,
  ) {}

  async getProfile(
    userId: string,
    email?: string,
    metadata: Record<string, unknown> = {},
  ) {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      include: {
        interests: { include: { interest: true } },
      },
    });

    const fallbackName =
      getMetadataString(metadata, 'name') ??
      getMetadataString(metadata, 'full_name');
    const fallbackUsername =
      getMetadataString(metadata, 'username') ??
      getMetadataString(metadata, 'user_name') ??
      getMetadataString(metadata, 'preferred_username');
    const fallbackAvatarUrl =
      getMetadataString(metadata, 'avatar_url') ??
      getMetadataString(metadata, 'picture');
    const fallbackLocation = getMetadataString(metadata, 'location');
    const fallbackAvatarColor = '#787878';

    const profileFullName = nonEmptyOrUndefined(profile?.fullName);
    const profileUsername = nonEmptyOrUndefined(profile?.username);
    const profileAvatarUrl = nonEmptyOrUndefined(profile?.avatarUrl);
    const profileAvatarColor = nonEmptyOrUndefined(profile?.avatarColor);
    const profileLocation = nonEmptyOrUndefined(profile?.location);

    return {
      userId,
      email: email ?? null,
      fullName: profileFullName ?? fallbackName ?? null,
      username: profileUsername ?? fallbackUsername ?? null,
      avatarUrl: profileAvatarUrl ?? fallbackAvatarUrl ?? null,
      avatarColor: profileAvatarColor ?? fallbackAvatarColor,
      location: profileLocation ?? fallbackLocation ?? null,
      interests: (profile?.interests ?? []).map((row) => row.interest.name),
    };
  }

  async updateProfile(
    userId: string,
    email: string | undefined,
    input: UpdateProfileInput,
    metadata: Record<string, unknown> = {},
  ) {
    const data: Record<string, unknown> = {};
    if (input.fullName !== undefined) data.fullName = input.fullName;
    if (input.location !== undefined) data.location = input.location;
    if (input.avatarUrl !== undefined) data.avatarUrl = input.avatarUrl;
    if (input.avatarColor !== undefined) data.avatarColor = input.avatarColor;

    const fallbackName =
      typeof metadata.name === 'string' ? metadata.name : undefined;
    const fallbackUsername =
      typeof metadata.username === 'string' ? metadata.username : undefined;

    await this.prisma.profile.upsert({
      where: { userId },
      create: {
        userId,
        fullName: (data.fullName as string | undefined) ?? fallbackName ?? null,
        username: fallbackUsername ?? null,
        location: (data.location as string | undefined) ?? null,
        avatarUrl: (data.avatarUrl as string | undefined) ?? null,
        avatarColor: (data.avatarColor as string | undefined) ?? null,
      },
      update: { ...data, updatedAt: new Date() },
    });

    return this.getProfile(userId, email, metadata);
  }

  async listTickets(
    userId: string,
    filters?: {
      cities?: string | string[];
      types?: string | string[];
      email?: string | null;
    },
  ) {
    await this.ensureTicketHoldersTable();
    const cities = parseList(filters?.cities);
    const types = parseList(filters?.types);
    const userEmail = (filters?.email ?? '').trim().toLowerCase();

    const eventFilter =
      cities.length > 0 || types.length > 0
        ? {
            ...(cities.length > 0 ? { city: { in: cities } } : {}),
            ...(types.length > 0
              ? {
                  interests: {
                    some: { interest: { slug: { in: types } } },
                  },
                }
              : {}),
          }
        : undefined;

    const ownedWhere: any = { ownerId: userId };
    if (eventFilter) ownedWhere.event = eventFilter;

    let invitedTicketIds: string[] = [];
    if (userEmail) {
      const rows = await this.prisma.$queryRaw<Array<{ ticket_id: string }>>`
        SELECT ticket_id
        FROM ticket_holders
        WHERE LOWER(holder_email) = ${userEmail}
      `;
      invitedTicketIds = rows.map((r) => r.ticket_id);
    }

    const invitedWhere: any = {
      AND: [
        { id: { in: invitedTicketIds } },
        { ownerId: { not: userId } },
        ...(eventFilter ? [{ event: eventFilter }] : []),
      ],
    };

    const tickets = await this.prisma.ticket.findMany({
      where:
        invitedTicketIds.length > 0
          ? { OR: [ownedWhere, invitedWhere] }
          : ownedWhere,
      include: {
        event: {
          include: {
            provider: true,
            interests: { include: { interest: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const holdersByTicket = new Map<
      string,
      { holderName: string; holderEmail: string; holderUserId: string | null }
    >();
    for (const ticket of tickets) {
      const rows = await this.prisma.$queryRaw<
        Array<{
          holder_name: string;
          holder_email: string;
          holder_user_id: string | null;
        }>
      >`
        SELECT holder_name, holder_email, holder_user_id
        FROM ticket_holders
        WHERE ticket_id = ${ticket.id}::uuid
        LIMIT 1
      `;
      const row = rows[0];
      if (row) {
        holdersByTicket.set(ticket.id, {
          holderName: row.holder_name,
          holderEmail: row.holder_email,
          holderUserId: row.holder_user_id,
        });
      }
    }

    const normalizedUserEmail = userEmail.trim().toLowerCase();
    const groups = new Map<
      string,
      {
        representative: (typeof tickets)[number];
        representativeHolder?: {
          holderName: string;
          holderEmail: string;
          holderUserId: string | null;
        };
        attendeeEmails: Set<string>;
      }
    >();

    for (const ticket of tickets) {
      const holder = holdersByTicket.get(ticket.id);
      const key = ticket.eventId ?? ticket.id;
      if (!groups.has(key)) {
        groups.set(key, {
          representative: ticket,
          representativeHolder: holder,
          attendeeEmails: new Set<string>(),
        });
      }
      const group = groups.get(key)!;
      const holderEmail = (holder?.holderEmail ?? '').trim().toLowerCase();
      if (holderEmail) group.attendeeEmails.add(holderEmail);

      const currentRepEmail = (group.representativeHolder?.holderEmail ?? '')
        .trim()
        .toLowerCase();
      const isCurrentUsersTicket = holderEmail === normalizedUserEmail;
      const repIsCurrentUsersTicket = currentRepEmail === normalizedUserEmail;
      if (isCurrentUsersTicket && !repIsCurrentUsersTicket) {
        group.representative = ticket;
        group.representativeHolder = holder;
      }
    }

    return Array.from(groups.values()).map((group) => {
      const dto = this.toTicketDto(
        group.representative,
        group.representativeHolder,
      );
      return {
        ...dto,
        attendeeCount: Math.max(group.attendeeEmails.size, 1),
      };
    });
  }

  async createTicket(
    userId: string,
    eventId: string,
    quantity = 1,
    options?: {
      name?: string | null;
      email?: string | null;
      holders?: Array<{ name?: string; email?: string }>;
    },
  ) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    await this.ensureTicketHoldersTable();

    const providedHolders = options?.holders ?? [];
    if (providedHolders.length > quantity) {
      throw new BadRequestException('holders length cannot exceed quantity');
    }

    const fallbackName = nonEmptyOrUndefined(options?.name) ?? 'Invitado';
    const fallbackEmail = nonEmptyOrUndefined(options?.email);
    const holders = Array.from({ length: quantity }, (_, idx) => {
      const holder = providedHolders[idx];
      const name = nonEmptyOrUndefined(holder?.name) ?? fallbackName;
      const email =
        nonEmptyOrUndefined(holder?.email) ??
        (idx === 0 ? fallbackEmail : undefined);
      if (!email) {
        throw new BadRequestException(
          `holder email is required for ticket ${idx + 1}`,
        );
      }
      const holderUserId =
        fallbackEmail &&
        email.trim().toLowerCase() === fallbackEmail.trim().toLowerCase()
          ? userId
          : null;
      return { name, email, holderUserId };
    });

    const seenEmails = new Set<string>();
    for (const holder of holders) {
      const normalized = holder.email.trim().toLowerCase();
      if (seenEmails.has(normalized)) {
        throw new BadRequestException(
          'No puedes comprar esta invitación ya tienes una invitación asignada para este evento.',
        );
      }
      seenEmails.add(normalized);
    }
    for (const holder of holders) {
      await this.assertNoDuplicateTicketForEventAndEmail(
        event.id,
        holder.email,
        'purchase',
      );
    }

    const createdRows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO tickets (
        owner_id,
        event_id,
        title,
        theme_color,
        attendee_count
      )
      SELECT
        ${userId}::uuid,
        ${event.id}::uuid,
        ${event.title},
        ${event.themeColor},
        1
      FROM generate_series(1, ${quantity}::int)
      RETURNING id
    `;
    if (createdRows.length === 0) {
      throw new InternalServerErrorException('Failed to create ticket');
    }
    for (let i = 0; i < createdRows.length; i += 1) {
      const row = createdRows[i];
      const holder = holders[i];
      await this.prisma.$executeRaw`
        INSERT INTO ticket_holders (
          ticket_id,
          holder_name,
          holder_email,
          holder_user_id,
          accepted_at
        )
        VALUES (
          ${row.id}::uuid,
          ${holder.name},
          ${holder.email},
          ${holder.holderUserId}::uuid,
          ${holder.holderUserId ? new Date() : null}
        )
      `;
    }
    return {
      createdCount: createdRows.length,
      ticketIds: createdRows.map((row) => row.id),
      holders: holders.map((h) => ({ name: h.name, email: h.email })),
    };
  }

  async getTicketDetails(
    userId: string,
    ticketId: string,
    userEmail?: string | null,
  ) {
    await this.ensureTicketHoldersTable();
    await this.ensureProviderRefundPoliciesTable();

    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        event: {
          include: {
            provider: true,
            interests: { include: { interest: true } },
          },
        },
      },
    });
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }
    const holderRows = await this.prisma.$queryRaw<
      Array<{
        holder_name: string;
        holder_email: string;
        holder_user_id: string | null;
      }>
    >`
      SELECT holder_name, holder_email, holder_user_id
      FROM ticket_holders
      WHERE ticket_id = ${ticket.id}::uuid
      LIMIT 1
    `;
    const holder = holderRows[0];

    const normalizedUserEmail = (userEmail ?? '').trim().toLowerCase();
    const holderEmail = (holder?.holder_email ?? '').trim().toLowerCase();
    const holderUserId = holder?.holder_user_id ?? null;
    const isOwner = ticket.ownerId === userId;
    const isAssignedByUserId = Boolean(holderUserId) && holderUserId === userId;
    const isAssignedHolder =
      normalizedUserEmail.length > 0 && holderEmail === normalizedUserEmail;

    if (!isOwner && !isAssignedHolder && !isAssignedByUserId) {
      throw new ForbiddenException('Ticket does not belong to user');
    }

    const refundPolicy = await this.getRefundPolicyForProvider(
      ticket.event?.providerId ?? null,
      ticket.event?.startsAt ?? null,
    );

    return {
      ...this.toTicketDto(
        ticket,
        holder
          ? { holderName: holder.holder_name, holderEmail: holder.holder_email }
          : undefined,
      ),
      qrPayload: JSON.stringify({
        ticketId: ticket.id,
        eventId: ticket.eventId,
        holderName: holder?.holder_name ?? null,
        holderEmail: holder?.holder_email ?? null,
      }),
      refundPolicy,
    };
  }

  async cancelTicket(userId: string, ticketId: string) {
    await this.ensureProviderRefundPoliciesTable();

    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { event: true },
    });
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }
    if (ticket.ownerId !== userId) {
      throw new ForbiddenException('Ticket does not belong to user');
    }

    const refundPolicy = await this.getRefundPolicyForProvider(
      ticket.event?.providerId ?? null,
      ticket.event?.startsAt ?? null,
    );

    await this.prisma.ticket.delete({ where: { id: ticket.id } });
    return {
      cancelled: true,
      refundEligible: refundPolicy.eligible,
      refundMessage: refundPolicy.eligible
        ? 'La reserva fue cancelada y aplica reembolso.'
        : 'La reserva fue cancelada, pero no aplica reembolso.',
    };
  }

  private async ensureTicketHoldersTable() {
    await this.prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS ticket_holders (
        ticket_id uuid PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
        holder_name text NOT NULL,
        holder_email text NOT NULL,
        holder_user_id uuid,
        accepted_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await this.prisma.$executeRaw`
      ALTER TABLE ticket_holders
      ADD COLUMN IF NOT EXISTS holder_user_id uuid
    `;
    await this.prisma.$executeRaw`
      ALTER TABLE ticket_holders
      ADD COLUMN IF NOT EXISTS accepted_at timestamptz
    `;
  }

  private async ensureProviderRefundPoliciesTable() {
    await this.prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS provider_refund_policies (
        provider_id uuid PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
        refund_enabled boolean NOT NULL DEFAULT false,
        refund_deadline_hours integer NOT NULL DEFAULT 24,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `;
  }

  private async getRefundPolicyForProvider(
    providerId: string | null,
    startsAt: Date | null,
  ) {
    if (!providerId) {
      return {
        enabled: false,
        deadlineHours: 24,
        eligible: false,
        reason: 'El evento no tiene proveedor configurado.',
      };
    }
    const rows = await this.prisma.$queryRaw<
      Array<{ refund_enabled: boolean; refund_deadline_hours: number }>
    >`
      SELECT refund_enabled, refund_deadline_hours
      FROM provider_refund_policies
      WHERE provider_id = ${providerId}::uuid
      LIMIT 1
    `;
    const row = rows[0] ?? { refund_enabled: false, refund_deadline_hours: 24 };
    if (!row.refund_enabled) {
      return {
        enabled: false,
        deadlineHours: row.refund_deadline_hours,
        eligible: false,
        reason: 'El proveedor no permite reembolsos.',
      };
    }
    if (!startsAt) {
      return {
        enabled: true,
        deadlineHours: row.refund_deadline_hours,
        eligible: true,
        reason: 'Reembolso habilitado por proveedor.',
      };
    }

    const now = Date.now();
    const cutoff =
      new Date(startsAt).getTime() - row.refund_deadline_hours * 60 * 60 * 1000;
    const eligible = now <= cutoff;
    return {
      enabled: true,
      deadlineHours: row.refund_deadline_hours,
      eligible,
      reason: eligible
        ? `Reembolso disponible hasta ${row.refund_deadline_hours}h antes del evento.`
        : `Ya pasó la ventana de ${row.refund_deadline_hours}h para reembolso.`,
    };
  }

  private toTicketDto(
    ticket: {
      id: string;
      title: string;
      tab: string;
      themeColor: string | null;
      attendeeCount: number;
      eventId: string | null;
      event: {
        id: string;
        title: string;
        city: string | null;
        venue: string | null;
        address: string | null;
        themeColor: string | null;
        provider: unknown;
        interests: { interest: { slug: string } }[];
        smokingAllowed: boolean;
        petFriendly: boolean;
        parkingAvailable: boolean;
        minAge: number | null;
      } | null;
    },
    holder?: {
      holderName: string;
      holderEmail: string;
      holderUserId?: string | null;
    },
  ) {
    return {
      id: ticket.id,
      title: ticket.title,
      tab: ticket.tab,
      color: ticket.themeColor ?? '#2a3a4a',
      attendeeCount: ticket.attendeeCount,
      holderName: holder?.holderName ?? null,
      holderEmail: holder?.holderEmail ?? null,
      eventId: ticket.eventId,
      event: ticket.event
        ? {
            id: ticket.event.id,
            title: ticket.event.title,
            city: ticket.event.city,
            venue: ticket.event.venue,
            address: ticket.event.address,
            themeColor: ticket.event.themeColor,
            provider: ticket.event.provider,
            types: (ticket.event.interests ?? []).map((x) => x.interest.slug),
            smokingAllowed: ticket.event.smokingAllowed,
            petFriendly: ticket.event.petFriendly,
            parkingAvailable: ticket.event.parkingAvailable,
            minAge: ticket.event.minAge,
          }
        : null,
    };
  }

  async listConversations(userId: string) {
    await this.conversationsService.ensureConversationReadsTable();
    const memberships = await this.prisma.conversationMember.findMany({
      where: { userId },
      include: {
        conversation: {
          include: {
            members: { include: { profile: true } },
            messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
        },
      },
    });

    const base = memberships
      .map(({ conversation }) => {
        const others = conversation.members.filter((m) => m.userId !== userId);
        const peer = others[0]?.profile;
        const last = conversation.messages[0];
        const preview = last ? previewFromBody(last.body) : '';
        const tabs: Array<'amigos' | 'eventos'> = last
          ? previewIsEventInvite(last.body)
            ? ['eventos']
            : ['amigos']
          : ['amigos'];

        return {
          id: conversation.id,
          name: peer?.fullName ?? peer?.username ?? 'Conversación',
          lastMessage: preview,
          peerUserId: peer?.userId ?? null,
          avatarUrl: peer?.avatarUrl ?? null,
          avatarColor: peer?.avatarColor ?? '#5a4a4a',
          tabs,
          lastSenderId: last?.senderId ?? null,
          updatedAt: last?.createdAt ?? conversation.createdAt,
        };
      })
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )
      .map(async ({ updatedAt, lastSenderId, ...rest }) => {
        const readRows = await this.prisma.$queryRaw<
          Array<{ last_read_at: Date }>
        >`
          SELECT last_read_at
          FROM conversation_reads
          WHERE conversation_id = ${rest.id}::uuid
            AND user_id = ${userId}::uuid
          LIMIT 1
        `;
        const lastReadAt = readRows[0]?.last_read_at ?? null;
        const unread =
          Boolean(lastSenderId) &&
          lastSenderId !== userId &&
          (!lastReadAt ||
            new Date(updatedAt).getTime() > new Date(lastReadAt).getTime());
        return {
          ...rest,
          unread,
        };
      });
    return Promise.all(base);
  }

  async listNotifications(userId: string) {
    const notifications = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const todayItems: NotificationItemDto[] = [];
    const previousItems: NotificationItemDto[] = [];

    for (const n of notifications) {
      const item: NotificationItemDto = {
        id: n.id,
        categoryLabel: n.categoryLabel ?? '',
        title: n.title,
        description: n.description ?? '',
        date: formatShortDate(n.createdAt),
        avatarColor: '#4a4a5a',
        relevantTabs: n.relevantTabs ?? [],
      };
      if (n.createdAt >= startOfToday) todayItems.push(item);
      else previousItems.push(item);
    }

    const groups: NotificationGroupDto[] = [];
    if (todayItems.length > 0)
      groups.push({ groupLabel: 'Hoy', items: todayItems });
    if (previousItems.length > 0)
      groups.push({ groupLabel: 'Previamente', items: previousItems });

    return groups;
  }

  async shareTicketWithUser(
    userId: string,
    args: { ticketId: string; peerUserId: string },
  ) {
    await this.ensureTicketHoldersTable();
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: args.ticketId },
      include: { event: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.ownerId !== userId) {
      throw new ForbiddenException('Ticket does not belong to user');
    }

    const peerAuth = await this.supabaseAdmin.db.auth.admin.getUserById(
      args.peerUserId,
    );
    const peerUser = peerAuth.data?.user;
    const peerEmail = (peerUser?.email ?? '').trim().toLowerCase();
    if (!peerEmail) {
      throw new BadRequestException(
        'No se pudo obtener el correo del usuario invitado.',
      );
    }
    const peerName =
      (typeof peerUser?.user_metadata?.name === 'string'
        ? peerUser.user_metadata.name
        : undefined) ??
      (typeof peerUser?.user_metadata?.full_name === 'string'
        ? peerUser.user_metadata.full_name
        : undefined) ??
      'Invitado';

    await this.assertNoDuplicateTicketForEventAndEmail(
      ticket.eventId,
      peerEmail,
      'accept-invite',
    );

    // Assign this shared ticket holder to the invited Allons user so it appears in "Mis Tickets".
    await this.prisma.$executeRaw`
      INSERT INTO ticket_holders (
        ticket_id,
        holder_name,
        holder_email,
        holder_user_id,
        accepted_at
      )
      VALUES (
        ${ticket.id}::uuid,
        ${peerName},
        ${peerEmail},
        ${args.peerUserId}::uuid,
        NULL
      )
      ON CONFLICT (ticket_id)
      DO UPDATE SET
        holder_name = EXCLUDED.holder_name,
        holder_email = EXCLUDED.holder_email,
        holder_user_id = EXCLUDED.holder_user_id,
        accepted_at = NULL
    `;

    const conv = await this.conversationsService.findOrCreateDirect(
      userId,
      args.peerUserId,
    );
    await this.conversationsService.sendMessage(userId, conv.id, {
      type: 'event_invite',
      text: `Te invité a "${ticket.event?.title ?? ticket.title}".`,
      eventId: ticket.eventId,
      ticketId: ticket.id,
      eventTitle: ticket.event?.title ?? ticket.title,
      eventStartsAt: ticket.event?.startsAt
        ? ticket.event.startsAt.toISOString()
        : null,
    });
    await this.createTicketNotification(
      args.peerUserId,
      'Invitación nueva',
      `Te enviaron una invitación para ${ticket.event?.title ?? ticket.title}.`,
      ['eventos'],
    );
    return { sent: true, conversationId: conv.id };
  }

  async inviteTicketRecipient(
    userId: string,
    args: {
      ticketId: string;
      email: string;
      name?: string | null;
      inviterName?: string | null;
    },
  ) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: args.ticketId },
      include: { event: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.ownerId !== userId) {
      throw new ForbiddenException('Ticket does not belong to user');
    }

    const email = (args.email ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      throw new BadRequestException('Email inválido');
    }
    await this.assertNoDuplicateTicketForEventAndEmail(
      ticket.eventId,
      email,
      'accept-invite',
    );

    let allonsUserId: string | null = null;
    try {
      const lookup = await this.supabaseAdmin.db.auth.admin.listUsers({
        page: 1,
        perPage: 200,
      });
      const users = (lookup.data?.users ?? []) as Array<{
        id?: string;
        email?: string | null;
      }>;
      const found = users.find((u) => (u.email ?? '').toLowerCase() === email);
      if (found?.id) allonsUserId = found.id;
    } catch {
      allonsUserId = null;
    }

    let conversationId: string | null = null;
    if (allonsUserId) {
      await this.prisma.$executeRaw`
        UPDATE ticket_holders
        SET holder_user_id = ${allonsUserId}::uuid,
            accepted_at = NULL
        WHERE ticket_id = ${ticket.id}::uuid
      `;
      const conv = await this.conversationsService.findOrCreateDirect(
        userId,
        allonsUserId,
      );
      conversationId = conv.id;
      await this.conversationsService.sendMessage(userId, conv.id, {
        type: 'event_invite',
        text: `Te invité a "${ticket.event?.title ?? ticket.title}".`,
        eventId: ticket.eventId,
        ticketId: ticket.id,
        eventTitle: ticket.event?.title ?? ticket.title,
        eventStartsAt: ticket.event?.startsAt
          ? ticket.event.startsAt.toISOString()
          : null,
      });
      await this.createTicketNotification(
        allonsUserId,
        'Invitación nueva',
        `Te enviaron una invitación para ${ticket.event?.title ?? ticket.title}.`,
        ['eventos'],
      );
    }

    const mail = await this.mailService.sendTicketInvitation({
      to: email,
      inviterName: (args.inviterName ?? 'Un amigo').trim() || 'Un amigo',
      eventTitle: ticket.event?.title ?? ticket.title,
      ticketId: ticket.id,
      isAllonsUser: Boolean(allonsUserId),
    });

    return {
      sent: true,
      isAllonsUser: Boolean(allonsUserId),
      conversationId,
      mail,
    };
  }

  async acceptTicketInvitation(
    userId: string,
    userEmail: string | null | undefined,
    ticketId: string,
  ) {
    await this.ensureTicketHoldersTable();
    const rows = await this.prisma.$queryRaw<
      Array<{
        ticket_id: string;
        owner_id: string;
        event_title: string | null;
        holder_email: string;
        holder_user_id: string | null;
        accepted_at: Date | null;
      }>
    >`
      SELECT
        t.id AS ticket_id,
        t.owner_id,
        COALESCE(e.title, t.title) AS event_title,
        th.holder_email,
        th.holder_user_id,
        th.accepted_at
      FROM tickets t
      LEFT JOIN events e ON e.id = t.event_id
      JOIN ticket_holders th ON th.ticket_id = t.id
      WHERE t.id = ${ticketId}::uuid
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) {
      throw new BadRequestException('La invitación caducó.');
    }

    const normalizedUserEmail = (userEmail ?? '').trim().toLowerCase();
    const holderEmail = row.holder_email.trim().toLowerCase();
    const isHolderByUserId =
      Boolean(row.holder_user_id) && row.holder_user_id === userId;
    const isHolderByEmail =
      normalizedUserEmail.length > 0 && normalizedUserEmail === holderEmail;
    if (!isHolderByUserId && !isHolderByEmail) {
      throw new BadRequestException('La invitación caducó.');
    }

    if (!row.accepted_at) {
      await this.prisma.$executeRaw`
        UPDATE ticket_holders
        SET holder_user_id = ${userId}::uuid,
            accepted_at = now()
        WHERE ticket_id = ${ticketId}::uuid
      `;
      if (row.owner_id !== userId) {
        await this.createTicketNotification(
          row.owner_id,
          'Invitación aceptada',
          `Tu invitación para ${row.event_title ?? 'el evento'} fue aceptada.`,
          ['eventos'],
        );
      }
    }
    return { accepted: true, alreadyAccepted: Boolean(row.accepted_at) };
  }

  private async assertNoDuplicateTicketForEventAndEmail(
    eventId: string | null,
    email: string,
    context: 'purchase' | 'accept-invite',
  ) {
    if (!eventId) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return;

    const rows = await this.prisma.$queryRaw<Array<{ ticket_id: string }>>`
      SELECT t.id AS ticket_id
      FROM tickets t
      JOIN ticket_holders th ON th.ticket_id = t.id
      WHERE t.event_id = ${eventId}::uuid
        AND LOWER(th.holder_email) = ${normalizedEmail}
      LIMIT 1
    `;
    if (rows.length > 0) {
      if (context === 'purchase') {
        throw new BadRequestException(
          'No puedes comprar esta invitación ya tienes una invitación asignada para este evento.',
        );
      }
      throw new BadRequestException(
        'No puedes aceptar esta invitación porque ya tienes una invitación a tu nombre.',
      );
    }
  }

  private async createTicketNotification(
    userId: string,
    title: string,
    description: string,
    tabs: Array<'amigos' | 'eventos' | 'menciones'>,
  ) {
    await this.prisma.$executeRaw`
      INSERT INTO notifications (
        user_id,
        category_label,
        title,
        description,
        relevant_tabs
      )
      VALUES (
        ${userId}::uuid,
        ${'Invitaciones'},
        ${title},
        ${description},
        ${tabs}::text[]
      )
    `;
  }

  async listEventHistory(userId: string) {
    const tickets = await this.prisma.ticket.findMany({
      where: { ownerId: userId, NOT: { eventId: null } },
      include: { event: true },
      orderBy: { createdAt: 'desc' },
    });

    return tickets
      .filter((t) => t.event)
      .map((t) => ({
        id: t.event!.id,
        title: t.event!.title,
        subtitle: 'Detalles de evento',
        color: t.event!.themeColor ?? t.themeColor ?? '#3f2c44',
      }));
  }
}

function formatShortDate(date: Date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${d}/${m}`;
}

function previewFromBody(body: string) {
  const payload = parseMessageBody(body);
  if (payload.type === 'event_invite') {
    return payload.text || `Invitación: ${payload.eventTitle ?? 'evento'}`;
  }
  return payload.text ?? '';
}

function previewIsEventInvite(body: string) {
  return parseMessageBody(body).type === 'event_invite';
}

function getMetadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function nonEmptyOrUndefined(value?: string | null) {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}
