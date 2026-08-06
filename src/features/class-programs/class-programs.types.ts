export type ProgramStatus = 'draft' | 'published' | 'archived';
export type PackageKind = 'drop_in' | 'pack' | 'unlimited';

export interface ProgramPayload {
  title: string;
  description: string | null;
  discipline: string | null;
  instructorName: string | null;
  durationMinutes: number;
  capacityPerSession: number;
  locationName: string | null;
  address: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  coverImageUrl: string | null;
  themeColor: string | null;
  status: ProgramStatus;
}

export interface TemplatePayload {
  weekday: number;
  startTime: string;
  durationMinutes: number | null;
  capacity: number | null;
  instructorName: string | null;
}

export interface PackagePayload {
  name: string;
  price: number;
  credits: number | null;
  validityDays: number | null;
  kind: PackageKind;
  sortOrder: number;
}

/** `undefined` = leave the column untouched. */
export type ProgramUpdatePayload = Partial<ProgramPayload>;

/** `undefined` = leave the column untouched. */
export type TemplateUpdatePayload = Partial<TemplatePayload> & {
  active?: boolean;
};

/**
 * `kind`/`credits`/`validityDays` move together (same rule as create — see
 * `parsePackagePayload`): present `kind` means all three are being redefined,
 * absent means none of the three changes. `undefined` elsewhere = untouched.
 */
export type PackageUpdatePayload = Partial<
  Pick<PackagePayload, 'name' | 'price' | 'sortOrder'>
> & {
  plan?: Pick<PackagePayload, 'kind' | 'credits' | 'validityDays'>;
  active?: boolean;
};

export interface ReservationPayload {
  programId: string;
  date: string;
  startTime: string;
}

/** A published program plus the comercio it belongs to, for discovery feeds. */
export interface DiscoveryProgramRow extends ProgramRow {
  provider_name: string;
  provider_handle: string | null;
  provider_logo_url: string | null;
}

export interface ProgramRow {
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

export interface TemplateRow {
  id: string;
  program_id: string;
  weekday: number;
  start_time: string;
  duration_minutes: number | null;
  capacity: number | null;
  instructor_name: string | null;
  active: boolean;
}

export interface PackageRow {
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

export interface ClassPackagePaymentRow extends PackageRow {
  provider_id: string;
  program_title: string;
  program_status: ProgramStatus;
}

export interface ReservationCountRow {
  session_date: string;
  start_time: string;
  reserved_count: number;
}

export interface UserReservedOccurrenceRow {
  session_date: string;
  start_time: string;
}

export interface ProgramMetricsRow {
  program_id: string;
  sold_sessions: number;
  upcoming_reservations: number;
  /** Average reserved/capacity across occurrences that have >=1 reservation; null when there are none yet. */
  avg_occupancy: number | null;
  /** Postgres `bigint` comes back as a JS `bigint` from `$queryRaw` — not JSON-serializable, so the mapper converts it. */
  revenue_cents: bigint;
}

/** A reservation joined with the class and comercio it belongs to. */
export interface UserReservationRow extends ReservationRow {
  program_title: string;
  program_city: string | null;
  program_location_name: string | null;
  provider_name: string;
  provider_logo_url: string | null;
  theme_color: string | null;
  checked_in_at: Date | null;
}

export interface ReservationRow {
  id: string;
  user_id: string;
  provider_id: string;
  program_id: string;
  template_id: string | null;
  pass_id: string | null;
  session_date: string;
  start_time: string;
  duration_minutes: number;
  instructor_name: string | null;
  status: string;
  /** `CLS-XXXXXX` shown to the client and accepted by the scanner's manual entry. */
  code: string | null;
  created_at: Date;
}

/**
 * Outcome of a scanner check-in. `invalid` deliberately carries nothing: the
 * code did not resolve to a reservation of this comercio, and saying anything
 * more would let a scanner probe another comercio's bookings.
 */
export type ClassCheckInResult =
  | { status: 'invalid' }
  | {
      status: 'valid' | 'duplicate' | 'cancelled' | 'wrong_day';
      reservationId: string;
      programId: string;
      programTitle: string;
      date: string;
      startTime: string;
      code: string | null;
      holderName: string | null;
      checkedInAt?: string;
    };

/**
 * What the scan endpoint answers. `verified` says whether a signature was
 * actually checked, so an operator can tell a cryptographic scan from a code
 * typed by hand; the repository does not know that, so the service adds it.
 */
export type ClassScanResponse = ClassCheckInResult & { verified: boolean };

export type ReservationCreateResult =
  | { ok: true; reservation: ReservationRow }
  | {
      ok: false;
      reason:
        | 'template_not_found'
        | 'template_ambiguous'
        | 'occurrence_elapsed'
        | 'pass_not_found'
        | 'capacity_full'
        | 'duplicate_reservation';
    };

export interface ClassPassFilters {
  providerId?: string | null;
  programId?: string | null;
}

export interface ClassPassRow {
  id: string;
  provider_id: string;
  program_id: string;
  program_title: string;
  package_id: string | null;
  package_name: string | null;
  package_kind: PackageKind | null;
  credits_total: number | null;
  credits_remaining: number | null;
  valid_from: Date;
  expires_at: Date | null;
  status: string;
}

export interface ReservationCancelRow {
  id: string;
  status: string;
  cancelled_at: Date;
}

export type ReservationCancelResult =
  | { ok: true; reservation: ReservationCancelRow; refunded: boolean }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'forbidden'
        | 'already_cancelled'
        | 'already_checked_in'
        | 'occurrence_elapsed';
    };
