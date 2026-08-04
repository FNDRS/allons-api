import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import { ProvidersService } from '../providers/providers.service';

type ProgramStatus = 'draft' | 'published' | 'archived';
type PackageKind = 'drop_in' | 'pack' | 'unlimited';

interface ProgramRow {
  id: string;
  provider_id: string;
  title: string;
  description: string | null;
  discipline: string | null;
  instructor_name: string | null;
  duration_minutes: number;
  capacity_per_session: number;
  location_name: string | null;
  address: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  cover_image_url: string | null;
  theme_color: string | null;
  status: ProgramStatus;
  created_at: Date;
  updated_at: Date;
}

interface TemplateRow {
  id: string;
  program_id: string;
  weekday: number;
  start_time: string;
  duration_minutes: number | null;
  capacity: number | null;
  instructor_name: string | null;
  active: boolean;
}

interface PackageRow {
  id: string;
  program_id: string;
  name: string;
  price: number;
  credits: number | null;
  validity_days: number | null;
  kind: PackageKind;
  active: boolean;
  sort_order: number;
}

interface ReservationCountRow {
  session_date: string;
  start_time: string;
  reserved_count: number;
}

@Injectable()
export class ClassProgramsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProvidersService,
  ) {}

  async listProviderPrograms(userId: string) {
    const membership = await this.providers.requireMembership(userId, [
      'owner',
      'admin',
    ]);
    const programs = await this.getProgramsByProvider(membership.providerId, {
      publicOnly: false,
    });
    return this.withChildren(programs, { publicOnly: false });
  }

  async createProviderProgram(userId: string, body: Record<string, unknown>) {
    const membership = await this.providers.requireMembership(userId, [
      'owner',
      'admin',
    ]);
    const payload = parseProgramPayload(body);
    const templates = parseArray(body.sessionTemplates).map(
      parseTemplatePayload,
    );
    const packages = parseArray(body.packages).map(parsePackagePayload);

    const [created] = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<ProgramRow[]>`
        INSERT INTO class_programs (
          provider_id, title, description, discipline, instructor_name,
          duration_minutes, capacity_per_session, location_name, address, city,
          latitude, longitude, cover_image_url, theme_color, status
        ) VALUES (
          ${membership.providerId}::uuid, ${payload.title}, ${payload.description},
          ${payload.discipline}, ${payload.instructorName}, ${payload.durationMinutes},
          ${payload.capacityPerSession}, ${payload.locationName}, ${payload.address},
          ${payload.city}, ${payload.latitude}, ${payload.longitude},
          ${payload.coverImageUrl}, ${payload.themeColor}, ${payload.status}
        )
        RETURNING *
      `;
      const program = rows[0];

      for (const template of templates) {
        await tx.$executeRaw`
          INSERT INTO class_session_templates (
            program_id, weekday, start_time, duration_minutes, capacity,
            instructor_name, active
          ) VALUES (
            ${program.id}::uuid, ${template.weekday}, ${template.startTime}::time,
            ${template.durationMinutes}, ${template.capacity},
            ${template.instructorName}, true
          )
        `;
      }

      for (const item of packages) {
        await tx.$executeRaw`
          INSERT INTO class_packages (
            program_id, name, price, credits, validity_days, kind, active,
            sort_order
          ) VALUES (
            ${program.id}::uuid, ${item.name}, ${item.price}, ${item.credits},
            ${item.validityDays}, ${item.kind}, true, ${item.sortOrder}
          )
        `;
      }

      return rows;
    });

    return this.getProviderProgramForUser(userId, created.id);
  }

  async createSessionTemplate(
    userId: string,
    programId: string,
    body: Record<string, unknown>,
  ) {
    await this.assertProviderProgramAccess(userId, programId);
    const payload = parseTemplatePayload(body);
    const rows = await this.prisma.$queryRaw<TemplateRow[]>`
      INSERT INTO class_session_templates (
        program_id, weekday, start_time, duration_minutes, capacity,
        instructor_name, active
      ) VALUES (
        ${programId}::uuid, ${payload.weekday}, ${payload.startTime}::time,
        ${payload.durationMinutes}, ${payload.capacity}, ${payload.instructorName}, true
      )
      RETURNING id, program_id, weekday, to_char(start_time, 'HH24:MI') AS start_time,
        duration_minutes, capacity, instructor_name, active
    `;
    return mapTemplate(rows[0]);
  }

  async createPackage(
    userId: string,
    programId: string,
    body: Record<string, unknown>,
  ) {
    await this.assertProviderProgramAccess(userId, programId);
    const payload = parsePackagePayload(body);
    const rows = await this.prisma.$queryRaw<PackageRow[]>`
      INSERT INTO class_packages (
        program_id, name, price, credits, validity_days, kind, active, sort_order
      ) VALUES (
        ${programId}::uuid, ${payload.name}, ${payload.price}, ${payload.credits},
        ${payload.validityDays}, ${payload.kind}, true, ${payload.sortOrder}
      )
      RETURNING id, program_id, name, price::float8 AS price, credits,
        validity_days, kind, active, sort_order
    `;
    return mapPackage(rows[0]);
  }

  async listPublicPrograms(providerId: string) {
    const programs = await this.getProgramsByProvider(providerId, {
      publicOnly: true,
    });
    return this.withChildren(programs, { publicOnly: true });
  }

  async getPublicProgram(programId: string) {
    const program = await this.getProgram(programId, { publicOnly: true });
    const [withChildren] = await this.withChildren([program], {
      publicOnly: true,
    });
    return withChildren;
  }

  async getAvailability(
    programId: string,
    options: { from?: string; days: number },
  ) {
    const program = await this.getProgram(programId, { publicOnly: true });
    const from = parseDateParam(options.from);
    const dates = Array.from({ length: options.days }, (_, index) =>
      addUtcDays(from, index),
    );
    const end = dates[dates.length - 1];
    const templates = await this.getTemplates([program.id], {
      publicOnly: true,
    });
    const counts = await this.prisma.$queryRaw<ReservationCountRow[]>`
      SELECT session_date::text AS session_date,
        to_char(start_time, 'HH24:MI') AS start_time,
        count(*)::int AS reserved_count
      FROM class_session_reservations
      WHERE program_id = ${program.id}::uuid
        AND status = 'reserved'
        AND session_date BETWEEN ${formatDate(from)}::date AND ${formatDate(end)}::date
      GROUP BY session_date, start_time
    `;
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

  private async getProviderProgramForUser(userId: string, programId: string) {
    await this.assertProviderProgramAccess(userId, programId);
    const program = await this.getProgram(programId, { publicOnly: false });
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
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM class_programs
      WHERE id = ${programId}::uuid
        AND provider_id = ${membership.providerId}::uuid
      LIMIT 1
    `;
    if (rows.length === 0)
      throw new NotFoundException('Programa no encontrado');
  }

  private async getProgramsByProvider(
    providerId: string,
    options: { publicOnly: boolean },
  ) {
    const rows = await this.prisma.$queryRaw<ProgramRow[]>`
      SELECT *
      FROM class_programs
      WHERE provider_id = ${providerId}::uuid
        AND (${options.publicOnly} = false OR status = 'published')
      ORDER BY created_at DESC
    `;
    return rows;
  }

  private async getProgram(
    programId: string,
    options: { publicOnly: boolean },
  ) {
    const rows = await this.prisma.$queryRaw<ProgramRow[]>`
      SELECT *
      FROM class_programs
      WHERE id = ${programId}::uuid
        AND (${options.publicOnly} = false OR status = 'published')
      LIMIT 1
    `;
    if (rows.length === 0)
      throw new NotFoundException('Programa no encontrado');
    return rows[0];
  }

  private async withChildren(
    programs: ProgramRow[],
    options: { publicOnly: boolean },
  ) {
    if (programs.length === 0) return [];
    const programIds = programs.map((program) => program.id);
    const [templates, packages] = await Promise.all([
      this.getTemplates(programIds, options),
      this.getPackages(programIds, options),
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

  private getTemplates(programIds: string[], options: { publicOnly: boolean }) {
    const ids = Prisma.join(programIds.map((id) => Prisma.sql`${id}::uuid`));
    return this.prisma.$queryRaw<TemplateRow[]>`
      SELECT id, program_id, weekday, to_char(start_time, 'HH24:MI') AS start_time,
        duration_minutes, capacity, instructor_name, active
      FROM class_session_templates
      WHERE program_id IN (${ids})
        AND (${options.publicOnly} = false OR active = true)
      ORDER BY weekday ASC, start_time ASC
    `;
  }

  private getPackages(programIds: string[], options: { publicOnly: boolean }) {
    const ids = Prisma.join(programIds.map((id) => Prisma.sql`${id}::uuid`));
    return this.prisma.$queryRaw<PackageRow[]>`
      SELECT id, program_id, name, price::float8 AS price, credits,
        validity_days, kind, active, sort_order
      FROM class_packages
      WHERE program_id IN (${ids})
        AND (${options.publicOnly} = false OR active = true)
      ORDER BY sort_order ASC, created_at ASC
    `;
  }
}

function parseProgramPayload(body: Record<string, unknown>) {
  return {
    title: requiredString(body.title, 'title'),
    description: optionalString(body.description),
    discipline: optionalString(body.discipline),
    instructorName: optionalString(body.instructorName),
    durationMinutes: positiveInt(body.durationMinutes, 'durationMinutes'),
    capacityPerSession: positiveInt(
      body.capacityPerSession,
      'capacityPerSession',
    ),
    locationName: optionalString(body.locationName),
    address: optionalString(body.address),
    city: optionalString(body.city),
    latitude: optionalNumber(body.latitude),
    longitude: optionalNumber(body.longitude),
    coverImageUrl: optionalString(body.coverImageUrl),
    themeColor: optionalString(body.themeColor),
    status: parseStatus(body.status),
  };
}

function parseTemplatePayload(body: Record<string, unknown>) {
  return {
    weekday: parseWeekday(body.weekday),
    startTime: parseTime(body.startTime),
    durationMinutes:
      body.durationMinutes == null
        ? null
        : positiveInt(body.durationMinutes, 'durationMinutes'),
    capacity:
      body.capacity == null ? null : positiveInt(body.capacity, 'capacity'),
    instructorName: optionalString(body.instructorName),
  };
}

function parsePackagePayload(body: Record<string, unknown>) {
  const kind = parsePackageKind(body.kind);
  const credits =
    kind === 'drop_in'
      ? 1
      : kind === 'unlimited'
        ? null
        : positiveInt(body.credits, 'credits');
  const validityDays =
    body.validityDays == null
      ? null
      : positiveInt(body.validityDays, 'validityDays');
  if (kind === 'unlimited' && validityDays == null) {
    throw new BadRequestException('validityDays es requerido para ilimitado');
  }
  return {
    name: requiredString(body.name, 'name'),
    price: nonNegativeNumber(body.price, 'price'),
    credits,
    validityDays,
    kind,
    sortOrder:
      body.sortOrder == null ? 0 : nonNegativeInt(body.sortOrder, 'sortOrder'),
  };
}

function parseArray(value: unknown): Record<string, unknown>[] {
  if (value == null) return [];
  if (!Array.isArray(value))
    throw new BadRequestException('Debe ser un arreglo');
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new BadRequestException('Cada item debe ser un objeto');
    }
    return item as Record<string, unknown>;
  });
}

function requiredString(value: unknown, field: string) {
  const parsed = optionalString(value);
  if (!parsed) throw new BadRequestException(`${field} es requerido`);
  return parsed;
}

function optionalString(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function positiveInt(value: unknown, field: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new BadRequestException(`${field} debe ser mayor a 0`);
  }
  return Math.floor(parsed);
}

function nonNegativeInt(value: unknown, field: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new BadRequestException(`${field} debe ser 0 o mayor`);
  }
  return Math.floor(parsed);
}

function nonNegativeNumber(value: unknown, field: string) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new BadRequestException(`${field} debe ser 0 o mayor`);
  }
  return parsed;
}

function optionalNumber(value: unknown) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed))
    throw new BadRequestException('Número inválido');
  return parsed;
}

function parseStatus(value: unknown): ProgramStatus {
  if (value == null || value === '') return 'draft';
  if (value === 'draft' || value === 'published' || value === 'archived') {
    return value;
  }
  throw new BadRequestException('status inválido');
}

function parseWeekday(value: unknown) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 6) {
    throw new BadRequestException('weekday debe estar entre 0 y 6');
  }
  return parsed;
}

function parseTime(value: unknown) {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) {
    throw new BadRequestException('startTime debe usar formato HH:mm');
  }
  const [hour, minute] = value.split(':').map(Number);
  if (hour > 23 || minute > 59) {
    throw new BadRequestException('startTime inválido');
  }
  return value;
}

function parsePackageKind(value: unknown): PackageKind {
  if (value === 'drop_in' || value === 'pack' || value === 'unlimited') {
    return value;
  }
  throw new BadRequestException('kind inválido');
}

function parseDateParam(value?: string) {
  const raw = value ?? formatDate(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new BadRequestException('from debe usar formato YYYY-MM-DD');
  }
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()))
    throw new BadRequestException('from inválido');
  return date;
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function mapProgram(row: ProgramRow) {
  return {
    id: row.id,
    providerId: row.provider_id,
    title: row.title,
    description: row.description,
    discipline: row.discipline,
    instructorName: row.instructor_name,
    durationMinutes: row.duration_minutes,
    capacityPerSession: row.capacity_per_session,
    locationName: row.location_name,
    address: row.address,
    city: row.city,
    latitude: row.latitude,
    longitude: row.longitude,
    coverImageUrl: row.cover_image_url,
    themeColor: row.theme_color,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapTemplate(row: TemplateRow) {
  return {
    id: row.id,
    programId: row.program_id,
    weekday: row.weekday,
    startTime: row.start_time,
    durationMinutes: row.duration_minutes,
    capacity: row.capacity,
    instructorName: row.instructor_name,
    active: row.active,
  };
}

function mapPackage(row: PackageRow) {
  return {
    id: row.id,
    programId: row.program_id,
    name: row.name,
    price: row.price,
    credits: row.credits,
    validityDays: row.validity_days,
    kind: row.kind,
    active: row.active,
    sortOrder: row.sort_order,
  };
}
