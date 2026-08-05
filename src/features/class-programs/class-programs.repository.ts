import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  ClassPackagePaymentRow,
  ClassPassFilters,
  ClassPassRow,
  DiscoveryProgramRow,
  PackagePayload,
  PackageRow,
  PackageUpdatePayload,
  ProgramMetricsRow,
  ProgramPayload,
  ProgramRow,
  ProgramUpdatePayload,
  ReservationCancelResult,
  ReservationCountRow,
  ReservationCreateResult,
  ReservationPayload,
  ReservationRow,
  TemplatePayload,
  TemplateRow,
  TemplateUpdatePayload,
  UserReservationRow,
  UserReservedOccurrenceRow,
} from './class-programs.types';

/**
 * "Now" on Honduras' civil clock, as a naive timestamp.
 *
 * A session is stored as `session_date + start_time`: local wall time with no
 * zone. The Postgres session runs in UTC, so comparing that against a bare
 * `now()` reads a 07:00 class as 07:00 UTC — six hours early, which silently
 * drops the last six hours of bookings out of "upcoming". Every comparison
 * against a session's own clock goes through this.
 */
const NOW_HN = Prisma.sql`(now() AT TIME ZONE 'America/Tegucigalpa')`;

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

  /**
   * Published programs across every comercio, for the client discovery feed.
   *
   * Requires at least one active schedule and one active package: a program
   * missing either cannot be booked or bought, so surfacing it would only
   * produce a dead card. Comercios whose sole content is classes have no other
   * way into the app, which is what this listing exists to solve.
   */
  listPublishedPrograms(options: {
    cities: string[];
    limit: number;
    q?: string;
  }) {
    const cityFilter =
      options.cities.length > 0
        ? Prisma.sql`AND lower(cp.city) = ANY(${options.cities.map((c) =>
            c.toLowerCase(),
          )})`
        : Prisma.empty;
    // Matches what a person would type: the class, its discipline, who teaches
    // it, where it is, or the comercio's name.
    const term = options.q?.trim();
    const search = term
      ? Prisma.sql`AND (
          cp.title ILIKE ${'%' + term + '%'}
          OR cp.description ILIKE ${'%' + term + '%'}
          OR cp.discipline ILIKE ${'%' + term + '%'}
          OR cp.instructor_name ILIKE ${'%' + term + '%'}
          OR cp.location_name ILIKE ${'%' + term + '%'}
          OR cp.city ILIKE ${'%' + term + '%'}
          OR p.name ILIKE ${'%' + term + '%'}
        )`
      : Prisma.empty;

    return this.prisma.$queryRaw<DiscoveryProgramRow[]>`
      SELECT cp.*,
             p.name AS provider_name,
             p.handle AS provider_handle,
             p.logo_url AS provider_logo_url
      FROM class_programs cp
      JOIN providers p ON p.id = cp.provider_id
      WHERE cp.status = 'published'
        ${cityFilter}
        ${search}
        AND EXISTS (
          SELECT 1 FROM class_session_templates t
          WHERE t.program_id = cp.id AND t.active = true
        )
        AND EXISTS (
          SELECT 1 FROM class_packages k
          WHERE k.program_id = cp.id AND k.active = true
        )
      ORDER BY cp.created_at DESC
      LIMIT ${options.limit}
    `;
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

  /** The program a template belongs to, scoped to the caller's provider — used to authorize PATCH/DELETE by template id alone (no programId in that route). */
  async findProviderProgramIdForTemplate(
    providerId: string,
    templateId: string,
  ) {
    const rows = await this.prisma.$queryRaw<Array<{ program_id: string }>>`
      SELECT t.program_id
      FROM class_session_templates t
      JOIN class_programs p ON p.id = t.program_id
      WHERE t.id = ${templateId}::uuid
        AND p.provider_id = ${providerId}::uuid
      LIMIT 1
    `;
    return rows[0]?.program_id ?? null;
  }

  /** Same as above, for a package id. */
  async findProviderProgramIdForPackage(providerId: string, packageId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ program_id: string }>>`
      SELECT c.program_id
      FROM class_packages c
      JOIN class_programs p ON p.id = c.program_id
      WHERE c.id = ${packageId}::uuid
        AND p.provider_id = ${providerId}::uuid
      LIMIT 1
    `;
    return rows[0]?.program_id ?? null;
  }

  async updateProgram(programId: string, payload: ProgramUpdatePayload) {
    const rows = await this.prisma.$queryRaw<ProgramRow[]>`
      UPDATE class_programs
      SET
        title = COALESCE(${payload.title}, title),
        description = CASE WHEN ${payload.description !== undefined} THEN ${payload.description ?? null} ELSE description END,
        discipline = CASE WHEN ${payload.discipline !== undefined} THEN ${payload.discipline ?? null} ELSE discipline END,
        instructor_name = CASE WHEN ${payload.instructorName !== undefined} THEN ${payload.instructorName ?? null} ELSE instructor_name END,
        duration_minutes = COALESCE(${payload.durationMinutes}, duration_minutes),
        capacity_per_session = COALESCE(${payload.capacityPerSession}, capacity_per_session),
        location_name = CASE WHEN ${payload.locationName !== undefined} THEN ${payload.locationName ?? null} ELSE location_name END,
        address = CASE WHEN ${payload.address !== undefined} THEN ${payload.address ?? null} ELSE address END,
        city = CASE WHEN ${payload.city !== undefined} THEN ${payload.city ?? null} ELSE city END,
        latitude = CASE WHEN ${payload.latitude !== undefined} THEN ${payload.latitude ?? null} ELSE latitude END,
        longitude = CASE WHEN ${payload.longitude !== undefined} THEN ${payload.longitude ?? null} ELSE longitude END,
        cover_image_url = CASE WHEN ${payload.coverImageUrl !== undefined} THEN ${payload.coverImageUrl ?? null} ELSE cover_image_url END,
        theme_color = CASE WHEN ${payload.themeColor !== undefined} THEN ${payload.themeColor ?? null} ELSE theme_color END,
        status = COALESCE(${payload.status}, status),
        updated_at = now()
      WHERE id = ${programId}::uuid
      RETURNING *
    `;
    return rows[0] ?? null;
  }

  async updateTemplate(templateId: string, payload: TemplateUpdatePayload) {
    const rows = await this.prisma.$queryRaw<TemplateRow[]>`
      UPDATE class_session_templates
      SET
        weekday = COALESCE(${payload.weekday}, weekday),
        start_time = COALESCE(${payload.startTime}::time, start_time),
        duration_minutes = CASE WHEN ${payload.durationMinutes !== undefined} THEN ${payload.durationMinutes ?? null} ELSE duration_minutes END,
        capacity = CASE WHEN ${payload.capacity !== undefined} THEN ${payload.capacity ?? null} ELSE capacity END,
        instructor_name = CASE WHEN ${payload.instructorName !== undefined} THEN ${payload.instructorName ?? null} ELSE instructor_name END,
        active = COALESCE(${payload.active}, active),
        updated_at = now()
      WHERE id = ${templateId}::uuid
      RETURNING id, program_id, weekday, to_char(start_time, 'HH24:MI') AS start_time,
        duration_minutes, capacity, instructor_name, active
    `;
    return rows[0] ?? null;
  }

  async deactivateTemplate(templateId: string) {
    await this.prisma.$executeRaw`
      UPDATE class_session_templates
      SET active = false, updated_at = now()
      WHERE id = ${templateId}::uuid
    `;
  }

  async updatePackage(packageId: string, payload: PackageUpdatePayload) {
    const rows = await this.prisma.$queryRaw<PackageRow[]>`
      UPDATE class_packages
      SET
        name = COALESCE(${payload.name}, name),
        price = COALESCE(${payload.price}, price),
        sort_order = COALESCE(${payload.sortOrder}, sort_order),
        active = COALESCE(${payload.active}, active),
        kind = COALESCE(${payload.plan?.kind}, kind),
        credits = CASE WHEN ${payload.plan !== undefined} THEN ${payload.plan?.credits ?? null} ELSE credits END,
        validity_days = CASE WHEN ${payload.plan !== undefined} THEN ${payload.plan?.validityDays ?? null} ELSE validity_days END,
        updated_at = now()
      WHERE id = ${packageId}::uuid
      RETURNING id, program_id, name, price::float8 AS price, credits,
        validity_days, kind, active, sort_order
    `;
    return rows[0] ?? null;
  }

  async deactivatePackage(packageId: string) {
    await this.prisma.$executeRaw`
      UPDATE class_packages
      SET active = false, updated_at = now()
      WHERE id = ${packageId}::uuid
    `;
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

  /**
   * Batch metrics for the provider's program list. A program with no sales
   * yet still gets a zeroed row (via the `ids` CTE + LEFT JOINs), so callers
   * don't have to special-case "missing" vs "zero".
   */
  getProgramMetrics(programIds: string[]): Promise<ProgramMetricsRow[]> {
    if (programIds.length === 0) return Promise.resolve([]);
    // Each row needs its own parens — VALUES ($1::uuid, $2::uuid) would be one
    // row of two columns, not two rows of one; VALUES ($1::uuid), ($2::uuid)
    // is what actually produces one row per id.
    const ids = Prisma.join(programIds.map((id) => Prisma.sql`(${id}::uuid)`));
    return this.prisma.$queryRaw<ProgramMetricsRow[]>`
      WITH ids AS (
        SELECT * FROM (VALUES ${ids}) AS v(program_id)
      ),
      reservation_stats AS (
        SELECT program_id,
          count(*) FILTER (WHERE status = 'reserved') AS sold_sessions,
          count(*) FILTER (
            WHERE status = 'reserved'
              AND (session_date + start_time) > (now() AT TIME ZONE 'America/Tegucigalpa')
          ) AS upcoming_reservations
        FROM class_session_reservations
        WHERE program_id IN (SELECT program_id FROM ids)
        GROUP BY program_id
      ),
      occupancy_stats AS (
        SELECT program_id, avg(reserved_count::float8 / NULLIF(capacity, 0)) AS avg_occupancy
        FROM (
          SELECT r.program_id, r.session_date, r.start_time, r.template_id,
            count(*) AS reserved_count,
            COALESCE(t.capacity, p.capacity_per_session) AS capacity
          FROM class_session_reservations r
          JOIN class_programs p ON p.id = r.program_id
          LEFT JOIN class_session_templates t ON t.id = r.template_id
          WHERE r.status = 'reserved'
            AND r.program_id IN (SELECT program_id FROM ids)
          GROUP BY r.program_id, r.session_date, r.start_time, r.template_id, t.capacity, p.capacity_per_session
        ) occ
        GROUP BY program_id
      ),
      revenue_stats AS (
        SELECT class_program_id AS program_id, sum(amount_cents)::bigint AS revenue_cents
        FROM payment_orders
        WHERE order_type = 'class_package'
          AND status = 'paid'::payment_order_status
          AND class_program_id IN (SELECT program_id FROM ids)
        GROUP BY class_program_id
      )
      SELECT
        ids.program_id::text AS program_id,
        COALESCE(rs.sold_sessions, 0)::int AS sold_sessions,
        COALESCE(rs.upcoming_reservations, 0)::int AS upcoming_reservations,
        os.avg_occupancy AS avg_occupancy,
        COALESCE(rv.revenue_cents, 0)::bigint AS revenue_cents
      FROM ids
      LEFT JOIN reservation_stats rs ON rs.program_id = ids.program_id
      LEFT JOIN occupancy_stats os ON os.program_id = ids.program_id
      LEFT JOIN revenue_stats rv ON rv.program_id = ids.program_id
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

  /** Today's civil date in Honduras — the same "wall clock" every elapsed/refund check in this module anchors to. */
  async getCivilToday(): Promise<string> {
    const rows = await this.prisma.$queryRaw<Array<{ today: string }>>`
      SELECT (now() AT TIME ZONE 'America/Tegucigalpa')::date::text AS today
    `;
    const today = rows[0]?.today;
    if (!today) {
      throw new InternalServerErrorException(
        "getCivilToday: SELECT now() returned no rows — this can't happen on a healthy connection",
      );
    }
    return today;
  }

  getUserReservedOccurrences(
    programId: string,
    userId: string,
    from: string,
    to: string,
  ) {
    return this.prisma.$queryRaw<UserReservedOccurrenceRow[]>`
      SELECT session_date::text AS session_date,
        to_char(start_time, 'HH24:MI') AS start_time
      FROM class_session_reservations
      WHERE program_id = ${programId}::uuid
        AND user_id = ${userId}::uuid
        AND status = 'reserved'
        AND session_date BETWEEN ${from}::date AND ${to}::date
    `;
  }

  /**
   * The caller's class reservations, joined with the class and comercio so a
   * ticket can be rendered without a follow-up request per row.
   *
   * `scope` splits on the session's own start moment rather than on the date,
   * so a class earlier today reads as past while one later today is still
   * upcoming — a reservation is only over once its session has begun.
   */
  listUserReservations(
    userId: string,
    options: { scope: 'upcoming' | 'past' | 'all'; limit: number },
  ) {
    const startsAt = Prisma.sql`(r.session_date::date + r.start_time::time)`;
    const scopeFilter =
      options.scope === 'upcoming'
        ? Prisma.sql`AND ${startsAt} >= ${NOW_HN} AND r.status = 'reserved'`
        : options.scope === 'past'
          ? Prisma.sql`AND ${startsAt} < ${NOW_HN}`
          : Prisma.empty;
    const order =
      options.scope === 'past'
        ? Prisma.sql`ORDER BY ${startsAt} DESC`
        : Prisma.sql`ORDER BY ${startsAt} ASC`;

    return this.prisma.$queryRaw<UserReservationRow[]>`
      SELECT r.id::text AS id, r.user_id, r.provider_id, r.program_id,
             r.template_id, r.pass_id,
             to_char(r.session_date, 'YYYY-MM-DD') AS session_date,
             to_char(r.start_time, 'HH24:MI') AS start_time,
             r.duration_minutes, r.instructor_name, r.status, r.created_at,
             cp.title AS program_title,
             cp.city AS program_city,
             cp.location_name AS program_location_name,
             cp.theme_color,
             p.name AS provider_name,
             p.logo_url AS provider_logo_url
      FROM class_session_reservations r
      JOIN class_programs cp ON cp.id = r.program_id
      JOIN providers p ON p.id = cp.provider_id
      WHERE r.user_id = ${userId}::uuid
        ${scopeFilter}
      ${order}
      LIMIT ${options.limit}
    `;
  }

  /**
   * A pass this user already *claimed* for a package, i.e. one with no payment
   * order behind it. Scoped the same way as
   * `user_class_passes_free_claim_uidx`, so the check and the constraint that
   * backs it agree — buying the same package twice stays legitimate.
   */
  async findFreeClaimForPackage(userId: string, packageId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id FROM user_class_passes
      WHERE user_id = ${userId}::uuid AND package_id = ${packageId}::uuid
        AND payment_order_id IS NULL
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  /**
   * Grants a pass with no payment order behind it, for a free package.
   * `payment_order_id` stays null, which is what marks it as claimed rather
   * than purchased.
   */
  async createFreeClassPass(input: {
    userId: string;
    providerId: string;
    programId: string;
    packageId: string;
    creditsTotal: number | null;
    expiresAt: Date | null;
  }) {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO user_class_passes (
        user_id, provider_id, program_id, package_id, payment_order_id,
        credits_total, credits_remaining, valid_from, expires_at, status
      ) VALUES (
        ${input.userId}::uuid, ${input.providerId}::uuid,
        ${input.programId}::uuid, ${input.packageId}::uuid, NULL,
        ${input.creditsTotal}, ${input.creditsTotal}, now(),
        ${input.expiresAt}::timestamptz, 'active'
      )
      RETURNING id::text AS id
    `;
    return rows[0];
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
