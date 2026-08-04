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

export interface ReservationPayload {
  programId: string;
  date: string;
  startTime: string;
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
  created_at: Date;
}

export type ReservationCreateResult =
  | { ok: true; reservation: ReservationRow }
  | {
      ok: false;
      reason:
        | 'template_not_found'
        | 'pass_not_found'
        | 'capacity_full'
        | 'duplicate_reservation';
    };
