import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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

  async getProfile(userId: string, email?: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      include: {
        interests: { include: { interest: true } },
      },
    });

    return {
      userId,
      email: email ?? null,
      fullName: profile?.fullName ?? null,
      username: profile?.username ?? null,
      avatarUrl: profile?.avatarUrl ?? null,
      avatarColor: profile?.avatarColor ?? null,
      location: profile?.location ?? null,
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

    return this.getProfile(userId, email);
  }

  async listTickets(userId: string) {
    const tickets = await this.prisma.ticket.findMany({
      where: { ownerId: userId },
      orderBy: { createdAt: 'desc' },
    });

    return tickets.map((ticket) => ({
      id: ticket.id,
      title: ticket.title,
      tab: ticket.tab,
      color: ticket.themeColor ?? '#2a3a4a',
      attendeeCount: ticket.attendeeCount,
      eventId: ticket.eventId,
    }));
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
        const others = conversation.members.filter(
          (m) => m.userId !== userId,
        );
        const peer = others[0]?.profile;
        const last = conversation.messages[0];

        return {
          id: conversation.id,
          name:
            peer?.fullName ?? peer?.username ?? 'Conversación',
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
      .map(({ updatedAt: _updatedAt, ...rest }) => rest);
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
        relevantTabs: (n.relevantTabs ?? []) as string[],
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
