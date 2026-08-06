import type {
  ClassPassRow,
  UserReservationRow,
  PackageRow,
  ProgramMetricsRow,
  ProgramRow,
  TemplateRow,
} from './class-programs.types';
import { buildClassQrPayload } from './class-qr.utils';

export function mapProgram(row: ProgramRow) {
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

export function mapTemplate(row: TemplateRow) {
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

export function mapPackage(row: PackageRow) {
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

export function mapProgramMetrics(row: ProgramMetricsRow) {
  return {
    soldSessions: row.sold_sessions,
    upcomingReservations: row.upcoming_reservations,
    avgOccupancy: row.avg_occupancy,
    revenueCents: Number(row.revenue_cents),
  };
}

export function mapClassPass(row: ClassPassRow) {
  return {
    id: row.id,
    providerId: row.provider_id,
    programId: row.program_id,
    programTitle: row.program_title,
    packageId: row.package_id,
    packageName: row.package_name,
    packageKind: row.package_kind,
    creditsTotal: row.credits_total,
    creditsRemaining: row.credits_remaining,
    validFrom: row.valid_from.toISOString(),
    expiresAt: row.expires_at?.toISOString() ?? null,
    status: row.status,
  };
}

/**
 * A confirmed class reservation, as a client-facing ticket.
 *
 * `qrSecret` is threaded in rather than read here so this stays a pure mapper.
 * When it is null the payload is still built, unsigned, and the scanner reports
 * the scan as unverified — which is what local development without
 * `TICKET_QR_SECRET` gets.
 */
export function mapUserReservation(
  row: UserReservationRow,
  qrSecret: string | null = null,
) {
  return {
    id: row.id,
    programId: row.program_id,
    programTitle: row.program_title,
    providerId: row.provider_id,
    providerName: row.provider_name,
    providerLogoUrl: row.provider_logo_url,
    city: row.program_city,
    locationName: row.program_location_name,
    themeColor: row.theme_color,
    date: row.session_date,
    startTime: row.start_time,
    durationMinutes: row.duration_minutes,
    instructorName: row.instructor_name,
    status: row.status,
    /** `CLS-XXXXXX`, for the scanner's manual-entry fallback. */
    code: row.code,
    checkedInAt: row.checked_in_at?.toISOString() ?? null,
    /** JSON to render as the QR. Null once checked in — nothing left to scan. */
    qrPayload: row.checked_in_at
      ? null
      : buildClassQrPayload(row.id, row.program_id, qrSecret),
    createdAt: row.created_at.toISOString(),
  };
}
