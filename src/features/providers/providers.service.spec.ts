import { ProvidersService } from './providers.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';
import type { ConfigService } from '@nestjs/config';
import type { NotificationsService } from '../notifications/notifications.service';
import type { SubscriptionService } from '../subscription/subscription.service';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const TICKET_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_EVENT_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const PROVIDER_ID = '55555555-5555-4555-8555-555555555555';

function makePrisma() {
  const prisma: any = {
    $executeRaw: jest.fn(() => Promise.resolve(1)),
    $queryRaw: jest.fn(() => Promise.resolve([])),
    event: {
      findFirst: jest.fn(),
    },
    provider: { findUnique: jest.fn() },
    profile: { findUnique: jest.fn() },
  };
  prisma.$transaction = jest.fn((cb: (tx: typeof prisma) => unknown) =>
    Promise.resolve(cb(prisma)),
  );
  return prisma as unknown as PrismaService;
}

function makeService(prisma: PrismaService) {
  const service = new ProvidersService(
    prisma,
    {} as unknown as SupabaseAdminService,
    { get: jest.fn(() => null) } as unknown as ConfigService,
    {} as unknown as NotificationsService,
    {} as unknown as SubscriptionService,
  );
  (service as unknown as { infraReady: boolean }).infraReady = true;
  jest.spyOn(service, 'requireMembership').mockResolvedValue({
    providerId: PROVIDER_ID,
    role: 'staff_scanner',
  });
  return service;
}

const ticketRow = {
  id: TICKET_ID,
  title: 'Entrada VIP',
  attendee_count: 2,
  cancelled_at: null as Date | null,
  event_id: EVENT_ID,
  event_title: 'Fiesta X',
  holder_name: 'María López',
  ticket_type: 'VIP',
};

describe('ProvidersService scan preview/confirm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('previewScan returns ready without writing scan records', async () => {
    const prisma = makePrisma();
    prisma.event.findFirst.mockResolvedValueOnce({
      id: EVENT_ID,
      title: 'Fiesta X',
    });
    prisma.$queryRaw
      .mockResolvedValueOnce([ticketRow])
      .mockResolvedValueOnce([]);

    const service = makeService(prisma);
    const result = await service.previewScan(USER_ID, {
      eventId: EVENT_ID,
      ticketCode: TICKET_ID,
    });

    expect(result.status).toBe('ready');
    expect(result.attendeeName).toBe('María López');
    expect(result.ticketType).toBe('VIP');
    expect(result.ticketTitle).toBe('Entrada VIP');
    expect(result.attendeeCount).toBe(2);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('previewScan returns duplicate with previousScan', async () => {
    const prisma = makePrisma();
    prisma.event.findFirst.mockResolvedValueOnce({
      id: EVENT_ID,
      title: 'Fiesta X',
    });
    const scannedAt = new Date('2026-06-17T20:00:00.000Z');
    prisma.$queryRaw
      .mockResolvedValueOnce([ticketRow])
      .mockResolvedValueOnce([
        {
          scanned_at: scannedAt,
          status: 'valid',
          scanned_by_name: 'Juan',
        },
      ]);

    const service = makeService(prisma);
    const result = await service.previewScan(USER_ID, {
      eventId: EVENT_ID,
      ticketCode: TICKET_ID,
    });

    expect(result.status).toBe('duplicate');
    expect(result.previousScan).toEqual({
      scannedAt: scannedAt.toISOString(),
      scannedByName: 'Juan',
      status: 'valid',
    });
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('previewScan returns wrong_event when QR event mismatches', async () => {
    const prisma = makePrisma();
    prisma.event.findFirst.mockResolvedValueOnce({
      id: EVENT_ID,
      title: 'Fiesta X',
    });
    prisma.$queryRaw.mockResolvedValueOnce([
      { ...ticketRow, event_id: OTHER_EVENT_ID, event_title: 'Otro evento' },
    ]);

    const service = makeService(prisma);
    const qrPayload = JSON.stringify({
      t: TICKET_ID,
      e: OTHER_EVENT_ID,
      ts: 1_700_000_000,
    });
    const result = await service.previewScan(USER_ID, {
      eventId: EVENT_ID,
      ticketCode: qrPayload,
    });

    expect(result.status).toBe('wrong_event');
    expect(result.eventTitle).toBe('Otro evento');
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('previewScan returns cancelled for soft-deleted tickets', async () => {
    const prisma = makePrisma();
    prisma.event.findFirst.mockResolvedValueOnce({
      id: EVENT_ID,
      title: 'Fiesta X',
    });
    prisma.$queryRaw.mockResolvedValueOnce([
      { ...ticketRow, cancelled_at: new Date() },
    ]);

    const service = makeService(prisma);
    const result = await service.previewScan(USER_ID, {
      eventId: EVENT_ID,
      ticketCode: TICKET_ID,
    });

    expect(result.status).toBe('cancelled');
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('previewScan returns invalid for unrecognized codes', async () => {
    const prisma = makePrisma();
    prisma.event.findFirst.mockResolvedValueOnce({
      id: EVENT_ID,
      title: 'Fiesta X',
    });

    const service = makeService(prisma);
    const result = await service.previewScan(USER_ID, {
      eventId: EVENT_ID,
      ticketCode: 'not-a-valid-code',
    });

    expect(result.status).toBe('invalid');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('confirmScan inserts a valid scan record', async () => {
    const prisma = makePrisma();
    prisma.event.findFirst.mockResolvedValueOnce({
      id: EVENT_ID,
      title: 'Fiesta X',
    });
    prisma.$queryRaw
      .mockResolvedValueOnce([ticketRow])
      .mockResolvedValueOnce([{ id: TICKET_ID, cancelled_at: null }])
      .mockResolvedValueOnce([{ total: 0 }]);

    const service = makeService(prisma);
    const result = await service.confirmScan(USER_ID, {
      eventId: EVENT_ID,
      ticketId: TICKET_ID,
    });

    expect(result.status).toBe('valid');
    expect(result.ticketType).toBe('VIP');
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it('confirmScan returns duplicate when ticket was already checked in', async () => {
    const prisma = makePrisma();
    prisma.event.findFirst.mockResolvedValueOnce({
      id: EVENT_ID,
      title: 'Fiesta X',
    });
    const scannedAt = new Date('2026-06-17T20:00:00.000Z');
    prisma.$queryRaw
      .mockResolvedValueOnce([ticketRow])
      .mockResolvedValueOnce([{ id: TICKET_ID, cancelled_at: null }])
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([
        {
          scanned_at: scannedAt,
          status: 'valid',
          scanned_by_name: 'Juan',
        },
      ]);

    const service = makeService(prisma);
    const result = await service.confirmScan(USER_ID, {
      eventId: EVENT_ID,
      ticketId: TICKET_ID,
    });

    expect(result.status).toBe('duplicate');
    expect(result.previousScan?.scannedByName).toBe('Juan');
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });
});
