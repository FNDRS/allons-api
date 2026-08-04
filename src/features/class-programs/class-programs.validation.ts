import { BadRequestException } from '@nestjs/common';
import type {
  PackageKind,
  PackagePayload,
  PackageUpdatePayload,
  ProgramPayload,
  ProgramStatus,
  ProgramUpdatePayload,
  ReservationPayload,
  TemplatePayload,
  TemplateUpdatePayload,
} from './class-programs.types';

export function parseProgramPayload(
  body: Record<string, unknown>,
): ProgramPayload {
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

/** Every field optional; only keys present in `body` are validated/returned. */
export function parseProgramUpdatePayload(
  body: Record<string, unknown>,
): ProgramUpdatePayload {
  const payload: ProgramUpdatePayload = {};
  if (body.title !== undefined)
    payload.title = requiredString(body.title, 'title');
  if (body.description !== undefined)
    payload.description = optionalString(body.description);
  if (body.discipline !== undefined)
    payload.discipline = optionalString(body.discipline);
  if (body.instructorName !== undefined)
    payload.instructorName = optionalString(body.instructorName);
  if (body.durationMinutes !== undefined)
    payload.durationMinutes = positiveInt(
      body.durationMinutes,
      'durationMinutes',
    );
  if (body.capacityPerSession !== undefined)
    payload.capacityPerSession = positiveInt(
      body.capacityPerSession,
      'capacityPerSession',
    );
  if (body.locationName !== undefined)
    payload.locationName = optionalString(body.locationName);
  if (body.address !== undefined)
    payload.address = optionalString(body.address);
  if (body.city !== undefined) payload.city = optionalString(body.city);
  if (body.latitude !== undefined)
    payload.latitude = optionalNumber(body.latitude);
  if (body.longitude !== undefined)
    payload.longitude = optionalNumber(body.longitude);
  if (body.coverImageUrl !== undefined)
    payload.coverImageUrl = optionalString(body.coverImageUrl);
  if (body.themeColor !== undefined)
    payload.themeColor = optionalString(body.themeColor);
  if (body.status !== undefined) payload.status = parseStatus(body.status);
  return payload;
}

export function parseTemplatePayload(
  body: Record<string, unknown>,
): TemplatePayload {
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

/**
 * `active` and the name/price/sortOrder fields update independently.
 * `kind`/`credits`/`validityDays` only change together, via `plan` — see
 * `PackageUpdatePayload`.
 */
export function parsePackageUpdatePayload(
  body: Record<string, unknown>,
): PackageUpdatePayload {
  const payload: PackageUpdatePayload = {};
  if (body.name !== undefined) payload.name = requiredString(body.name, 'name');
  if (body.price !== undefined)
    payload.price = nonNegativeNumber(body.price, 'price');
  if (body.sortOrder !== undefined)
    payload.sortOrder = nonNegativeInt(body.sortOrder, 'sortOrder');
  if (body.active !== undefined) payload.active = Boolean(body.active);
  if (body.kind !== undefined) payload.plan = parsePackagePlan(body);
  return payload;
}

/** Every field optional; only keys present in `body` are validated/returned. */
export function parseTemplateUpdatePayload(
  body: Record<string, unknown>,
): TemplateUpdatePayload {
  const payload: TemplateUpdatePayload = {};
  if (body.weekday !== undefined) payload.weekday = parseWeekday(body.weekday);
  if (body.startTime !== undefined)
    payload.startTime = parseTime(body.startTime);
  if (body.durationMinutes !== undefined)
    payload.durationMinutes =
      body.durationMinutes == null
        ? null
        : positiveInt(body.durationMinutes, 'durationMinutes');
  if (body.capacity !== undefined)
    payload.capacity =
      body.capacity == null ? null : positiveInt(body.capacity, 'capacity');
  if (body.instructorName !== undefined)
    payload.instructorName = optionalString(body.instructorName);
  if (body.active !== undefined) payload.active = Boolean(body.active);
  return payload;
}

/** `kind` determines `credits` (and requires `validityDays` for `unlimited`). */
function parsePackagePlan(body: Record<string, unknown>) {
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
  return { kind, credits, validityDays };
}

export function parsePackagePayload(
  body: Record<string, unknown>,
): PackagePayload {
  const { kind, credits, validityDays } = parsePackagePlan(body);
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

export function parseReservationPayload(
  body: Record<string, unknown>,
): ReservationPayload {
  return {
    programId: requiredString(body.programId, 'programId'),
    date: formatDate(parseDateField(body.date, 'date')),
    startTime: parseRequiredTime(body.startTime, 'startTime'),
  };
}

export function parseObjectArray(value: unknown): Record<string, unknown>[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new BadRequestException('Debe ser un arreglo');
  }
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new BadRequestException('Cada item debe ser un objeto');
    }
    return item as Record<string, unknown>;
  });
}

export function parseDateParam(value?: string) {
  const raw = value ?? formatDate(new Date());
  return parseDateString(raw, 'from');
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseOptionalUuidParam(value: unknown, field: string) {
  const parsed = optionalString(value);
  if (parsed === null) return null;
  if (!UUID_PATTERN.test(parsed)) {
    throw new BadRequestException(`${field} inválido`);
  }
  return parsed;
}

export function parseRequiredUuidParam(value: unknown, field: string) {
  const parsed = requiredString(value, field);
  if (!UUID_PATTERN.test(parsed)) {
    throw new BadRequestException(`${field} inválido`);
  }
  return parsed;
}

function parseDateField(value: unknown, field: string) {
  return parseDateString(requiredString(value, field), field);
}

function parseDateString(raw: string, field: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new BadRequestException(`${field} debe usar formato YYYY-MM-DD`);
  }
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || formatDate(date) !== raw) {
    throw new BadRequestException(`${field} inválido`);
  }
  return date;
}

export function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
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
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BadRequestException(`${field} debe ser un entero mayor a 0`);
  }
  return parsed;
}

function nonNegativeInt(value: unknown, field: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new BadRequestException(`${field} debe ser un entero 0 o mayor`);
  }
  return parsed;
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
  if (!Number.isFinite(parsed)) {
    throw new BadRequestException('Número inválido');
  }
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

export function parseTime(value: unknown) {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) {
    throw new BadRequestException('startTime debe usar formato HH:mm');
  }
  const [hour, minute] = value.split(':').map(Number);
  if (hour > 23 || minute > 59) {
    throw new BadRequestException('startTime inválido');
  }
  return value;
}

function parseRequiredTime(value: unknown, field: string) {
  if (value == null || value === '') {
    throw new BadRequestException(`${field} es requerido`);
  }
  return parseTime(value);
}

function parsePackageKind(value: unknown): PackageKind {
  if (value === 'drop_in' || value === 'pack' || value === 'unlimited') {
    return value;
  }
  throw new BadRequestException('kind inválido');
}
