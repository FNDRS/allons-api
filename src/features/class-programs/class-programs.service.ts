import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { FeatureFlagsService } from '../../shared/feature-flags.service';
import { ObservabilityService } from '../../shared/observability/observability.service';
import { PaygateService } from '../paygate/paygate.service';
import { PaymentOrdersRepository } from '../payments/payment-orders.repository';
import { ProvidersService } from '../providers/providers.service';
import {
  mapClassPass,
  mapPackage,
  mapProgram,
  mapProgramMetrics,
  mapTemplate,
} from './class-programs.mappers';
import { ClassProgramsRepository } from './class-programs.repository';
import type { ProgramRow } from './class-programs.types';
import {
  formatDate,
  parseDateParam,
  parseObjectArray,
  parseOptionalUuidParam,
  parsePackagePayload,
  parsePackageUpdatePayload,
  parseProgramPayload,
  parseProgramUpdatePayload,
  parseRequiredUuidParam,
  parseReservationPayload,
  parseTemplatePayload,
  parseTemplateUpdatePayload,
} from './class-programs.validation';

@Injectable()
export class ClassProgramsService {
  constructor(
    private readonly repository: ClassProgramsRepository,
    private readonly providers: ProvidersService,
    private readonly paygate: PaygateService,
    private readonly orders: PaymentOrdersRepository,
    private readonly flags: FeatureFlagsService,
    private readonly obs: ObservabilityService,
  ) {}

  async listProviderPrograms(userId: string) {
    const membership = await this.providers.requireMembership(userId, [
      'owner',
      'admin',
    ]);
    const programs = await this.repository.getProgramsByProvider(
      membership.providerId,
      { publicOnly: false },
    );
    const withChildren = await this.withChildren(programs, {
      publicOnly: false,
    });
    return this.attachMetrics(withChildren);
  }

  async createProviderProgram(userId: string, body: Record<string, unknown>) {
    const membership = await this.providers.requireMembership(userId, [
      'owner',
      'admin',
    ]);
    const payload = parseProgramPayload(body);
    const templates = parseObjectArray(body.sessionTemplates).map(
      parseTemplatePayload,
    );
    const packages = parseObjectArray(body.packages).map(parsePackagePayload);
    const created = await this.repository.createProgramWithChildren(
      membership.providerId,
      payload,
      templates,
      packages,
    );
    return this.getProviderProgramForUser(userId, created.id);
  }

  async createSessionTemplate(
    userId: string,
    programId: string,
    body: Record<string, unknown>,
  ) {
    await this.assertProviderProgramAccess(userId, programId);
    const row = await this.repository.createSessionTemplate(
      programId,
      parseTemplatePayload(body),
    );
    return mapTemplate(row);
  }

  async createPackage(
    userId: string,
    programId: string,
    body: Record<string, unknown>,
  ) {
    await this.assertProviderProgramAccess(userId, programId);
    const row = await this.repository.createPackage(
      programId,
      parsePackagePayload(body),
    );
    return mapPackage(row);
  }

  async updateProviderProgram(
    userId: string,
    programId: string,
    body: Record<string, unknown>,
  ) {
    await this.assertProviderProgramAccess(userId, programId);
    const updated = await this.repository.updateProgram(
      programId,
      parseProgramUpdatePayload(body),
    );
    if (!updated) throw new NotFoundException('Programa no encontrado');
    return this.getProviderProgramForUser(userId, programId);
  }

  async updateSessionTemplate(
    userId: string,
    templateId: string,
    body: Record<string, unknown>,
  ) {
    await this.assertProviderTemplateAccess(userId, templateId);
    const updated = await this.repository.updateTemplate(
      templateId,
      parseTemplateUpdatePayload(body),
    );
    if (!updated) throw new NotFoundException('Horario no encontrado');
    return mapTemplate(updated);
  }

  async deactivateSessionTemplate(userId: string, templateId: string) {
    await this.assertProviderTemplateAccess(userId, templateId);
    await this.repository.deactivateTemplate(templateId);
    return { deactivated: true };
  }

  async updatePackage(
    userId: string,
    packageId: string,
    body: Record<string, unknown>,
  ) {
    await this.assertProviderPackageAccess(userId, packageId);
    const updated = await this.repository.updatePackage(
      packageId,
      parsePackageUpdatePayload(body),
    );
    if (!updated) throw new NotFoundException('Paquete no encontrado');
    return mapPackage(updated);
  }

  async deactivatePackage(userId: string, packageId: string) {
    await this.assertProviderPackageAccess(userId, packageId);
    await this.repository.deactivatePackage(packageId);
    return { deactivated: true };
  }

  async listPublicPrograms(providerId: string) {
    const programs = await this.repository.getProgramsByProvider(providerId, {
      publicOnly: true,
    });
    return this.withChildren(programs, { publicOnly: true });
  }

  async getPublicProgram(
    programId: string,
    options: { userId?: string | null } = {},
  ) {
    const program = await this.getProgramOrThrow(programId, {
      publicOnly: true,
    });
    // Independent of each other — `withChildren` only needs `program`,
    // `myBalance` only needs `programId`/`userId` — so they run in parallel
    // rather than adding the balance lookup's latency on top for every
    // authenticated request.
    const [[withChildren], passRows] = await Promise.all([
      this.withChildren([program], { publicOnly: true }),
      options.userId
        ? this.repository.listUserClassPasses(options.userId, {
            providerId: null,
            programId,
          })
        : Promise.resolve([]),
    ]);
    // `listUserClassPasses` groups by program, so this is at most one row —
    // the caller's combined balance across every pass they hold here, or
    // null for a guest (or a user with no active pass for this program).
    const myBalance = passRows[0] ?? null;
    return { ...withChildren, myBalance: myBalance && mapClassPass(myBalance) };
  }

  async getAvailability(
    programId: string,
    options: { from?: string; days: number; userId?: string | null },
  ) {
    const program = await this.getProgramOrThrow(programId, {
      publicOnly: true,
    });
    // Fetched before `from` is resolved: when the caller omits `from`, the
    // range must start on Honduras' civil today, not `parseDateParam`'s own
    // JS-`Date()`-based default (UTC) — between 00:00-05:59 UTC (evening in
    // Honduras) the two disagree by a day, which used to make the very first
    // occurrence come back labeled "Mañana" with no "Hoy" in the response.
    const todayCivil = await this.repository.getCivilToday();
    const from = options.from
      ? parseDateParam(options.from)
      : new Date(`${todayCivil}T00:00:00.000Z`);
    const dates = Array.from({ length: options.days }, (_, index) =>
      addUtcDays(from, index),
    );
    const end = dates[dates.length - 1];
    const [templates, counts, myReservations] = await Promise.all([
      this.repository.getTemplates([program.id], { publicOnly: true }),
      this.repository.getReservationCounts(
        program.id,
        formatDate(from),
        formatDate(end),
      ),
      options.userId
        ? this.repository.getUserReservedOccurrences(
            program.id,
            options.userId,
            formatDate(from),
            formatDate(end),
          )
        : Promise.resolve([]),
    ]);
    const reservedByOccurrence = new Map(
      counts.map((row) => [
        `${row.session_date}|${row.start_time}`,
        Number(row.reserved_count),
      ]),
    );
    const myReservedOccurrences = new Set(
      myReservations.map((row) => `${row.session_date}|${row.start_time}`),
    );
    const tomorrowCivil = formatDate(
      addUtcDays(new Date(`${todayCivil}T00:00:00.000Z`), 1),
    );

    return dates.flatMap((date) => {
      const dateKey = formatDate(date);
      const weekday = date.getUTCDay();
      const label =
        dateKey === todayCivil
          ? 'Hoy'
          : dateKey === tomorrowCivil
            ? 'Mañana'
            : WEEKDAY_LABELS_ES[weekday];
      return templates
        .filter((template) => template.weekday === weekday)
        .map((template) => {
          const capacity = template.capacity ?? program.capacity_per_session;
          const reservedCount =
            reservedByOccurrence.get(`${dateKey}|${template.start_time}`) ?? 0;
          const availableSpots = Math.max(0, capacity - reservedCount);
          return {
            date: dateKey,
            label,
            startTime: template.start_time,
            durationMinutes:
              template.duration_minutes ?? program.duration_minutes,
            instructorName: template.instructor_name ?? program.instructor_name,
            capacity,
            reservedCount,
            availableSpots,
            canReserve: availableSpots > 0,
            alreadyReserved: myReservedOccurrences.has(
              `${dateKey}|${template.start_time}`,
            ),
          };
        });
    });
  }

  async initiatePackagePayment(userId: string, packageId: string) {
    if (!this.flags.paymentsEnabled || this.flags.forceFreeEvents) {
      this.obs.warn('class_packages.payment.disabled', {
        userId,
        packageId,
        paymentsEnabled: this.flags.paymentsEnabled,
        forceFreeEvents: this.flags.forceFreeEvents,
      });
      throw new ServiceUnavailableException(
        'Pagos temporalmente deshabilitados',
      );
    }

    const recentPending = await this.orders.countRecentPendingForUser(
      userId,
      new Date(Date.now() - 10 * 60 * 1000),
    );
    if (recentPending >= 3) {
      throw new HttpException(
        'Demasiados intentos de pago; intenta de nuevo en unos minutos',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const item = await this.repository.getActivePackageForPayment(packageId);
    if (!item) throw new NotFoundException('Paquete no encontrado');

    const amountCents = Math.round(Number(item.price) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      throw new BadRequestException('El paquete no tiene precio configurado');
    }

    const link = await this.paygate.createPaymentLink({
      description: `Paquete de clases - ${item.program_title} - ${item.name}`,
      amount: Number((amountCents / 100).toFixed(2)),
      currency: 'HNL',
    });
    const expiresAt = new Date(
      Date.now() + link.expirationHours * 60 * 60 * 1000,
    );

    const order = await this.orders.create({
      userId,
      orderType: 'class_package',
      eventId: null,
      entryTypeId: null,
      classProgramId: item.program_id,
      classPackageId: item.id,
      quantity: 1,
      amountCents,
      currency: link.currency,
      paygateLinkId: link.id,
      expiresAt,
    });

    this.obs.event('class_packages.payment.created', {
      orderId: order.id,
      userId,
      packageId: item.id,
      programId: item.program_id,
      amountCents,
      currency: order.currency,
    });

    return {
      orderId: order.id,
      paymentLink: link.link,
      amountCents: order.amountCents,
      currency: order.currency,
      expiresAt: order.expiresAt?.toISOString() ?? expiresAt.toISOString(),
      packageId: item.id,
      programId: item.program_id,
    };
  }

  async listMyClassPasses(
    userId: string,
    filters: { providerId?: string; programId?: string },
  ) {
    const rows = await this.repository.listUserClassPasses(userId, {
      providerId: parseOptionalUuidParam(filters.providerId, 'providerId'),
      programId: parseOptionalUuidParam(filters.programId, 'programId'),
    });
    return rows.map(mapClassPass);
  }

  async createReservation(userId: string, body: Record<string, unknown>) {
    const payload = parseReservationPayload(body);
    const result = await this.repository.createReservation(userId, payload);
    if (!result.ok) {
      switch (result.reason) {
        case 'template_not_found':
          throw new NotFoundException('Horario no encontrado');
        case 'template_ambiguous':
          throw new BadRequestException(
            'Horario duplicado; contacta al comercio',
          );
        case 'occurrence_elapsed':
          throw new BadRequestException('Este horario ya pasó');
        case 'pass_not_found':
          throw new BadRequestException('No tienes sesiones disponibles');
        case 'capacity_full':
          throw new BadRequestException('No hay cupos disponibles');
        case 'duplicate_reservation':
          throw new BadRequestException('Ya reservaste este horario');
      }
    }

    const reservation = result.reservation;
    return {
      id: reservation.id,
      programId: reservation.program_id,
      templateId: reservation.template_id,
      passId: reservation.pass_id,
      date: reservation.session_date,
      startTime: reservation.start_time,
      durationMinutes: reservation.duration_minutes,
      instructorName: reservation.instructor_name,
      status: reservation.status,
      createdAt: reservation.created_at.toISOString(),
    };
  }

  async cancelReservation(userId: string, reservationId: string) {
    const id = parseRequiredUuidParam(reservationId, 'reservationId');
    const result = await this.repository.cancelReservation(userId, id);
    if (!result.ok) {
      switch (result.reason) {
        case 'not_found':
          throw new NotFoundException('Reserva no encontrada');
        case 'forbidden':
          throw new ForbiddenException('La reserva no pertenece al usuario');
        case 'already_cancelled':
          throw new BadRequestException('La reserva ya fue cancelada');
        case 'occurrence_elapsed':
          throw new BadRequestException(
            'Esta clase ya pasó; no se puede cancelar',
          );
      }
    }

    return {
      id: result.reservation.id,
      status: result.reservation.status,
      cancelledAt: result.reservation.cancelled_at.toISOString(),
      refunded: result.refunded,
    };
  }

  private async getProviderProgramForUser(userId: string, programId: string) {
    await this.assertProviderProgramAccess(userId, programId);
    const program = await this.getProgramOrThrow(programId, {
      publicOnly: false,
    });
    const [withChildren] = await this.withChildren([program], {
      publicOnly: false,
    });
    const [withMetrics] = await this.attachMetrics([withChildren]);
    return withMetrics;
  }

  /**
   * Provider-only aggregates (sold sessions, upcoming reservations, average
   * occupancy, revenue) — never merged inside `withChildren`, which is also
   * used by the public listing/detail routes and must not leak this data.
   */
  private async attachMetrics<T extends { id: string }>(programs: T[]) {
    if (programs.length === 0) return [];
    const rows = await this.repository.getProgramMetrics(
      programs.map((program) => program.id),
    );
    const metricsById = new Map(
      rows.map((row) => [row.program_id, mapProgramMetrics(row)]),
    );
    return programs.map((program) => ({
      ...program,
      metrics: metricsById.get(program.id) ?? {
        soldSessions: 0,
        upcomingReservations: 0,
        avgOccupancy: null,
        revenueCents: 0,
      },
    }));
  }

  private async assertProviderProgramAccess(userId: string, programId: string) {
    const membership = await this.providers.requireMembership(userId, [
      'owner',
      'admin',
    ]);
    const found = await this.repository.findProviderProgramId(
      membership.providerId,
      programId,
    );
    if (!found) throw new NotFoundException('Programa no encontrado');
  }

  /** Templates/packages are addressed by their own id (no programId in the route), so ownership resolves through the parent program instead. */
  private async assertProviderTemplateAccess(
    userId: string,
    templateId: string,
  ) {
    const membership = await this.providers.requireMembership(userId, [
      'owner',
      'admin',
    ]);
    const programId = await this.repository.findProviderProgramIdForTemplate(
      membership.providerId,
      templateId,
    );
    if (!programId) throw new NotFoundException('Horario no encontrado');
  }

  private async assertProviderPackageAccess(userId: string, packageId: string) {
    const membership = await this.providers.requireMembership(userId, [
      'owner',
      'admin',
    ]);
    const programId = await this.repository.findProviderProgramIdForPackage(
      membership.providerId,
      packageId,
    );
    if (!programId) throw new NotFoundException('Paquete no encontrado');
  }

  private async getProgramOrThrow(
    programId: string,
    options: { publicOnly: boolean },
  ) {
    const program = await this.repository.getProgram(programId, options);
    if (!program) throw new NotFoundException('Programa no encontrado');
    return program;
  }

  private async withChildren(
    programs: ProgramRow[],
    options: { publicOnly: boolean },
  ) {
    if (programs.length === 0) return [];
    const programIds = programs.map((program) => program.id);
    const [templates, packages] = await Promise.all([
      this.repository.getTemplates(programIds, options),
      this.repository.getPackages(programIds, options),
    ]);
    return programs.map((program) => ({
      ...mapProgram(program),
      sessionTemplates: templates
        .filter((template) => template.program_id === program.id)
        .map(mapTemplate),
      packages: packages
        .filter((item) => item.program_id === program.id)
        .map(mapPackage),
    }));
  }
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** Indexed by `Date.getUTCDay()` (0 = Sunday). */
const WEEKDAY_LABELS_ES = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
];
