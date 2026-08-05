import { Prisma } from '../../../generated/prisma';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { FeatureFlagsService } from '../../shared/feature-flags.service';
import type { ObservabilityService } from '../../shared/observability/observability.service';
import type { PaygateService } from '../paygate/paygate.service';
import type { PaymentOrdersRepository } from '../payments/payment-orders.repository';
import { ProvidersService } from '../providers/providers.service';
import { ClassProgramsRepository } from './class-programs.repository';
import { ClassProgramsService } from './class-programs.service';

type RepositoryMock = {
  createProgramWithChildren: jest.Mock;
  createSessionTemplate: jest.Mock;
  createPackage: jest.Mock;
  getProgramsByProvider: jest.Mock;
  getProgram: jest.Mock;
  findProviderProgramId: jest.Mock;
  getTemplates: jest.Mock;
  getPackages: jest.Mock;
  getReservationCounts: jest.Mock;
  getActivePackageForPayment: jest.Mock;
  createReservation: jest.Mock;
  listUserClassPasses: jest.Mock;
  cancelReservation: jest.Mock;
  getCivilToday: jest.Mock;
  getUserReservedOccurrences: jest.Mock;
  updateProgram: jest.Mock;
  findProviderProgramIdForTemplate: jest.Mock;
  updateTemplate: jest.Mock;
  deactivateTemplate: jest.Mock;
  findProviderProgramIdForPackage: jest.Mock;
  updatePackage: jest.Mock;
  deactivatePackage: jest.Mock;
  getProgramMetrics: jest.Mock;
  listPublishedPrograms: jest.Mock;
  listUserReservations: jest.Mock;
  findFreeClaimForPackage: jest.Mock;
  createFreeClassPass: jest.Mock;
};

function makeService() {
  const repository = {
    createProgramWithChildren: jest.fn(),
    createSessionTemplate: jest.fn(),
    createPackage: jest.fn(),
    getProgramsByProvider: jest.fn(),
    getProgram: jest.fn(),
    findProviderProgramId: jest.fn(),
    getTemplates: jest.fn().mockResolvedValue([]),
    getPackages: jest.fn().mockResolvedValue([]),
    listPublishedPrograms: jest.fn().mockResolvedValue([]),
    listUserReservations: jest.fn().mockResolvedValue([]),
    findFreeClaimForPackage: jest.fn().mockResolvedValue(null),
    createFreeClassPass: jest.fn().mockResolvedValue({ id: 'pass-1' }),
    getReservationCounts: jest.fn(),
    getActivePackageForPayment: jest.fn(),
    createReservation: jest.fn(),
    listUserClassPasses: jest.fn().mockResolvedValue([]),
    cancelReservation: jest.fn(),
    // Fixed far from any test's `from` date, so labels default to the
    // weekday name unless a test deliberately aligns them for "Hoy"/"Mañana".
    getCivilToday: jest.fn().mockResolvedValue('2020-01-01'),
    getUserReservedOccurrences: jest.fn().mockResolvedValue([]),
    updateProgram: jest.fn(),
    findProviderProgramIdForTemplate: jest.fn(),
    updateTemplate: jest.fn(),
    deactivateTemplate: jest.fn(),
    findProviderProgramIdForPackage: jest.fn(),
    updatePackage: jest.fn(),
    deactivatePackage: jest.fn(),
    getProgramMetrics: jest.fn().mockResolvedValue([]),
  } satisfies RepositoryMock;
  const providers = {
    requireMembership: jest.fn().mockResolvedValue({
      providerId: '11111111-1111-1111-1111-111111111111',
      role: 'owner',
    }),
  } as unknown as jest.Mocked<ProvidersService>;
  const paygate = {
    createPaymentLink: jest.fn().mockResolvedValue({
      id: 'pg-link-1',
      link: 'https://stage.paygate.biz/checkout/pg-link-1',
      expirationHours: 2,
      currency: 'HNL',
    }),
  };
  const orders = {
    countRecentPendingForUser: jest.fn().mockResolvedValue(0),
    create: jest.fn().mockImplementation((input) => ({
      id: 'order-1',
      status: 'pending_payment',
      ...input,
    })),
  };
  const flags = { paymentsEnabled: true, forceFreeEvents: false };
  const obs = { event: jest.fn(), warn: jest.fn() };
  return {
    service: new ClassProgramsService(
      repository as unknown as ClassProgramsRepository,
      providers,
      paygate as unknown as PaygateService,
      orders as unknown as PaymentOrdersRepository,
      flags as unknown as FeatureFlagsService,
      obs as unknown as ObservabilityService,
    ),
    repository,
    providers,
    paygate,
    orders,
    flags,
  };
}

const programRow = {
  id: '22222222-2222-2222-2222-222222222222',
  provider_id: '11111111-1111-1111-1111-111111111111',
  title: 'Erei Crossfit',
  description: null,
  discipline: 'Crossfit',
  instructor_name: 'Francisco Guillen',
  duration_minutes: 60,
  capacity_per_session: 8,
  location_name: null,
  address: null,
  city: null,
  latitude: null,
  longitude: null,
  cover_image_url: null,
  theme_color: null,
  status: 'published' as const,
  created_at: new Date('2026-08-01T00:00:00.000Z'),
  updated_at: new Date('2026-08-01T00:00:00.000Z'),
};

describe('ClassProgramsService', () => {
  it('rejects creating a program without required basics', async () => {
    const { service } = makeService();

    await expect(
      service.createProviderProgram('user-1', {
        durationMinutes: 60,
        capacityPerSession: 10,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects fractional positive integer fields before hitting the DB', async () => {
    const { service, repository } = makeService();

    await expect(
      service.createProviderProgram('user-1', {
        title: 'Erei Crossfit',
        durationMinutes: 0.5,
        capacityPerSession: 10,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.createProgramWithChildren).not.toHaveBeenCalled();
  });

  it('rejects an unlimited package without validityDays', async () => {
    const { service } = makeService();

    await expect(
      service.createProviderProgram('user-1', {
        title: 'Erei Crossfit',
        durationMinutes: 60,
        capacityPerSession: 10,
        packages: [{ name: 'Ilimitado', kind: 'unlimited', price: 1200 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns myBalance: null for a guest, without querying passes', async () => {
    const { service, repository } = makeService();
    repository.getProgram.mockResolvedValueOnce(programRow);

    const result = await service.getPublicProgram(programRow.id);

    expect(result).toMatchObject({ myBalance: null });
    expect(repository.listUserClassPasses).not.toHaveBeenCalled();
  });

  it("embeds the caller's mapped balance for this program when authenticated", async () => {
    const { service, repository } = makeService();
    repository.getProgram.mockResolvedValueOnce(programRow);
    repository.listUserClassPasses.mockResolvedValueOnce([
      {
        id: 'pass-1',
        provider_id: programRow.provider_id,
        program_id: programRow.id,
        program_title: programRow.title,
        package_id: 'pkg-1',
        package_name: 'Pack 8 clases',
        package_kind: 'pack',
        credits_total: 8,
        credits_remaining: 5,
        valid_from: new Date('2026-07-01T00:00:00.000Z'),
        expires_at: new Date('2026-09-04T00:00:00.000Z'),
        status: 'active',
      },
    ]);

    const result = await service.getPublicProgram(programRow.id, {
      userId: 'user-1',
    });

    expect(result).toMatchObject({
      myBalance: {
        id: 'pass-1',
        programId: programRow.id,
        creditsRemaining: 5,
      },
    });
  });

  it("attaches each program's own metrics on the provider listing", async () => {
    const { service, repository } = makeService();
    const otherProgram = { ...programRow, id: 'other-program-id' };
    repository.getProgramsByProvider.mockResolvedValueOnce([
      programRow,
      otherProgram,
    ]);
    repository.getProgramMetrics.mockResolvedValueOnce([
      {
        program_id: programRow.id,
        sold_sessions: 12,
        upcoming_reservations: 3,
        avg_occupancy: 0.75,
        revenue_cents: 280000n,
      },
      // otherProgram deliberately omitted — must default to zeroed metrics,
      // not be dropped from the result or throw.
    ]);

    const [withMetrics, otherWithMetrics] =
      await service.listProviderPrograms('user-1');

    expect(repository.getProgramMetrics).toHaveBeenCalledWith([
      programRow.id,
      'other-program-id',
    ]);
    expect(withMetrics.metrics).toEqual({
      soldSessions: 12,
      upcomingReservations: 3,
      avgOccupancy: 0.75,
      revenueCents: 280000,
    });
    expect(otherWithMetrics.metrics).toEqual({
      soldSessions: 0,
      upcomingReservations: 0,
      avgOccupancy: null,
      revenueCents: 0,
    });
  });

  it('requests only published programs on public provider listings', async () => {
    const { service, repository } = makeService();
    repository.getProgramsByProvider.mockResolvedValueOnce([programRow]);

    await service.listPublicPrograms(programRow.provider_id);

    expect(repository.getProgramsByProvider).toHaveBeenCalledWith(
      programRow.provider_id,
      { publicOnly: true },
    );
  });

  it('enforces provider ownership before creating packages', async () => {
    const { service, repository, providers } = makeService();
    repository.findProviderProgramId.mockResolvedValueOnce(null);

    await expect(
      service.createPackage('user-1', programRow.id, {
        name: '8 sesiones',
        kind: 'pack',
        credits: 8,
        price: 1600,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(providers.requireMembership).toHaveBeenCalledWith('user-1', [
      'owner',
      'admin',
    ]);
    expect(repository.createPackage).not.toHaveBeenCalled();
  });

  it("rejects updating a template that isn't owned by the caller's provider", async () => {
    const { service, repository } = makeService();
    repository.findProviderProgramIdForTemplate.mockResolvedValueOnce(null);

    await expect(
      service.updateSessionTemplate('user-1', 'someone-elses-template', {
        capacity: 10,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.updateTemplate).not.toHaveBeenCalled();
  });

  it("rejects deactivating a package that isn't owned by the caller's provider", async () => {
    const { service, repository } = makeService();
    repository.findProviderProgramIdForPackage.mockResolvedValueOnce(null);

    await expect(
      service.deactivatePackage('user-1', 'someone-elses-package'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.deactivatePackage).not.toHaveBeenCalled();
  });

  it('rejects normalized invalid calendar dates', async () => {
    const { service, repository } = makeService();
    repository.getProgram.mockResolvedValueOnce(programRow);

    await expect(
      service.getAvailability(programRow.id, { from: '2026-02-31', days: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('computes availability from templates and active reservations', async () => {
    const { service, repository } = makeService();
    repository.getProgram.mockResolvedValueOnce(programRow);
    repository.getTemplates.mockResolvedValueOnce([
      {
        id: '33333333-3333-3333-3333-333333333333',
        program_id: programRow.id,
        weekday: 2,
        start_time: '09:00',
        duration_minutes: null,
        capacity: 6,
        instructor_name: null,
        active: true,
      },
    ]);
    repository.getReservationCounts.mockResolvedValueOnce([
      {
        session_date: '2026-08-04',
        start_time: '09:00',
        reserved_count: 4,
      },
    ]);

    const result = await service.getAvailability(programRow.id, {
      from: '2026-08-04',
      days: 1,
    });

    expect(result).toEqual([
      {
        date: '2026-08-04',
        label: 'Martes',
        startTime: '09:00',
        durationMinutes: 60,
        instructorName: 'Francisco Guillen',
        capacity: 6,
        reservedCount: 4,
        availableSpots: 2,
        canReserve: true,
        alreadyReserved: false,
      },
    ]);
  });

  it('labels today and tomorrow relative to Honduras civil time, not the weekday', async () => {
    const { service, repository } = makeService();
    repository.getProgram.mockResolvedValue(programRow);
    // 2026-08-04 is a Tuesday (weekday 2), 2026-08-05 a Wednesday (weekday 3);
    // one template per day so the 2-day window returns both occurrences.
    repository.getTemplates.mockResolvedValue([
      {
        id: '33333333-3333-3333-3333-333333333333',
        program_id: programRow.id,
        weekday: 2,
        start_time: '09:00',
        duration_minutes: null,
        capacity: 6,
        instructor_name: null,
        active: true,
      },
      {
        id: '44444444-4444-4444-4444-444444444444',
        program_id: programRow.id,
        weekday: 3,
        start_time: '09:00',
        duration_minutes: null,
        capacity: 6,
        instructor_name: null,
        active: true,
      },
    ]);
    repository.getReservationCounts.mockResolvedValue([]);
    repository.getCivilToday.mockResolvedValue('2026-08-04');

    const result = await service.getAvailability(programRow.id, {
      from: '2026-08-04',
      days: 2,
    });

    expect(result.map((r: any) => r.label)).toEqual(['Hoy', 'Mañana']);
  });

  it('marks alreadyReserved only for occurrences the caller has booked', async () => {
    const { service, repository } = makeService();
    repository.getProgram.mockResolvedValue(programRow);
    repository.getTemplates.mockResolvedValue([
      {
        id: '33333333-3333-3333-3333-333333333333',
        program_id: programRow.id,
        weekday: 2,
        start_time: '09:00',
        duration_minutes: null,
        capacity: 6,
        instructor_name: null,
        active: true,
      },
    ]);
    repository.getReservationCounts.mockResolvedValue([]);
    repository.getUserReservedOccurrences.mockResolvedValue([
      { session_date: '2026-08-04', start_time: '09:00' },
    ]);

    const result = await service.getAvailability(programRow.id, {
      from: '2026-08-04',
      days: 1,
      userId: 'user-1',
    });

    expect(result[0]).toMatchObject({ alreadyReserved: true });
    expect(repository.getUserReservedOccurrences).toHaveBeenCalledWith(
      programRow.id,
      'user-1',
      '2026-08-04',
      '2026-08-04',
    );
  });

  it('anchors the default range to civil today, not the from param', async () => {
    // Regression test for the Codex-flagged bug: omitting `from` used to go
    // through parseDateParam's own JS-Date() default (UTC), which disagrees
    // with Honduras civil time for part of the day — the range would start a
    // day late and "Hoy" would never appear.
    const { service, repository } = makeService();
    repository.getProgram.mockResolvedValue(programRow);
    repository.getTemplates.mockResolvedValue([
      {
        id: '33333333-3333-3333-3333-333333333333',
        program_id: programRow.id,
        weekday: 2,
        start_time: '09:00',
        duration_minutes: null,
        capacity: 6,
        instructor_name: null,
        active: true,
      },
    ]);
    repository.getReservationCounts.mockResolvedValue([]);
    repository.getCivilToday.mockResolvedValue('2026-08-04');

    const result = await service.getAvailability(programRow.id, {
      days: 1,
    });

    expect(result[0]).toMatchObject({ date: '2026-08-04', label: 'Hoy' });
  });

  it('skips the reserved-occurrences lookup entirely for a guest', async () => {
    const { service, repository } = makeService();
    repository.getProgram.mockResolvedValue(programRow);
    repository.getTemplates.mockResolvedValue([]);
    repository.getReservationCounts.mockResolvedValue([]);

    await service.getAvailability(programRow.id, {
      from: '2026-08-04',
      days: 1,
      userId: null,
    });

    expect(repository.getUserReservedOccurrences).not.toHaveBeenCalled();
  });

  it('creates a Paygate order for an active published class package', async () => {
    const { service, repository, paygate, orders } = makeService();
    repository.getActivePackageForPayment.mockResolvedValueOnce({
      id: '44444444-4444-4444-4444-444444444444',
      program_id: programRow.id,
      provider_id: programRow.provider_id,
      program_title: programRow.title,
      program_status: 'published',
      name: '8 sesiones',
      price: 1600,
      credits: 8,
      validity_days: 30,
      kind: 'pack',
      active: true,
      sort_order: 0,
    });

    const result = await service.initiatePackagePayment(
      'user-1',
      '44444444-4444-4444-4444-444444444444',
    );

    expect(paygate.createPaymentLink).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1600, currency: 'HNL' }),
    );
    expect(orders.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        orderType: 'class_package',
        eventId: null,
        classProgramId: programRow.id,
        classPackageId: '44444444-4444-4444-4444-444444444444',
        quantity: 1,
        amountCents: 160000,
      }),
    );
    expect(result).toMatchObject({
      orderId: 'order-1',
      packageId: '44444444-4444-4444-4444-444444444444',
      programId: programRow.id,
    });
  });

  it('lists the caller class passes mapped to camelCase', async () => {
    const { service, repository } = makeService();
    repository.listUserClassPasses.mockResolvedValueOnce([
      {
        id: 'pass-1',
        provider_id: programRow.provider_id,
        program_id: programRow.id,
        program_title: programRow.title,
        package_id: 'pkg-1',
        package_name: 'Pack 8 clases',
        package_kind: 'pack',
        credits_total: 8,
        credits_remaining: 5,
        valid_from: new Date('2026-07-01T00:00:00.000Z'),
        expires_at: new Date('2026-09-04T00:00:00.000Z'),
        status: 'active',
      },
    ]);

    const result = await service.listMyClassPasses('user-1', {
      providerId: programRow.provider_id,
    });

    expect(repository.listUserClassPasses).toHaveBeenCalledWith('user-1', {
      providerId: programRow.provider_id,
      programId: null,
    });
    expect(result).toEqual([
      {
        id: 'pass-1',
        providerId: programRow.provider_id,
        programId: programRow.id,
        programTitle: programRow.title,
        packageId: 'pkg-1',
        packageName: 'Pack 8 clases',
        packageKind: 'pack',
        creditsTotal: 8,
        creditsRemaining: 5,
        validFrom: '2026-07-01T00:00:00.000Z',
        expiresAt: '2026-09-04T00:00:00.000Z',
        status: 'active',
      },
    ]);
  });

  it('returns an empty list when the caller has no usable passes', async () => {
    const { service, repository } = makeService();
    const result = await service.listMyClassPasses('user-1', {});
    expect(repository.listUserClassPasses).toHaveBeenCalledWith('user-1', {
      providerId: null,
      programId: null,
    });
    expect(result).toEqual([]);
  });

  it('rejects invalid class pass filters before hitting the DB', async () => {
    const { service, repository } = makeService();

    await expect(
      service.listMyClassPasses('user-1', { providerId: 'not-a-uuid' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.listUserClassPasses).not.toHaveBeenCalled();
  });

  it('creates a reservation from a valid class occurrence', async () => {
    const { service, repository } = makeService();
    repository.createReservation.mockResolvedValueOnce({
      ok: true,
      reservation: {
        id: '55555555-5555-5555-5555-555555555555',
        user_id: 'user-1',
        provider_id: programRow.provider_id,
        program_id: programRow.id,
        template_id: '33333333-3333-3333-3333-333333333333',
        pass_id: '66666666-6666-6666-6666-666666666666',
        session_date: '2026-08-04',
        start_time: '09:00',
        duration_minutes: 60,
        instructor_name: 'Francisco Guillen',
        status: 'reserved',
        created_at: new Date('2026-08-04T12:00:00.000Z'),
      },
    });

    const result = await service.createReservation('user-1', {
      programId: programRow.id,
      date: '2026-08-04',
      startTime: '09:00',
    });

    expect(repository.createReservation).toHaveBeenCalledWith('user-1', {
      programId: programRow.id,
      date: '2026-08-04',
      startTime: '09:00',
    });
    expect(result).toEqual({
      id: '55555555-5555-5555-5555-555555555555',
      programId: programRow.id,
      templateId: '33333333-3333-3333-3333-333333333333',
      passId: '66666666-6666-6666-6666-666666666666',
      date: '2026-08-04',
      startTime: '09:00',
      durationMinutes: 60,
      instructorName: 'Francisco Guillen',
      status: 'reserved',
      createdAt: '2026-08-04T12:00:00.000Z',
    });
  });

  it('rejects reservation when the user has no available pass', async () => {
    const { service, repository } = makeService();
    repository.createReservation.mockResolvedValueOnce({
      ok: false,
      reason: 'pass_not_found',
    });

    await expect(
      service.createReservation('user-1', {
        programId: programRow.id,
        date: '2026-08-04',
        startTime: '09:00',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects reservation payloads with invalid dates before hitting the DB', async () => {
    const { service, repository } = makeService();

    await expect(
      service.createReservation('user-1', {
        programId: programRow.id,
        date: '2026-02-31',
        startTime: '09:00',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.createReservation).not.toHaveBeenCalled();
  });

  it('uses reservation-specific validation messages', async () => {
    const { service, repository } = makeService();

    await expect(
      service.createReservation('user-1', {
        programId: programRow.id,
        date: '2026-02-31',
        startTime: '09:00',
      }),
    ).rejects.toMatchObject({ message: 'date inválido' });
    await expect(
      service.createReservation('user-1', {
        programId: programRow.id,
        date: '2026-08-04',
      }),
    ).rejects.toMatchObject({ message: 'startTime es requerido' });
    expect(repository.createReservation).not.toHaveBeenCalled();
  });

  it('cancels a reservation and reports whether the credit was refunded', async () => {
    const { service, repository } = makeService();
    repository.cancelReservation.mockResolvedValueOnce({
      ok: true,
      reservation: {
        id: '55555555-5555-5555-5555-555555555555',
        status: 'cancelled',
        cancelled_at: new Date('2026-08-04T12:00:00.000Z'),
      },
      refunded: true,
    });

    const result = await service.cancelReservation(
      'user-1',
      '55555555-5555-5555-5555-555555555555',
    );

    expect(repository.cancelReservation).toHaveBeenCalledWith(
      'user-1',
      '55555555-5555-5555-5555-555555555555',
    );
    expect(result).toEqual({
      id: '55555555-5555-5555-5555-555555555555',
      status: 'cancelled',
      cancelledAt: '2026-08-04T12:00:00.000Z',
      refunded: true,
    });
  });

  it('rejects a malformed reservationId before hitting the DB', async () => {
    const { service, repository } = makeService();

    await expect(
      service.cancelReservation('user-1', 'not-a-uuid'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.cancelReservation).not.toHaveBeenCalled();
  });

  it.each([
    ['not_found', NotFoundException],
    ['forbidden', ForbiddenException],
    ['already_cancelled', BadRequestException],
    ['occurrence_elapsed', BadRequestException],
  ] as const)(
    'maps cancellation failure reason "%s" to the right HTTP error',
    async (reason, expected) => {
      const { service, repository } = makeService();
      repository.cancelReservation.mockResolvedValueOnce({
        ok: false,
        reason,
      });

      await expect(
        service.cancelReservation(
          'user-1',
          '55555555-5555-5555-5555-555555555555',
        ),
      ).rejects.toBeInstanceOf(expected);
    },
  );
});

describe('ClassProgramsService.listDiscoveryPrograms', () => {
  function programRow(id: string, providerName: string) {
    return {
      id,
      provider_id: `provider-of-${id}`,
      provider_name: providerName,
      provider_handle: providerName.toLowerCase(),
      provider_logo_url: null,
      title: `Program ${id}`,
      description: null,
      discipline: null,
      instructor_name: null,
      duration_minutes: 60,
      capacity_per_session: 10,
      location_name: null,
      address: null,
      city: 'Tegucigalpa',
      latitude: null,
      longitude: null,
      cover_image_url: null,
      theme_color: null,
      status: 'published',
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
    };
  }

  it('forwards the city and limit options to the repository', async () => {
    const { service, repository } = makeService();

    await service.listDiscoveryPrograms({ cities: ['La Ceiba'], limit: 5 });

    expect(repository.listPublishedPrograms).toHaveBeenCalledWith({
      cities: ['La Ceiba'],
      limit: 5,
    });
  });

  it('attaches each program its own comercio', async () => {
    const { service, repository } = makeService();
    repository.listPublishedPrograms.mockResolvedValueOnce([
      programRow('a', 'Erei'),
      programRow('b', 'RAVA'),
    ]);

    const result = await service.listDiscoveryPrograms({
      cities: [],
      limit: 20,
    });

    expect(result.map((p) => [p.id, p.provider?.name])).toEqual([
      ['a', 'Erei'],
      ['b', 'RAVA'],
    ]);
  });

  // The provider used to be paired by array index, which silently mismatched
  // if withChildren ever reordered or dropped a row. Keying by program id
  // keeps each program with its own comercio regardless of ordering.
  it('keeps programs paired with their comercio even when children come back reordered', async () => {
    const { service, repository } = makeService();
    repository.listPublishedPrograms.mockResolvedValueOnce([
      programRow('a', 'Erei'),
      programRow('b', 'RAVA'),
    ]);
    // Packages arrive for the second program only, and out of order.
    repository.getPackages.mockResolvedValueOnce([
      {
        id: 'pkg-b',
        program_id: 'b',
        name: 'Pack',
        price: 100,
        credits: 4,
        validity_days: 30,
        kind: 'pack',
        active: true,
        sort_order: 0,
      },
    ]);

    const result = await service.listDiscoveryPrograms({
      cities: [],
      limit: 20,
    });

    const b = result.find((p) => p.id === 'b');
    expect(b?.provider?.name).toBe('RAVA');
    expect(b?.packages).toHaveLength(1);
    expect(result.find((p) => p.id === 'a')?.provider?.name).toBe('Erei');
  });
});

describe('ClassProgramsService.claimFreePackage', () => {
  function freePackage(overrides: Record<string, unknown> = {}) {
    return {
      id: 'pkg-free',
      program_id: 'program-1',
      provider_id: 'provider-1',
      program_title: 'Yoga Suave',
      program_status: 'published',
      name: 'Clase gratis',
      price: 0,
      credits: 1,
      validity_days: null,
      kind: 'drop_in',
      active: true,
      sort_order: 0,
      ...overrides,
    };
  }

  it('grants a pass for a zero-price package', async () => {
    const { service, repository } = makeService();
    repository.getActivePackageForPayment.mockResolvedValueOnce(freePackage());

    await service.claimFreePackage('user-1', 'pkg-free');

    expect(repository.createFreeClassPass).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        providerId: 'provider-1',
        programId: 'program-1',
        packageId: 'pkg-free',
        creditsTotal: 1,
        expiresAt: null,
      }),
    );
  });

  it('rejects a package that costs money, so it cannot bypass Paygate', async () => {
    const { service, repository } = makeService();
    repository.getActivePackageForPayment.mockResolvedValueOnce(
      freePackage({ price: 150 }),
    );

    await expect(
      service.claimFreePackage('user-1', 'pkg-free'),
    ).rejects.toMatchObject({
      message: 'Este paquete tiene precio; usa el flujo de pago',
    });
    expect(repository.createFreeClassPass).not.toHaveBeenCalled();
  });

  it('rejects a second claim of the same package', async () => {
    const { service, repository } = makeService();
    repository.getActivePackageForPayment.mockResolvedValueOnce(freePackage());
    repository.findFreeClaimForPackage.mockResolvedValueOnce({ id: 'pass-old' });

    await expect(
      service.claimFreePackage('user-1', 'pkg-free'),
    ).rejects.toMatchObject({
      message: 'Ya reclamaste este paquete gratis',
    });
    expect(repository.createFreeClassPass).not.toHaveBeenCalled();
  });

  it('throws when the package does not exist or is unpublished', async () => {
    const { service, repository } = makeService();
    repository.getActivePackageForPayment.mockResolvedValueOnce(null);

    await expect(
      service.claimFreePackage('user-1', 'nope'),
    ).rejects.toMatchObject({ message: 'Paquete no encontrado' });
  });

  it('stores no credit count for an unlimited pass and dates its expiry', async () => {
    const { service, repository } = makeService();
    repository.getActivePackageForPayment.mockResolvedValueOnce(
      freePackage({ kind: 'unlimited', credits: null, validity_days: 30 }),
    );

    await service.claimFreePackage('user-1', 'pkg-free');

    const arg = repository.createFreeClassPass.mock.calls[0][0];
    expect(arg.creditsTotal).toBeNull();
    expect(arg.expiresAt).toBeInstanceOf(Date);
  });

  it('returns the resulting balance for the program', async () => {
    const { service, repository } = makeService();
    repository.getActivePackageForPayment.mockResolvedValueOnce(freePackage());
    repository.listUserClassPasses.mockResolvedValueOnce([
      {
        id: 'pass-1',
        provider_id: 'provider-1',
        program_id: 'program-1',
        program_title: 'Yoga Suave',
        package_id: 'pkg-free',
        package_name: 'Clase gratis',
        package_kind: 'drop_in',
        credits_total: 1,
        credits_remaining: 1,
        valid_from: new Date('2026-01-01T00:00:00.000Z'),
        expires_at: null,
        status: 'active',
      },
    ]);

    const result = await service.claimFreePackage('user-1', 'pkg-free');

    expect(result.programId).toBe('program-1');
    expect(result.balance?.creditsRemaining).toBe(1);
  });
});

describe('ClassProgramsService.claimFreePackage — concurrent claims', () => {
  // The pre-insert check cannot be atomic on its own, so the unique index is
  // what guarantees one claim. This covers the race loser: it must read as
  // "already claimed", not as a 500.
  it('maps a unique violation to the already-claimed error', async () => {
    const { service, repository } = makeService();
    repository.getActivePackageForPayment.mockResolvedValueOnce({
      id: 'pkg-free',
      program_id: 'program-1',
      provider_id: 'provider-1',
      program_title: 'Yoga Suave',
      program_status: 'published',
      name: 'Clase gratis',
      price: 0,
      credits: 1,
      validity_days: null,
      kind: 'drop_in',
      active: true,
      sort_order: 0,
    });
    repository.createFreeClassPass.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(
      service.claimFreePackage('user-1', 'pkg-free'),
    ).rejects.toMatchObject({ message: 'Ya reclamaste este paquete gratis' });
  });

  it('rethrows an unrelated database error instead of masking it', async () => {
    const { service, repository } = makeService();
    repository.getActivePackageForPayment.mockResolvedValueOnce({
      id: 'pkg-free',
      program_id: 'program-1',
      provider_id: 'provider-1',
      program_title: 'Yoga Suave',
      program_status: 'published',
      name: 'Clase gratis',
      price: 0,
      credits: 1,
      validity_days: null,
      kind: 'drop_in',
      active: true,
      sort_order: 0,
    });
    repository.createFreeClassPass.mockRejectedValueOnce(
      new Error('connection reset'),
    );

    await expect(
      service.claimFreePackage('user-1', 'pkg-free'),
    ).rejects.toMatchObject({ message: 'connection reset' });
  });
});

describe('ClassProgramsService.listMyReservations', () => {
  function reservationRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'res-1',
      user_id: 'user-1',
      provider_id: 'provider-1',
      program_id: 'program-1',
      template_id: 'tpl-1',
      pass_id: 'pass-1',
      session_date: '2026-08-10',
      start_time: '07:00',
      duration_minutes: 55,
      instructor_name: 'Lucía Ramos',
      status: 'reserved',
      created_at: new Date('2026-08-05T00:00:00.000Z'),
      program_title: 'Barre Intensivo',
      program_city: 'Tegucigalpa',
      program_location_name: 'Studio Mixto HN',
      provider_name: 'Studio Mixto HN',
      provider_logo_url: null,
      theme_color: '#2EC4B6',
      ...overrides,
    };
  }

  it('defaults to upcoming, which is what a ticket list wants', async () => {
    const { service, repository } = makeService();

    await service.listMyReservations('user-1');

    expect(repository.listUserReservations).toHaveBeenCalledWith('user-1', {
      scope: 'upcoming',
      limit: 50,
    });
  });

  it('accepts past and all, and rejects anything else back to upcoming', async () => {
    const { service, repository } = makeService();

    await service.listMyReservations('user-1', { scope: 'past' });
    expect(repository.listUserReservations.mock.calls[0][1].scope).toBe('past');

    await service.listMyReservations('user-1', { scope: 'all' });
    expect(repository.listUserReservations.mock.calls[1][1].scope).toBe('all');

    await service.listMyReservations('user-1', { scope: 'garbage' });
    expect(repository.listUserReservations.mock.calls[2][1].scope).toBe(
      'upcoming',
    );
  });

  it('clamps the limit into 1..100 and floors it', async () => {
    const { service, repository } = makeService();

    await service.listMyReservations('user-1', { limit: 500 });
    expect(repository.listUserReservations.mock.calls[0][1].limit).toBe(100);

    await service.listMyReservations('user-1', { limit: 0 });
    expect(repository.listUserReservations.mock.calls[1][1].limit).toBe(1);

    await service.listMyReservations('user-1', { limit: 7.9 });
    expect(repository.listUserReservations.mock.calls[2][1].limit).toBe(7);
  });

  it('maps a row into the shape a ticket needs, date and time included', async () => {
    const { service, repository } = makeService();
    repository.listUserReservations.mockResolvedValueOnce([reservationRow()]);

    const [ticket] = await service.listMyReservations('user-1');

    expect(ticket).toMatchObject({
      id: 'res-1',
      programTitle: 'Barre Intensivo',
      providerName: 'Studio Mixto HN',
      date: '2026-08-10',
      startTime: '07:00',
      durationMinutes: 55,
      instructorName: 'Lucía Ramos',
      status: 'reserved',
      themeColor: '#2EC4B6',
    });
  });
});
