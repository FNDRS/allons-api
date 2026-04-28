import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type MessageKind = 'text' | 'event_invite' | 'system';

export interface MessagePayload {
  type: MessageKind;
  text?: string;
  eventId?: string | null;
  ticketId?: string | null;
  eventTitle?: string | null;
  eventStartsAt?: string | null;
}

export interface MessageDto {
  id: string;
  conversationId: string;
  senderId: string;
  createdAt: Date;
  payload: MessagePayload;
}

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureConversationReadsTable() {
    await this.prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS conversation_reads (
        conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
        last_read_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (conversation_id, user_id)
      )
    `;
  }

  async findOrCreateDirect(userId: string, peerUserId: string) {
    if (userId === peerUserId) {
      throw new BadRequestException('Selecciona otra persona.');
    }
    const peer = await this.prisma.profile.findUnique({
      where: { userId: peerUserId },
    });
    if (!peer) throw new NotFoundException('Usuario no encontrado.');

    const existingMember = await this.prisma.conversationMember.findFirst({
      where: {
        userId,
        conversation: {
          members: {
            some: { userId: peerUserId },
          },
        },
      },
      include: { conversation: { include: { members: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const existing = existingMember?.conversation;
    if (existing && existing.members.length === 2) {
      return existing;
    }

    const created = await this.prisma.conversation.create({
      data: {
        members: {
          create: [{ userId }, { userId: peerUserId }],
        },
      },
      include: { members: true },
    });
    return created;
  }

  async getConversation(userId: string, conversationId: string) {
    await this.ensureConversationReadsTable();
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        members: { include: { profile: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!conversation) {
      throw new NotFoundException('Conversación no encontrada');
    }
    if (!conversation.members.some((m) => m.userId === userId)) {
      throw new ForbiddenException('No perteneces a esta conversación.');
    }

    const peerProfile = conversation.members.find(
      (m) => m.userId !== userId,
    )?.profile;

    await this.prisma.$executeRaw`
      INSERT INTO conversation_reads (conversation_id, user_id, last_read_at)
      VALUES (${conversation.id}::uuid, ${userId}::uuid, now())
      ON CONFLICT (conversation_id, user_id)
      DO UPDATE SET last_read_at = EXCLUDED.last_read_at
    `;

    return {
      id: conversation.id,
      peer: peerProfile
        ? {
            userId: peerProfile.userId,
            fullName: peerProfile.fullName,
            username: peerProfile.username,
            avatarUrl: peerProfile.avatarUrl,
            avatarColor: peerProfile.avatarColor,
            location: peerProfile.location,
          }
        : null,
      messages: conversation.messages.map((m) => this.toMessageDto(m)),
    };
  }

  async sendMessage(
    userId: string,
    conversationId: string,
    payload: MessagePayload,
  ): Promise<MessageDto> {
    const member = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!member) {
      throw new ForbiddenException('No perteneces a esta conversación.');
    }
    const safePayload: MessagePayload = sanitizePayload(payload);
    const message = await this.prisma.message.create({
      data: {
        conversationId,
        senderId: userId,
        body: JSON.stringify(safePayload),
      },
    });
    return this.toMessageDto(message);
  }

  toMessageDto(message: {
    id: string;
    conversationId: string;
    senderId: string;
    createdAt: Date;
    body: string;
  }): MessageDto {
    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      createdAt: message.createdAt,
      payload: parseMessageBody(message.body),
    };
  }
}

function sanitizePayload(payload: MessagePayload): MessagePayload {
  const allowed: MessageKind[] = ['text', 'event_invite', 'system'];
  const type: MessageKind = allowed.includes(payload.type)
    ? payload.type
    : 'text';
  if (type === 'text') {
    const text = (payload.text ?? '').trim();
    if (!text) throw new BadRequestException('Mensaje vacío');
    return { type, text };
  }
  if (type === 'event_invite') {
    return {
      type,
      text: payload.text?.trim() || 'Te invité a un evento',
      eventId: payload.eventId ?? null,
      ticketId: payload.ticketId ?? null,
      eventTitle: payload.eventTitle ?? null,
      eventStartsAt: payload.eventStartsAt ?? null,
    };
  }
  return { type, text: payload.text ?? '' };
}

export function parseMessageBody(body: string): MessagePayload {
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === 'object' && typeof parsed.type === 'string') {
      return parsed as MessagePayload;
    }
  } catch {
    // ignored — legacy plain text
  }
  return { type: 'text', text: body };
}
