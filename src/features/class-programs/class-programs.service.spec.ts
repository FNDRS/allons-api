import { BadRequestException, NotFoundException } from '@nestjs/common';
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
    getReservationCounts: jest.fn(),
    getActivePackageForPayment: jest.fn(),
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
        startTime: '09:00',
        durationMinutes: 60,
        instructorName: 'Francisco Guillen',
        capacity: 6,
        reservedCount: 4,
        availableSpots: 2,
        canReserve: true,
      },
    ]);
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
});
