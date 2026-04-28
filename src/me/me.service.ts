import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { parseList } from '../events/events.types';

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
  constructor(private readonly prisma: PrismaService) {}

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
    filters?: { cities?: string | string[]; types?: string | string[] },
  ) {
    await this.ensureTicketHoldersTable();
    const cities = parseList(filters?.cities);
    const types = parseList(filters?.types);

    const where: any = { ownerId: userId };
    if (cities.length > 0 || types.length > 0) {
      where.event = {
        ...(cities.length > 0 ? { city: { in: cities } } : {}),
        ...(types.length > 0
          ? {
              interests: {
                some: { interest: { slug: { in: types } } },
              },
            }
          : {}),
      };
    }

    const tickets = await this.prisma.ticket.findMany({
      where,
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
      { holderName: string; holderEmail: string }
    >();
    for (const ticket of tickets) {
      const rows = await this.prisma.$queryRaw<
        Array<{ holder_name: string; holder_email: string }>
      >`
        SELECT holder_name, holder_email
        FROM ticket_holders
        WHERE ticket_id = ${ticket.id}::uuid
        LIMIT 1
      `;
      const row = rows[0];
      if (row) {
        holdersByTicket.set(ticket.id, {
          holderName: row.holder_name,
          holderEmail: row.holder_email,
        });
      }
    }

    return tickets.map((ticket) =>
      this.toTicketDto(ticket, holdersByTicket.get(ticket.id)),
    );
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

    const fallbackName =
      nonEmptyOrUndefined(options?.name) ?? 'Invitado';
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
      return { name, email };
    });

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
          holder_email
        )
        VALUES (
          ${row.id}::uuid,
          ${holder.name},
          ${holder.email}
        )
      `;
    }
    return { createdCount: createdRows.length };
  }

  async getTicketDetails(userId: string, ticketId: string) {
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
    if (ticket.ownerId !== userId) {
      throw new ForbiddenException('Ticket does not belong to user');
    }

    const holderRows = await this.prisma.$queryRaw<
      Array<{ holder_name: string; holder_email: string }>
    >`
      SELECT holder_name, holder_email
      FROM ticket_holders
      WHERE ticket_id = ${ticket.id}::uuid
      LIMIT 1
    `;
    const holder = holderRows[0];

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
        created_at timestamptz NOT NULL DEFAULT now()
      )
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
    const cutoff = new Date(startsAt).getTime() - row.refund_deadline_hours * 60 * 60 * 1000;
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

  private toTicketDto(ticket: {
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
  holder?: { holderName: string; holderEmail: string },
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

    return memberships
      .map(({ conversation }) => {
        const others = conversation.members.filter((m) => m.userId !== userId);
        const peer = others[0]?.profile;
        const last = conversation.messages[0];

        return {
          id: conversation.id,
          name: peer?.fullName ?? peer?.username ?? 'Conversación',
          lastMessage: last?.body ?? '',
          avatarColor: peer?.avatarColor ?? '#5a4a4a',
          tabs: ['amigos'] as Array<'amigos' | 'eventos'>,
          updatedAt: last?.createdAt ?? conversation.createdAt,
        };
      })
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )
      .map(({ updatedAt, ...rest }) => {
        void updatedAt;
        return rest;
      });
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
