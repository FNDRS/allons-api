import {
  BadRequestException,
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
import { mapPackage, mapProgram, mapTemplate } from './class-programs.mappers';
import { ClassProgramsRepository } from './class-programs.repository';
import type { ProgramRow } from './class-programs.types';
import {
  formatDate,
  parseDateParam,
  parseObjectArray,
  parsePackagePayload,
  parseProgramPayload,
  parseTemplatePayload,
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
    return this.withChildren(programs, { publicOnly: false });
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

  async listPublicPrograms(providerId: string) {
    const programs = await this.repository.getProgramsByProvider(providerId, {
      publicOnly: true,
    });
    return this.withChildren(programs, { publicOnly: true });
  }

  async getPublicProgram(programId: string) {
    const program = await this.getProgramOrThrow(programId, {
      publicOnly: true,
    });
    const [withChildren] = await this.withChildren([program], {
      publicOnly: true,
    });
    return withChildren;
  }

  async getAvailability(
    programId: string,
    options: { from?: string; days: number },
  ) {
    const program = await this.getProgramOrThrow(programId, {
      publicOnly: true,
    });
    const from = parseDateParam(options.from);
    const dates = Array.from({ length: options.days }, (_, index) =>
      addUtcDays(from, index),
    );
    const end = dates[dates.length - 1];
    const [templates, counts] = await Promise.all([
      this.repository.getTemplates([program.id], { publicOnly: true }),
      this.repository.getReservationCounts(
        program.id,
        formatDate(from),
        formatDate(end),
      ),
    ]);
    const reservedByOccurrence = new Map(
      counts.map((row) => [
        `${row.session_date}|${row.start_time}`,
        Number(row.reserved_count),
      ]),
    );

    return dates.flatMap((date) => {
      const dateKey = formatDate(date);
      const weekday = date.getUTCDay();
      return templates
        .filter((template) => template.weekday === weekday)
        .map((template) => {
          const capacity = template.capacity ?? program.capacity_per_session;
          const reservedCount =
            reservedByOccurrence.get(`${dateKey}|${template.start_time}`) ?? 0;
          const availableSpots = Math.max(0, capacity - reservedCount);
          return {
            date: dateKey,
            startTime: template.start_time,
            durationMinutes:
              template.duration_minutes ?? program.duration_minutes,
            instructorName: template.instructor_name ?? program.instructor_name,
            capacity,
            reservedCount,
            availableSpots,
            canReserve: availableSpots > 0,
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

  private async getProviderProgramForUser(userId: string, programId: string) {
    await this.assertProviderProgramAccess(userId, programId);
    const program = await this.getProgramOrThrow(programId, {
      publicOnly: false,
    });
    const [withChildren] = await this.withChildren([program], {
      publicOnly: false,
    });
    return withChildren;
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
