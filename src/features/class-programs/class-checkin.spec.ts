import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { FeatureFlagsService } from '../../shared/feature-flags.service';
import type { ObservabilityService } from '../../shared/observability/observability.service';
import type { PaygateService } from '../paygate/paygate.service';
import type { PaymentOrdersRepository } from '../payments/payment-orders.repository';
import type { ProvidersService } from '../providers/providers.service';
import type { ClassProgramsRepository } from './class-programs.repository';
import { ClassProgramsService } from './class-programs.service';
import { buildClassQrPayload } from './class-qr.utils';
import { buildTicketQrPayload } from '../providers/ticket-qr.utils';

const SECRET = 'scan-secret';
const PROVIDER = '11111111-1111-4111-8111-111111111111';
const RESERVATION = '22222222-2222-4222-8222-222222222222';
const PROGRAM = '33333333-3333-4333-8333-333333333333';
const STAFF = 'staff-1';

function makeService(secret: string | null = SECRET) {
  const repository = {
    getCivilToday: jest.fn().mockResolvedValue('2026-08-07'),
    checkInReservation: jest.fn().mockResolvedValue({
      status: 'valid',
      reservationId: RESERVATION,
      programId: PROGRAM,
      programTitle: 'Barre Intensivo',
      date: '2026-08-07',
      startTime: '07:00',
      code: 'CLS-AB23CD',
      holderName: 'Marlon',
      checkedInAt: '2026-08-07T13:00:00.000Z',
    }),
  };
  const providers = {
    requireMembership: jest
      .fn()
      .mockResolvedValue({ providerId: PROVIDER, role: 'staff_scanner' }),
  } as unknown as jest.Mocked<ProvidersService>;
  const config = { get: jest.fn().mockReturnValue(secret ?? undefined) };
  const service = new ClassProgramsService(
    repository as unknown as ClassProgramsRepository,
    providers,
    {} as unknown as PaygateService,
    {} as unknown as PaymentOrdersRepository,
    {} as unknown as FeatureFlagsService,
    {} as unknown as ObservabilityService,
    config as unknown as ConfigService,
  );
  return { service, repository, providers };
}

describe('ClassProgramsService.checkInClassReservation', () => {
  it('lets a door scanner check in, not just owners', async () => {
    // `staff_scanner` exists for exactly this; requiring owner/admin would mean
    // handing the owner's login to whoever works the door.
    const { service, providers } = makeService();

    await service.checkInClassReservation(STAFF, {
      code: buildClassQrPayload(RESERVATION, PROGRAM, SECRET),
    });

    expect(providers.requireMembership).toHaveBeenCalledWith(STAFF, [
      'owner',
      'admin',
      'staff_scanner',
    ]);
  });

  it('reports a signed QR as verified and resolves it by id', async () => {
    const { service, repository } = makeService();

    const result = await service.checkInClassReservation(STAFF, {
      code: buildClassQrPayload(RESERVATION, PROGRAM, SECRET),
    });

    expect(result).toMatchObject({ status: 'valid', verified: true });
    expect(repository.checkInReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: PROVIDER,
        staffUserId: STAFF,
        reservationId: RESERVATION,
        code: null,
        today: '2026-08-07',
      }),
    );
  });

  it('accepts a typed CLS code, unverified, and looks it up by code', async () => {
    const { service, repository } = makeService();

    const result = await service.checkInClassReservation(STAFF, {
      code: 'cls ab23cd',
    });

    expect(result).toMatchObject({ verified: false });
    expect(repository.checkInReservation).toHaveBeenCalledWith(
      expect.objectContaining({ reservationId: null, code: 'CLS-AB23CD' }),
    );
  });

  it('scopes the lookup to the scanning comercio', async () => {
    // The repository query filters on provider_id, so a code from another
    // comercio cannot be checked in — or even confirmed to exist.
    const { service, repository } = makeService();

    await service.checkInClassReservation(STAFF, { code: RESERVATION });

    expect(repository.checkInReservation).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: PROVIDER }),
    );
  });

  it('refuses an event-ticket QR', async () => {
    // The whole reason the payload shapes are disjoint: a ticket for tonight's
    // concert must not open the door to a class.
    const { service, repository } = makeService();

    const result = await service.checkInClassReservation(STAFF, {
      code: buildTicketQrPayload(RESERVATION, PROGRAM, SECRET),
    });

    expect(result).toEqual({ status: 'invalid', verified: false });
    expect(repository.checkInReservation).not.toHaveBeenCalled();
  });

  it('rejects a QR signed with the wrong secret without touching the database', async () => {
    const { service, repository } = makeService();

    const result = await service.checkInClassReservation(STAFF, {
      code: buildClassQrPayload(RESERVATION, PROGRAM, 'not-the-secret'),
    });

    expect(result).toEqual({ status: 'invalid', verified: false });
    expect(repository.checkInReservation).not.toHaveBeenCalled();
  });

  it('returns invalid, not an error, for unrecognizable input', async () => {
    // The operator should see a rejection on the scanner, not a crash screen.
    const { service, repository } = makeService();

    const result = await service.checkInClassReservation(STAFF, {
      code: 'garbage',
    });

    expect(result).toEqual({ status: 'invalid', verified: false });
    expect(repository.checkInReservation).not.toHaveBeenCalled();
  });

  it('requires a code', async () => {
    const { service } = makeService();

    await expect(
      service.checkInClassReservation(STAFF, { code: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('treats a signed QR as unverified when the server has no secret', async () => {
    const { service } = makeService(null);

    const result = await service.checkInClassReservation(STAFF, {
      code: buildClassQrPayload(RESERVATION, PROGRAM, SECRET),
    });

    expect(result).toMatchObject({ status: 'valid', verified: false });
  });

  it('passes the comercio-local civil date through', async () => {
    // A class is admissible on its own day, and "today" has to be Honduras'
    // date rather than the server's UTC one.
    const { service, repository } = makeService();

    await service.checkInClassReservation(STAFF, { code: RESERVATION });

    expect(repository.getCivilToday).toHaveBeenCalled();
    expect(repository.checkInReservation).toHaveBeenCalledWith(
      expect.objectContaining({ today: '2026-08-07' }),
    );
  });

  it.each(['duplicate', 'cancelled', 'wrong_day', 'invalid'] as const)(
    'passes a %s verdict through to the scanner',
    async (status) => {
      const { service, repository } = makeService();
      repository.checkInReservation.mockResolvedValueOnce({ status });

      const result = await service.checkInClassReservation(STAFF, {
        code: RESERVATION,
      });

      expect(result).toMatchObject({ status });
    },
  );
});
