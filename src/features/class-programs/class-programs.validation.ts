import { BadRequestException } from '@nestjs/common';
import type {
  PackageKind,
  PackagePayload,
  ProgramPayload,
  ProgramStatus,
  ReservationPayload,
  TemplatePayload,
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

export function parsePackagePayload(
  body: Record<string, unknown>,
): PackagePayload {
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
