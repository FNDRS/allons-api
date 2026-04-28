import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { MeService } from './me.service';

function makePrisma() {
  return {
    $executeRaw: jest.fn(async () => 1),
    $queryRaw: jest.fn(async () => []),
    profile: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    event: {
      findUnique: jest.fn(),
    },
    ticket: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    conversationMember: {
      findMany: jest.fn(),
    },
    notification: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
  } as any;
}

describe('MeService', () => {
  it('getProfile uses profile data and metadata fallbacks', async () => {
    const prisma = makePrisma();
    prisma.profile.findUnique.mockResolvedValueOnce({
      userId: 'u1',
      fullName: '',
      username: null,
      avatarUrl: null,
      avatarColor: null,
      location: null,
      interests: [{ interest: { name: 'music' } }],
    });
    const service = new MeService(
      prisma,
      { ensureConversationReadsTable: jest.fn() } as any,
      { sendTicketInvitation: jest.fn() } as any,
      { db: { auth: { admin: {} } } } as any,
    );

    const res = await service.getProfile('u1', 'x@y.com', {
      full_name: 'Ana',
      preferred_username: 'ana',
      picture: 'http://x',
      location: 'MX',
    });
    expect(res.fullName).toBe('Ana');
    expect(res.username).toBe('ana');
    expect(res.avatarUrl).toBe('http://x');
    expect(res.location).toBe('MX');
    expect(res.interests).toEqual(['music']);
  });

  it('updateProfile upserts and returns getProfile result', async () => {
    const prisma = makePrisma();
    prisma.profile.upsert.mockResolvedValueOnce({ userId: 'u1' });
    const service = new MeService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
    );
    const spy = jest
      .spyOn(service, 'getProfile')
      .mockResolvedValueOnce({ userId: 'u1' } as any);

    await expect(
      service.updateProfile('u1', 'a@b.com', { fullName: 'Ana' }, { username: 'ana' }),
    ).resolves.toEqual({ userId: 'u1' });
    expect(prisma.profile.upsert).toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
  });

  it('listTickets groups by event and uses holder info', async () => {
    const prisma = makePrisma();
    prisma.$queryRaw
      .mockResolvedValueOnce([]) // invited ticket ids
      .mockResolvedValueOnce([
        { holder_name: 'Ana', holder_email: 'a@b.com', holder_user_id: 'u1' },
      ]); // holder for first ticket

    prisma.ticket.findMany.mockResolvedValueOnce([
      {
        id: 't1',
        ownerId: 'u1',
        eventId: 'e1',
        title: 'Evento',
        tab: 'eventos',
        themeColor: null,
        attendeeCount: 1,
        event: {
          id: 'e1',
          title: 'Evento',
          city: 'MX',
          venue: null,
          address: null,
          themeColor: null,
          provider: null,
          interests: [{ interest: { slug: 'music' } }],
          smokingAllowed: false,
          petFriendly: false,
          parkingAvailable: false,
          minAge: null,
        },
        createdAt: new Date(),
      },
    ]);

    const service = new MeService(prisma, {} as any, {} as any, {} as any);
    const res = await service.listTickets('u1', { email: 'a@b.com' });
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ id: 't1', attendeeCount: 1 });
  });

  it('createTicket validates input and creates holders', async () => {
    const prisma = makePrisma();
    const service = new MeService(prisma, {} as any, {} as any, {} as any);

    prisma.event.findUnique.mockResolvedValueOnce(null);
    await expect(service.createTicket('u1', 'e1', 1)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    prisma.event.findUnique.mockResolvedValueOnce({ id: 'e1', title: 'T', themeColor: '#1' });
    await expect(
      service.createTicket('u1', 'e1', 1, { holders: [{ email: 'a@b.com' }, { email: 'b@b.com' }] }),
    ).rejects.toBeInstanceOf(BadRequestException);

    prisma.event.findUnique.mockResolvedValueOnce({ id: 'e1', title: 'T', themeColor: '#1' });
    await expect(
      service.createTicket('u1', 'e1', 2, { email: 'me@x.com', holders: [{ name: 'Ana' }] }),
    ).rejects.toBeInstanceOf(BadRequestException);

    prisma.event.findUnique.mockResolvedValueOnce({ id: 'e1', title: 'T', themeColor: '#1' });
    prisma.$queryRaw
      .mockResolvedValueOnce([]) // assertNoDuplicate #1
      .mockResolvedValueOnce([]) // assertNoDuplicate #2
      .mockResolvedValueOnce([{ id: 't1' }, { id: 't2' }]); // created ticket ids

    const res = await service.createTicket('u1', 'e1', 2, {
      name: 'Yo',
      email: 'me@x.com',
      holders: [{ email: 'me@x.com' }, { email: 'b@b.com', name: 'B' }],
    });
    expect(res.createdCount).toBe(2);
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it('getTicketDetails enforces ownership/assignment and returns refundPolicy', async () => {
    const prisma = makePrisma();
    const service = new MeService(prisma, {} as any, {} as any, {} as any);

    prisma.ticket.findUnique.mockResolvedValueOnce(null);
    await expect(service.getTicketDetails('u1', 't1', 'a@b.com')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    prisma.ticket.findUnique.mockResolvedValueOnce({
      id: 't1',
      ownerId: 'u2',
      eventId: 'e1',
      title: 'T',
      tab: 'eventos',
      themeColor: null,
      attendeeCount: 1,
      event: {
        id: 'e1',
        title: 'E',
        city: null,
        venue: null,
        address: null,
        themeColor: null,
        providerId: 'p1',
        provider: null,
        interests: [],
        smokingAllowed: false,
        petFriendly: false,
        parkingAvailable: false,
        minAge: null,
        startsAt: null,
      },
    });
    // Forbidden path returns before refund policy is queried.
    prisma.$queryRaw.mockResolvedValueOnce([
      { holder_name: 'Ana', holder_email: 'a@b.com', holder_user_id: null },
    ]);

    await expect(service.getTicketDetails('u1', 't1', 'no@x.com')).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    prisma.ticket.findUnique.mockResolvedValueOnce({
      id: 't1',
      ownerId: 'u2',
      eventId: 'e1',
      title: 'T',
      tab: 'eventos',
      themeColor: null,
      attendeeCount: 1,
      event: {
        id: 'e1',
        title: 'E',
        city: null,
        venue: null,
        address: null,
        themeColor: null,
        providerId: 'p1',
        provider: null,
        interests: [],
        smokingAllowed: false,
        petFriendly: false,
        parkingAvailable: false,
        minAge: null,
        startsAt: null,
      },
    });
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { holder_name: 'Ana', holder_email: 'a@b.com', holder_user_id: null },
      ])
      .mockResolvedValueOnce([{ refund_enabled: false, refund_deadline_hours: 24 }]);
    const res = await service.getTicketDetails('u1', 't1', 'a@b.com');
    expect(res.refundPolicy.eligible).toBe(false);
    expect(res.qrPayload).toContain('ticketId');
  });

  it('cancelTicket enforces owner and deletes', async () => {
    const prisma = makePrisma();
    const service = new MeService(prisma, {} as any, {} as any, {} as any);

    prisma.ticket.findUnique.mockResolvedValueOnce(null);
    await expect(service.cancelTicket('u1', 't1')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    prisma.ticket.findUnique.mockResolvedValueOnce({ id: 't1', ownerId: 'u2', event: null });
    await expect(service.cancelTicket('u1', 't1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    prisma.ticket.findUnique.mockResolvedValueOnce({
      id: 't1',
      ownerId: 'u1',
      event: { providerId: null, startsAt: null },
    });
    const res = await service.cancelTicket('u1', 't1');
    expect(res.cancelled).toBe(true);
    expect(prisma.ticket.delete).toHaveBeenCalled();
  });

  it('listConversations computes unread based on last_read_at', async () => {
    const prisma = makePrisma();
    const conversationsService: any = {
      ensureConversationReadsTable: jest.fn(async () => undefined),
    };
    prisma.conversationMember.findMany.mockResolvedValueOnce([
      {
        conversation: {
          id: 'c1',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          members: [
            { userId: 'u1', profile: { userId: 'u1' } },
            {
              userId: 'u2',
              profile: {
                userId: 'u2',
                fullName: 'Ana',
                username: null,
                avatarUrl: null,
                avatarColor: null,
                location: null,
              },
            },
          ],
          messages: [
            {
              body: JSON.stringify({ type: 'event_invite', text: 'inv', eventTitle: 'E' }),
              senderId: 'u2',
              createdAt: new Date('2026-02-01T00:00:00.000Z'),
            },
          ],
        },
      },
    ]);
    prisma.$queryRaw.mockResolvedValueOnce([{ last_read_at: new Date('2026-01-01T00:00:00.000Z') }]);

    const service = new MeService(prisma, conversationsService, {} as any, {} as any);
    const res = await service.listConversations('u1');
    expect(res[0]).toMatchObject({ id: 'c1', unread: true, tabs: ['eventos'] });
  });

  it('listNotifications groups today and previous', async () => {
    const prisma = makePrisma();
    prisma.notification.findMany.mockResolvedValueOnce([
      {
        id: 'n1',
        userId: 'u1',
        categoryLabel: 'x',
        title: 't',
        description: null,
        relevantTabs: ['eventos'],
        createdAt: new Date(),
      },
      {
        id: 'n2',
        userId: 'u1',
        categoryLabel: null,
        title: 'old',
        description: 'd',
        relevantTabs: [],
        createdAt: new Date('2020-01-01T00:00:00.000Z'),
      },
    ]);

    const service = new MeService(prisma, {} as any, {} as any, {} as any);
    const res = await service.listNotifications('u1');
    expect(res).toHaveLength(2);
    expect(res[0]?.groupLabel).toBe('Hoy');
    expect(res[1]?.groupLabel).toBe('Previamente');
  });

  it('shareTicketWithUser assigns holder and sends message + notification', async () => {
    const prisma = makePrisma();
    const conversationsService: any = {
      findOrCreateDirect: jest.fn().mockResolvedValue({ id: 'c1' }),
      sendMessage: jest.fn().mockResolvedValue({}),
      ensureConversationReadsTable: jest.fn(),
    };
    const supabaseAdmin: any = {
      db: {
        auth: {
          admin: {
            getUserById: jest.fn().mockResolvedValue({
              data: { user: { email: 'peer@x.com', user_metadata: { name: 'Peer' } } },
            }),
          },
        },
      },
    };
    prisma.ticket.findUnique.mockResolvedValueOnce({
      id: 't1',
      ownerId: 'u1',
      eventId: 'e1',
      title: 'T',
      event: { title: 'E', startsAt: new Date('2026-01-01T00:00:00.000Z') },
    });
    prisma.$queryRaw.mockResolvedValueOnce([]); // no duplicate

    const service = new MeService(prisma, conversationsService, {} as any, supabaseAdmin);
    const res = await service.shareTicketWithUser('u1', {
      ticketId: 't1',
      peerUserId: 'u2',
    });
    expect(res).toEqual({ sent: true, conversationId: 'c1' });
    // Notification insert uses raw SQL.
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it('inviteTicketRecipient validates email and sends mail (Allons user path)', async () => {
    const prisma = makePrisma();
    const conversationsService: any = {
      findOrCreateDirect: jest.fn().mockResolvedValue({ id: 'c1' }),
      sendMessage: jest.fn().mockResolvedValue({}),
      ensureConversationReadsTable: jest.fn(),
    };
    const mailService: any = {
      sendTicketInvitation: jest.fn().mockResolvedValue({ delivered: true }),
    };
    const supabaseAdmin: any = {
      db: {
        auth: {
          admin: {
            listUsers: jest.fn().mockResolvedValue({
              data: { users: [{ id: 'u2', email: 'peer@x.com' }] },
            }),
          },
        },
      },
    };
    prisma.ticket.findUnique
      .mockResolvedValueOnce({
      id: 't1',
      ownerId: 'u1',
      eventId: 'e1',
      title: 'T',
      event: { title: 'E', startsAt: null },
      })
      // second call in same test
      .mockResolvedValueOnce({
        id: 't1',
        ownerId: 'u1',
        eventId: 'e1',
        title: 'T',
        event: { title: 'E', startsAt: null },
      });
    prisma.$queryRaw.mockResolvedValueOnce([]);

    const service = new MeService(prisma, conversationsService, mailService, supabaseAdmin);
    await expect(
      service.inviteTicketRecipient('u1', { ticketId: 't1', email: 'bad', inviterName: 'X' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const res = await service.inviteTicketRecipient('u1', {
      ticketId: 't1',
      email: 'peer@x.com',
      inviterName: 'X',
    });
    expect(res.sent).toBe(true);
    expect(res.isAllonsUser).toBe(true);
    expect(mailService.sendTicketInvitation).toHaveBeenCalled();
  });

  it('acceptTicketInvitation enforces holder and updates accepted_at', async () => {
    const prisma = makePrisma();
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        ticket_id: 't1',
        owner_id: 'u2',
        event_title: 'E',
        holder_email: 'peer@x.com',
        holder_user_id: null,
        accepted_at: null,
      },
    ]);

    const service = new MeService(prisma, {} as any, {} as any, {} as any);

    await expect(
      service.acceptTicketInvitation('u1', 'no@x.com', 't1'),
    ).rejects.toBeInstanceOf(BadRequestException);

    prisma.$queryRaw.mockResolvedValueOnce([
      {
        ticket_id: 't1',
        owner_id: 'u2',
        event_title: 'E',
        holder_email: 'peer@x.com',
        holder_user_id: null,
        accepted_at: null,
      },
    ]);
    const res = await service.acceptTicketInvitation('u1', 'peer@x.com', 't1');
    expect(res.accepted).toBe(true);
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it('listEventHistory maps tickets with events', async () => {
    const prisma = makePrisma();
    prisma.ticket.findMany.mockResolvedValueOnce([
      {
        id: 't1',
        themeColor: null,
        event: { id: 'e1', title: 'E1', themeColor: null },
      },
      { id: 't2', themeColor: null, event: null },
    ]);
    const service = new MeService(prisma, {} as any, {} as any, {} as any);
    const res = await service.listEventHistory('u1');
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ id: 'e1', title: 'E1' });
  });
});
