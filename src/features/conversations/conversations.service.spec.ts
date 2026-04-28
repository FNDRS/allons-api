import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  ConversationsService,
  parseMessageBody,
} from './conversations.service';
import type { PrismaService } from '../../prisma/prisma.service';

function makePrisma() {
  return {
    $executeRaw: jest.fn(() => Promise.resolve(1)),
    $queryRaw: jest.fn(() => Promise.resolve([])),
    profile: { findUnique: jest.fn() },
    conversationMember: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    conversation: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    message: {
      create: jest.fn(),
    },
  } as any;
}

describe('parseMessageBody', () => {
  it('parses JSON payloads and falls back to plain text', () => {
    expect(parseMessageBody('{"type":"text","text":"hola"}')).toEqual({
      type: 'text',
      text: 'hola',
    });
    expect(parseMessageBody('legacy')).toEqual({
      type: 'text',
      text: 'legacy',
    });
  });
});

describe('ConversationsService', () => {
  it('findOrCreateDirect rejects self and missing peer', async () => {
    const prisma = makePrisma() as unknown as PrismaService;
    const service = new ConversationsService(prisma);

    await expect(service.findOrCreateDirect('u1', 'u1')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    prisma.profile.findUnique.mockResolvedValueOnce(null);
    await expect(service.findOrCreateDirect('u1', 'u2')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('findOrCreateDirect returns existing conversation with 2 members', async () => {
    const prisma = makePrisma() as unknown as PrismaService;
    const service = new ConversationsService(prisma);
    prisma.profile.findUnique.mockResolvedValueOnce({ userId: 'u2' });
    prisma.conversationMember.findFirst.mockResolvedValueOnce({
      conversation: { id: 'c1', members: [{ userId: 'u1' }, { userId: 'u2' }] },
    });

    await expect(service.findOrCreateDirect('u1', 'u2')).resolves.toEqual({
      id: 'c1',
      members: [{ userId: 'u1' }, { userId: 'u2' }],
    });
  });

  it('sendMessage enforces membership and sanitizes payload', async () => {
    const prisma = makePrisma() as unknown as PrismaService;
    const service = new ConversationsService(prisma);
    prisma.conversationMember.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.sendMessage('u1', 'c1', { type: 'text', text: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    prisma.conversationMember.findUnique.mockResolvedValueOnce({
      conversationId: 'c1',
      userId: 'u1',
    });
    prisma.message.create.mockResolvedValueOnce({
      id: 'm1',
      conversationId: 'c1',
      senderId: 'u1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      body: JSON.stringify({ type: 'text', text: 'ok' }),
    });

    await expect(
      service.sendMessage('u1', 'c1', { type: 'text', text: '  ok  ' }),
    ).resolves.toMatchObject({ payload: { type: 'text', text: 'ok' } });
  });
});
