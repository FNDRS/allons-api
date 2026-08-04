import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  PackagePayload,
  PackageRow,
  ProgramPayload,
  ProgramRow,
  ReservationCountRow,
  TemplatePayload,
  TemplateRow,
} from './class-programs.types';

@Injectable()
export class ClassProgramsRepository {
  constructor(private readonly prisma: PrismaService) {}

  createProgramWithChildren(
    providerId: string,
    payload: ProgramPayload,
    templates: TemplatePayload[],
    packages: PackagePayload[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<ProgramRow[]>`
        INSERT INTO class_programs (
          provider_id, title, description, discipline, instructor_name,
          duration_minutes, capacity_per_session, location_name, address, city,
          latitude, longitude, cover_image_url, theme_color, status
        ) VALUES (
          ${providerId}::uuid, ${payload.title}, ${payload.description},
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

      return program;
    });
  }

  async createSessionTemplate(programId: string, payload: TemplatePayload) {
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
    return rows[0];
  }

  async createPackage(programId: string, payload: PackagePayload) {
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
    return rows[0];
  }

  getProgramsByProvider(providerId: string, options: { publicOnly: boolean }) {
    return this.prisma.$queryRaw<ProgramRow[]>`
      SELECT *
      FROM class_programs
      WHERE provider_id = ${providerId}::uuid
        AND (${options.publicOnly} = false OR status = 'published')
      ORDER BY created_at DESC
    `;
  }

  async getProgram(programId: string, options: { publicOnly: boolean }) {
    const rows = await this.prisma.$queryRaw<ProgramRow[]>`
      SELECT *
      FROM class_programs
      WHERE id = ${programId}::uuid
        AND (${options.publicOnly} = false OR status = 'published')
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  async findProviderProgramId(providerId: string, programId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM class_programs
      WHERE id = ${programId}::uuid
        AND provider_id = ${providerId}::uuid
      LIMIT 1
    `;
    return rows[0]?.id ?? null;
  }

  getTemplates(programIds: string[], options: { publicOnly: boolean }) {
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

  getPackages(programIds: string[], options: { publicOnly: boolean }) {
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

  getReservationCounts(programId: string, from: string, to: string) {
    return this.prisma.$queryRaw<ReservationCountRow[]>`
      SELECT session_date::text AS session_date,
        to_char(start_time, 'HH24:MI') AS start_time,
        count(*)::int AS reserved_count
      FROM class_session_reservations
      WHERE program_id = ${programId}::uuid
        AND status = 'reserved'
        AND session_date BETWEEN ${from}::date AND ${to}::date
      GROUP BY session_date, start_time
    `;
  }
}
