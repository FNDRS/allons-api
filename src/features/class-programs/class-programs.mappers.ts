import type {
  PackageRow,
  ProgramRow,
  TemplateRow,
} from './class-programs.types';

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
