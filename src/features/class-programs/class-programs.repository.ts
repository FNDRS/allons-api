import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  ClassPackagePaymentRow,
  ClassPassFilters,
  ClassPassRow,
  PackagePayload,
  PackageRow,
  ProgramPayload,
  ProgramRow,
  ReservationCancelResult,
  ReservationCountRow,
  ReservationCreateResult,
  ReservationPayload,
  ReservationRow,
  TemplatePayload,
  TemplateRow,
} from './class-programs.types';

/** Cancelling this far ahead of the session (or further) returns the credit. */
const CANCELLATION_REFUND_WINDOW_HOURS = 6;

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

  async getActivePackageForPayment(packageId: string) {
    const rows = await this.prisma.$queryRaw<ClassPackagePaymentRow[]>`
      SELECT cp.id, cp.program_id, cp.name, cp.price::float8 AS price,
        cp.credits, cp.validity_days, cp.kind, cp.active, cp.sort_order,
        p.provider_id, p.title AS program_title, p.status AS program_status
      FROM class_packages cp
      JOIN class_programs p ON p.id = cp.program_id
      WHERE cp.id = ${packageId}::uuid
        AND cp.active = true
        AND p.status = 'published'
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  createReservation(
    userId: string,
    payload: ReservationPayload,
  ): Promise<ReservationCreateResult> {
    return this.prisma
      .$transaction(async (tx): Promise<ReservationCreateResult> => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(
            (${payload.programId}::uuid)::text || '|' ||
            (${payload.date}::date)::text || '|' ||
            to_char(${payload.startTime}::time, 'HH24:MI')
          ))
        `;

        const templateRows = await tx.$queryRaw<
          Array<{
            template_id: string;
            provider_id: string;
            program_id: string;
            duration_minutes: number;
            instructor_name: string | null;
            capacity: number;
            template_count: number;
          }>
        >`
        SELECT t.id AS template_id, p.provider_id, p.id AS program_id,
          COALESCE(t.duration_minutes, p.duration_minutes) AS duration_minutes,
          COALESCE(t.instructor_name, p.instructor_name) AS instructor_name,
          COALESCE(t.capacity, p.capacity_per_session) AS capacity,
          count(*) OVER ()::int AS template_count
        FROM class_session_templates t
        JOIN class_programs p ON p.id = t.program_id
        WHERE p.id = ${payload.programId}::uuid
          AND p.status = 'published'
          AND t.active = true
          AND t.weekday = EXTRACT(DOW FROM ${payload.date}::date)::int
          AND t.start_time = ${payload.startTime}::time
        ORDER BY t.created_at ASC, t.id ASC
        LIMIT 1
      `;
        const template = templateRows[0];
        if (!template) return { ok: false, reason: 'template_not_found' };
        if (template.template_count > 1) {
          return { ok: false, reason: 'template_ambiguous' };
        }

        const elapsedRows = await tx.$queryRaw<Array<{ elapsed: boolean }>>`
          SELECT (
            ${payload.date}::date + ${payload.startTime}::time
          ) <= (now() AT TIME ZONE 'America/Tegucigalpa') AS elapsed
        `;
        if (elapsedRows[0]?.elapsed) {
          return { ok: false, reason: 'occurrence_elapsed' };
        }

        const passRows = await tx.$queryRaw<
          Array<{
            id: string;
            credits_remaining: number | null;
          }>
        >`
        SELECT id, credits_remaining
        FROM user_class_passes
        WHERE user_id = ${userId}::uuid
          AND program_id = ${payload.programId}::uuid
          AND status = 'active'
          AND valid_from <= now()
          AND (expires_at IS NULL OR expires_at > now())
          AND (credits_remaining IS NULL OR credits_remaining > 0)
        ORDER BY expires_at ASC NULLS LAST, created_at ASC
        LIMIT 1
        FOR UPDATE
      `;
        const pass = passRows[0];
        if (!pass) return { ok: false, reason: 'pass_not_found' };

        const duplicateRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM class_session_reservations
        WHERE user_id = ${userId}::uuid
          AND program_id = ${payload.programId}::uuid
          AND session_date = ${payload.date}::date
          AND start_time = ${payload.startTime}::time
          AND status = 'reserved'
        LIMIT 1
      `;
        if (duplicateRows[0]) {
          return { ok: false, reason: 'duplicate_reservation' };
        }

        const countRows = await tx.$queryRaw<Array<{ reserved_count: number }>>`
        SELECT count(*)::int AS reserved_count
        FROM class_session_reservations
        WHERE program_id = ${payload.programId}::uuid
          AND session_date = ${payload.date}::date
          AND start_time = ${payload.startTime}::time
          AND status = 'reserved'
      `;
        if ((countRows[0]?.reserved_count ?? 0) >= template.capacity) {
          return { ok: false, reason: 'capacity_full' };
        }

        const reservationRows = await tx.$queryRaw<ReservationRow[]>`
        INSERT INTO class_session_reservations (
          user_id, provider_id, program_id, template_id, pass_id, session_date,
          start_time, duration_minutes, instructor_name, status
        ) VALUES (
          ${userId}::uuid, ${template.provider_id}::uuid, ${template.program_id}::uuid,
          ${template.template_id}::uuid, ${pass.id}::uuid, ${payload.date}::date,
          ${payload.startTime}::time, ${template.duration_minutes},
          ${template.instructor_name}, 'reserved'
        )
        RETURNING id, user_id, provider_id, program_id, template_id, pass_id,
          session_date::text AS session_date, to_char(start_time, 'HH24:MI') AS start_time,
          duration_minutes, instructor_name, status, created_at
      `;

        if (pass.credits_remaining !== null) {
          await tx.$executeRaw`
          UPDATE user_class_passes
          SET credits_remaining = credits_remaining - 1,
            updated_at = now()
          WHERE id = ${pass.id}::uuid
        `;
        }

        return { ok: true, reservation: reservationRows[0] };
      })
      .catch((err) => {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          return { ok: false, reason: 'duplicate_reservation' } as const;
        }
        throw err;
      });
  }

  /**
   * Cancels a reservation and refunds its credit when cancelled at least
   * `CANCELLATION_REFUND_WINDOW_HOURS` before the session. `FOR UPDATE` on the
   * reservation row serializes concurrent cancel attempts for the same id —
   * no separate advisory lock needed, unlike `createReservation` which locks
   * a whole occurrence slot shared across many reservations.
   */
  cancelReservation(
    userId: string,
    reservationId: string,
  ): Promise<ReservationCancelResult> {
    return this.prisma.$transaction(
      async (tx): Promise<ReservationCancelResult> => {
        const rows = await tx.$queryRaw<
          Array<{
            id: string;
            user_id: string;
            pass_id: string | null;
            session_date: string;
            start_time: string;
            status: string;
          }>
        >`
        SELECT id, user_id, pass_id, session_date::text AS session_date,
          to_char(start_time, 'HH24:MI') AS start_time, status
        FROM class_session_reservations
        WHERE id = ${reservationId}::uuid
        FOR UPDATE
      `;
        const reservation = rows[0];
        if (!reservation) return { ok: false, reason: 'not_found' };
        if (reservation.user_id !== userId) {
          return { ok: false, reason: 'forbidden' };
        }
        if (reservation.status === 'cancelled') {
          return { ok: false, reason: 'already_cancelled' };
        }

        const checkRows = await tx.$queryRaw<
          Array<{ elapsed: boolean; refund_eligible: boolean }>
        >`
        SELECT
          (${reservation.session_date}::date + ${reservation.start_time}::time)
            <= (now() AT TIME ZONE 'America/Tegucigalpa') AS elapsed,
          (${reservation.session_date}::date + ${reservation.start_time}::time)
            - (now() AT TIME ZONE 'America/Tegucigalpa')
            >= make_interval(hours => ${CANCELLATION_REFUND_WINDOW_HOURS}) AS refund_eligible
      `;
        if (checkRows[0]?.elapsed) {
          return { ok: false, reason: 'occurrence_elapsed' };
        }
        const withinRefundWindow = Boolean(checkRows[0]?.refund_eligible);

        const updatedRows = await tx.$queryRaw<
          Array<{ id: string; status: string; cancelled_at: Date }>
        >`
        UPDATE class_session_reservations
        SET status = 'cancelled', cancelled_at = now(), updated_at = now()
        WHERE id = ${reservationId}::uuid
        RETURNING id, status, cancelled_at
      `;

        // `refunded` reflects whether a credit was actually handed back, not
        // just whether the cancellation window allowed it. An unlimited pass
        // (`credits_remaining IS NULL`) never had a credit taken in the first
        // place, so the guarded UPDATE below affects 0 rows for it — the
        // affected-row count is the one signal that covers every case (no
        // pass_id, unlimited pass, finite pass) without duplicating the
        // "is this pass finite" check here.
        let refunded = false;
        if (withinRefundWindow && reservation.pass_id) {
          // `user_id` guard is belt-and-suspenders: `reservation.pass_id`
          // should only ever reference a pass owned by `reservation.user_id`
          // (already confirmed to equal `userId` above), since
          // `createReservation` only ever selects a pass scoped to its own
          // caller. Costs nothing and stops a future data-integrity bug from
          // crediting the wrong account.
          const affected = await tx.$executeRaw`
          UPDATE user_class_passes
          SET credits_remaining = credits_remaining + 1,
            updated_at = now()
          WHERE id = ${reservation.pass_id}::uuid
            AND user_id = ${userId}::uuid
            AND credits_remaining IS NOT NULL
        `;
          refunded = affected > 0;
        }

        return { ok: true, reservation: updatedRows[0], refunded };
      },
    );
  }

  /**
   * A user's usable class balance by published program: active, within the
   * validity window, and with credits left to spend (unlimited passes have no
   * `credits_remaining` to check). A finite pack the user already burned
   * through is excluded because it grants nothing further.
   */
  listUserClassPasses(
    userId: string,
    filters: ClassPassFilters,
  ): Promise<ClassPassRow[]> {
    const conditions = [
      Prisma.sql`ucp.user_id = ${userId}::uuid`,
      Prisma.sql`ucp.status = 'active'`,
      Prisma.sql`ucp.valid_from <= now()`,
      Prisma.sql`(ucp.expires_at IS NULL OR ucp.expires_at > now())`,
      Prisma.sql`(ucp.credits_remaining IS NULL OR ucp.credits_remaining > 0)`,
    ];
    if (filters.providerId) {
      conditions.push(
        Prisma.sql`ucp.provider_id = ${filters.providerId}::uuid`,
      );
    }
    if (filters.programId) {
      conditions.push(Prisma.sql`ucp.program_id = ${filters.programId}::uuid`);
    }

    return this.prisma.$queryRaw<ClassPassRow[]>`
      SELECT
        MIN(ucp.id::text) AS id,
        ucp.provider_id,
        ucp.program_id,
        cp.title AS program_title,
        CASE WHEN count(*) = 1 THEN MIN(ucp.package_id::text)::uuid ELSE NULL END AS package_id,
        CASE WHEN count(*) = 1 THEN MIN(pkg.name) ELSE NULL END AS package_name,
        CASE WHEN count(*) = 1 THEN MIN(pkg.kind) ELSE NULL END AS package_kind,
        CASE WHEN bool_or(ucp.credits_total IS NULL) THEN NULL ELSE sum(ucp.credits_total)::int END AS credits_total,
        CASE WHEN bool_or(ucp.credits_remaining IS NULL) THEN NULL ELSE sum(ucp.credits_remaining)::int END AS credits_remaining,
        MIN(ucp.valid_from) AS valid_from,
        MIN(ucp.expires_at) AS expires_at,
        'active' AS status
      FROM user_class_passes ucp
      JOIN class_programs cp ON cp.id = ucp.program_id
      LEFT JOIN class_packages pkg ON pkg.id = ucp.package_id
      WHERE ${Prisma.join(conditions, ' AND ')}
        AND cp.status = 'published'
      GROUP BY ucp.provider_id, ucp.program_id, cp.title
      ORDER BY MIN(ucp.expires_at) ASC NULLS LAST, MIN(ucp.created_at) ASC
    `;
  }
}
