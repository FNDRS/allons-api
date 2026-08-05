/**
 * Seeds the edge cases the happy-path demo data leaves untested: past, ended,
 * sold-out and draft events, multi-tier ticketing, a last-remaining spot, all
 * four home cities, comercios of every shape (events only / classes only /
 * both / empty), every class-package combination, and a client wallet holding
 * usable, depleted and expired passes at once.
 *
 * Additive and idempotent: never deletes, and skips anything already present
 * (events and programs keyed by provider + title, passes by user + program +
 * credit shape, reservations by user + occurrence). Safe to re-run and safe to
 * run on top of a fresh start.
 *
 * The existing gyms get one event each on purpose: a comercio whose only
 * content is class programs is currently unreachable in the client app — the
 * profile is linked only from an event, an already-followed organizer, or the
 * checkout return — so without an event its classes cannot be opened at all.
 *
 * Env: DATABASE_URL
 *
 * Run: cd allons-api && pnpm exec prisma generate \
 *        && pnpm exec ts-node --transpile-only \
 *           prisma/scripts/seed-qa-edge-cases.ts
 */

import { PrismaClient } from '../../generated/prisma';

const prisma = new PrismaClient();

type TicketTypeSpec = {
  name: string;
  kind: 'general' | 'vip';
  price: number;
  total: number;
  soldCount: number;
};

type EventSpec = {
  title: string;
  description: string;
  /** Days from today; negative seeds a past event. */
  startsInDays: number;
  startHour: number;
  durationHours: number;
  city: string;
  venue: string;
  address: string;
  themeColor: string;
  status: 'published' | 'draft' | 'sold_out' | 'ended';
  capacity: number;
  minAge?: number;
  petFriendly?: boolean;
  parkingAvailable?: boolean;
  interests: string[];
  ticketTypes: TicketTypeSpec[];
  /** Why this row exists; printed while seeding. */
  note: string;
};

type PackageSpec = {
  name: string;
  price: number;
  kind: 'drop_in' | 'pack' | 'unlimited';
  credits: number | null;
  validityDays: number | null;
};

type TemplateSpec = {
  weekday: number;
  startTime: string;
  durationMinutes: number | null;
  capacity: number | null;
  instructorName: string | null;
};

type ProgramSpec = {
  title: string;
  description: string;
  discipline: string;
  instructorName: string;
  durationMinutes: number;
  capacityPerSession: number;
  locationName: string;
  address: string;
  city: string;
  status: 'published' | 'draft';
  templates: TemplateSpec[];
  packages: PackageSpec[];
  note: string;
};

/** Weekly slot; capacity null falls back to the program's own value. */
const T = (
  weekday: number,
  startTime: string,
  capacity: number | null = null,
): TemplateSpec => ({
  weekday,
  startTime,
  durationMinutes: null,
  capacity,
  instructorName: null,
});

/**
 * Today's civil date in Honduras as YYYY-MM-DD. The availability endpoint
 * anchors its range to this same civil day, so reservations must be dated
 * against it and not against the machine's UTC date: between 18:00 and
 * midnight local the two disagree by a day.
 */
function civilToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Tegucigalpa',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function isoDay(offsetDays: number): string {
  const d = new Date(`${civilToday()}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/**
 * Next civil date (today included) whose weekday matches, as YYYY-MM-DD.
 * Walks midnight-UTC dates and reads `getUTCDay()`, exactly how the
 * availability endpoint derives an occurrence's weekday — comparing a local
 * `getDay()` against a UTC-formatted date silently shifts by one day.
 */
function nextDateForWeekday(weekday: number): string {
  const d = new Date(`${civilToday()}T00:00:00.000Z`);
  for (let i = 0; i < 8; i += 1) {
    if (d.getUTCDay() === weekday) break;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d.toISOString().slice(0, 10);
}

function timestamp(offsetDays: number, hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, 0, 0, 0);
  return d;
}

async function ensureProvider(
  name: string,
  handle: string,
  description: string,
): Promise<string> {
  const provider = await prisma.provider.upsert({
    where: { handle },
    update: {},
    create: { name, handle, description, websiteUrl: 'https://allonsapp.com' },
  });
  return provider.id;
}

async function findProviderIdByHandle(handle: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id::text AS id FROM providers WHERE handle = ${handle} LIMIT 1`;
  return rows[0]?.id ?? null;
}

async function interestIdsBySlug(slugs: string[]): Promise<string[]> {
  if (slugs.length === 0) return [];
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id::text AS id FROM interests WHERE slug = ANY(${slugs})`;
  return rows.map((r) => r.id);
}

async function ensureEvent(providerId: string, spec: EventSpec): Promise<void> {
  const existing = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id::text AS id FROM events
    WHERE provider_id = ${providerId}::uuid AND title = ${spec.title} LIMIT 1`;
  if (existing[0]) {
    console.log(`  omitido evento: ${spec.title}`);
    return;
  }

  const startsAt = timestamp(spec.startsInDays, spec.startHour);
  const endsAt = new Date(startsAt.getTime() + spec.durationHours * 3_600_000);
  const isFree = spec.ticketTypes.every((t) => t.price === 0);

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO events (
      provider_id, created_by, title, description, starts_at, ends_at,
      city, venue, address, theme_color, min_age, pet_friendly,
      parking_available, event_type, ticket_mode, capacity, status
    ) VALUES (
      ${providerId}::uuid, NULL, ${spec.title}, ${spec.description},
      ${startsAt}::timestamptz, ${endsAt}::timestamptz,
      ${spec.city}, ${spec.venue}, ${spec.address}, ${spec.themeColor},
      ${spec.minAge ?? null}, ${spec.petFriendly ?? false},
      ${spec.parkingAvailable ?? false}, 'single',
      ${isFree ? 'free' : 'single_access'}, ${spec.capacity}, ${spec.status}
    )
    RETURNING id::text AS id`;
  const eventId = rows[0].id;

  for (const interestId of await interestIdsBySlug(spec.interests)) {
    await prisma.$executeRaw`
      INSERT INTO event_interests (event_id, interest_id)
      VALUES (${eventId}::uuid, ${interestId}::uuid)
      ON CONFLICT DO NOTHING`;
  }

  for (const tt of spec.ticketTypes) {
    await prisma.$executeRaw`
      INSERT INTO provider_event_ticket_types
        (provider_id, event_id, name, kind, price, total, sold_count, active, updated_at)
      VALUES (${providerId}::uuid, ${eventId}::uuid, ${tt.name}, ${tt.kind},
              ${tt.price}, ${tt.total}, ${tt.soldCount}, true, now())`;
  }

  console.log(`  creado evento: ${spec.title}  [${spec.note}]`);
}

async function ensureProgram(
  providerId: string,
  spec: ProgramSpec,
): Promise<string> {
  const existing = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id::text AS id FROM class_programs
    WHERE provider_id = ${providerId}::uuid AND title = ${spec.title} LIMIT 1`;
  if (existing[0]) {
    console.log(`  omitido programa: ${spec.title}`);
    return existing[0].id;
  }

  // Generous timeout: each statement is a round trip to a remote database, and
  // a program inserts its templates and packages one at a time, which blows
  // past Prisma's 5s interactive-transaction default over a slow link.
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO class_programs (
        provider_id, title, description, discipline, instructor_name,
        duration_minutes, capacity_per_session, location_name, address, city,
        latitude, longitude, cover_image_url, theme_color, status
      ) VALUES (
        ${providerId}::uuid, ${spec.title}, ${spec.description},
        ${spec.discipline}, ${spec.instructorName}, ${spec.durationMinutes},
        ${spec.capacityPerSession}, ${spec.locationName}, ${spec.address},
        ${spec.city}, NULL, NULL, NULL, NULL, ${spec.status}
      )
      RETURNING id::text AS id`;
    const programId = rows[0].id;

    for (const t of spec.templates) {
      await tx.$executeRaw`
        INSERT INTO class_session_templates (
          program_id, weekday, start_time, duration_minutes, capacity,
          instructor_name, active
        ) VALUES (
          ${programId}::uuid, ${t.weekday}, ${t.startTime}::time,
          ${t.durationMinutes}, ${t.capacity}, ${t.instructorName}, true
        )`;
    }

    let sortOrder = 0;
    for (const p of spec.packages) {
      await tx.$executeRaw`
        INSERT INTO class_packages (
          program_id, name, price, credits, validity_days, kind, active, sort_order
        ) VALUES (
          ${programId}::uuid, ${p.name}, ${p.price}, ${p.credits},
          ${p.validityDays}, ${p.kind}, true, ${sortOrder}
        )`;
      sortOrder += 1;
    }

    console.log(`  creado programa: ${spec.title}  [${spec.note}]`);
    return programId;
  }, { timeout: 60_000, maxWait: 15_000 });
}

/** Grants a pass. `expiresInDays` may be negative to seed an expired one. */
async function ensurePass(
  userId: string,
  providerId: string,
  programId: string,
  opts: {
    creditsTotal: number | null;
    creditsRemaining: number | null;
    expiresInDays: number | null;
    note: string;
  },
): Promise<void> {
  const existing = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id::text AS id FROM user_class_passes
    WHERE user_id = ${userId}::uuid AND program_id = ${programId}::uuid
      AND credits_total IS NOT DISTINCT FROM ${opts.creditsTotal}
      AND credits_remaining IS NOT DISTINCT FROM ${opts.creditsRemaining}
    LIMIT 1`;
  if (existing[0]) {
    console.log(`  omitido pase: ${opts.note}`);
    return;
  }

  const expiresAt =
    opts.expiresInDays === null ? null : timestamp(opts.expiresInDays, 23);
  await prisma.$executeRaw`
    INSERT INTO user_class_passes (
      user_id, provider_id, program_id, package_id, payment_order_id,
      credits_total, credits_remaining, valid_from, expires_at, status
    ) VALUES (
      ${userId}::uuid, ${providerId}::uuid, ${programId}::uuid, NULL, NULL,
      ${opts.creditsTotal}, ${opts.creditsRemaining}, now(),
      ${expiresAt}::timestamptz, 'active'
    )`;
  console.log(`  creado pase: ${opts.note}`);
}

async function ensureReservation(
  userId: string,
  providerId: string,
  programId: string,
  weekday: number,
  startTime: string,
  durationMinutes: number,
  note: string,
): Promise<void> {
  const sessionDate = nextDateForWeekday(weekday);
  const existing = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id::text AS id FROM class_session_reservations
    WHERE user_id = ${userId}::uuid AND program_id = ${programId}::uuid
      AND session_date = ${sessionDate}::date
      AND start_time = ${startTime}::time AND status = 'reserved'
    LIMIT 1`;
  if (existing[0]) {
    console.log(`  omitida reserva: ${note}`);
    return;
  }

  const template = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id::text AS id FROM class_session_templates
    WHERE program_id = ${programId}::uuid AND weekday = ${weekday}
      AND start_time = ${startTime}::time
    LIMIT 1`;
  await prisma.$executeRaw`
    INSERT INTO class_session_reservations (
      user_id, provider_id, program_id, template_id, pass_id,
      session_date, start_time, duration_minutes, instructor_name, status
    ) VALUES (
      ${userId}::uuid, ${providerId}::uuid, ${programId}::uuid,
      ${template[0]?.id ?? null}::uuid, NULL,
      ${sessionDate}::date, ${startTime}::time, ${durationMinutes}, NULL, 'reserved'
    )`;
  console.log(`  creada reserva: ${note} (${sessionDate} ${startTime})`);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL es obligatorio.');

  // 1. Los gimnasios existentes no tienen eventos, y sin un evento su perfil
  //    no se puede abrir desde la app, asi que sus clases son inalcanzables.
  console.log('\n[1] eventos para los gimnasios existentes (los hace alcanzables)');
  const gymEvents: Array<[string, EventSpec]> = [
    ['erei-wellness', {
      title: 'Erei Open House',
      description: 'Clase abierta gratuita para conocer el estudio.',
      startsInDays: 3, startHour: 9, durationHours: 2,
      city: 'Tegucigalpa', venue: 'Erei Wellness',
      address: 'Col. Palmira, Tegucigalpa', themeColor: '#F67010',
      status: 'published', capacity: 30, parkingAvailable: true,
      interests: ['fitness-y-entrenamiento'],
      ticketTypes: [{ name: 'Entrada libre', kind: 'general', price: 0, total: 30, soldCount: 0 }],
      note: 'gratis; abre el perfil con clases',
    }],
    ['reformer-studio-sps', {
      title: 'Masterclass de Reformer',
      description: 'Sesión especial de 90 minutos con cupo reducido.',
      startsInDays: 6, startHour: 10, durationHours: 2,
      city: 'San Pedro Sula', venue: 'Reformer Studio SPS',
      address: 'Col. Trejo, San Pedro Sula', themeColor: '#2EC4B6',
      status: 'published', capacity: 10, minAge: 16,
      interests: ['fitness-y-entrenamiento'],
      ticketTypes: [{ name: 'Cupo masterclass', kind: 'general', price: 550, total: 10, soldCount: 9 }],
      note: 'ULTIMO CUPO (9/10 vendidos)',
    }],
    ['rava-studio', {
      title: 'RAVA Retiro de movilidad',
      description: 'Jornada de movilidad y respiración al aire libre.',
      startsInDays: 12, startHour: 7, durationHours: 4,
      city: 'Tegucigalpa', venue: 'RAVA Studio',
      address: 'Col. Kennedy, Tegucigalpa', themeColor: '#7209B7',
      status: 'published', capacity: 25, petFriendly: true,
      interests: ['fitness-y-entrenamiento'],
      ticketTypes: [
        { name: 'General', kind: 'general', price: 400, total: 20, soldCount: 3 },
        { name: 'VIP (incluye kit)', kind: 'vip', price: 900, total: 5, soldCount: 1 },
      ],
      note: 'DOS TIPOS DE TICKET (general + VIP)',
    }],
  ];
  for (const [handle, spec] of gymEvents) {
    const providerId = await findProviderIdByHandle(handle);
    if (!providerId) {
      console.log(`  saltado: no existe el comercio ${handle}`);
      continue;
    }
    await ensureEvent(providerId, spec);
  }

  // 2. Estados de evento que la data feliz no cubre.
  console.log('\n[2] eventos de casos borde');
  const edgeId = await ensureProvider(
    'Eventos Catrachos',
    'eventos-catrachos',
    'Productora con eventos en todo el país: pasados, agotados y de última hora.',
  );
  const edgeEvents: EventSpec[] = [
    {
      title: 'Festival de invierno pasado',
      description: 'Edición ya realizada. Sirve para la pestaña de eventos pasados.',
      startsInDays: -45, startHour: 18, durationHours: 5,
      city: 'Tegucigalpa', venue: 'Explanada Los Próceres',
      address: 'Bulevar Morazán, Tegucigalpa', themeColor: '#118AB2',
      status: 'published', capacity: 400,
      interests: ['conciertos', 'musica'],
      ticketTypes: [{ name: 'Entrada general', kind: 'general', price: 350, total: 400, soldCount: 380 }],
      note: 'PASADO (hace 45 dias)',
    },
    {
      title: 'Torneo de gaming clausurado',
      description: 'Evento marcado como finalizado.',
      startsInDays: -10, startHour: 14, durationHours: 6,
      city: 'San Pedro Sula', venue: 'Centro de Convenciones SPS',
      address: 'Av. Circunvalación, San Pedro Sula', themeColor: '#E63946',
      status: 'ended', capacity: 120,
      interests: ['gaming-y-e-sports'],
      ticketTypes: [{ name: 'Competidor', kind: 'general', price: 200, total: 120, soldCount: 118 }],
      note: 'STATUS ended',
    },
    {
      title: 'Concierto agotado: Café Guancasco',
      description: 'Sin entradas disponibles.',
      startsInDays: 9, startHour: 20, durationHours: 3,
      city: 'Tegucigalpa', venue: 'Teatro Manuel Bonilla',
      address: 'Av. Miguel Paz Barahona, Tegucigalpa', themeColor: '#F67010',
      status: 'sold_out', capacity: 150,
      interests: ['conciertos', 'musica'],
      ticketTypes: [{ name: 'Entrada general', kind: 'general', price: 500, total: 150, soldCount: 150 }],
      note: 'AGOTADO (sold_out, 150/150)',
    },
    {
      title: 'Cena maridaje en borrador',
      description: 'Borrador: no debe verse en la app del cliente.',
      startsInDays: 20, startHour: 19, durationHours: 3,
      city: 'Tegucigalpa', venue: 'Restaurante El Patio',
      address: 'Col. Palmira, Tegucigalpa', themeColor: '#8D6E63',
      status: 'draft', capacity: 40, minAge: 18,
      interests: ['comidas', 'catas-de-vino-o-cerveza'],
      ticketTypes: [{ name: 'Cubierto', kind: 'general', price: 1200, total: 40, soldCount: 0 }],
      note: 'BORRADOR (no debe aparecer al cliente)',
    },
    {
      title: 'Noche garífuna en La Ceiba',
      description: 'Tambores, punta y gastronomía costeña.',
      startsInDays: 5, startHour: 19, durationHours: 4,
      city: 'La Ceiba', venue: 'Parque Central La Ceiba',
      address: 'Av. San Isidro, La Ceiba', themeColor: '#06D6A0',
      status: 'published', capacity: 300, petFriendly: true, parkingAvailable: true,
      interests: ['festivales-culturales', 'baile', 'musica'],
      ticketTypes: [{ name: 'Entrada libre', kind: 'general', price: 0, total: 300, soldCount: 42 }],
      note: 'CIUDAD La Ceiba (filtro)',
    },
    {
      title: 'Feria del maíz en Comayagua',
      description: 'Muestra gastronómica y artesanal del valle.',
      startsInDays: 14, startHour: 10, durationHours: 8,
      city: 'Comayagua', venue: 'Plaza La Merced',
      address: 'Centro histórico, Comayagua', themeColor: '#FFB703',
      status: 'published', capacity: 500, petFriendly: true,
      interests: ['festivales-gastronomicos', 'comidas'],
      ticketTypes: [{ name: 'Entrada libre', kind: 'general', price: 0, total: 500, soldCount: 0 }],
      note: 'CIUDAD Comayagua (filtro)',
    },
    {
      title: 'Stand up comedy de hoy',
      description: 'Show de esta noche.',
      startsInDays: 0, startHour: 21, durationHours: 2,
      city: 'Tegucigalpa', venue: 'Bar La Cumbre',
      address: 'Col. Palmira, Tegucigalpa', themeColor: '#7209B7',
      status: 'published', capacity: 60, minAge: 18,
      interests: ['bares-and-drinks'],
      ticketTypes: [{ name: 'Entrada general', kind: 'general', price: 250, total: 60, soldCount: 31 }],
      note: 'ES HOY',
    },
  ];
  for (const spec of edgeEvents) await ensureEvent(edgeId, spec);

  // 3. Comercio con eventos Y clases, con dos programas: ejercita el selector
  //    de programas del tab Clases.
  console.log('\n[3] comercio mixto: eventos + 2 programas');
  const mixtoId = await ensureProvider(
    'Studio Mixto HN',
    'studio-mixto-hn',
    'Estudio con clases recurrentes y eventos especiales en Tegucigalpa.',
  );
  await ensureEvent(mixtoId, {
    title: 'Aniversario Studio Mixto',
    description: 'Fiesta de aniversario con clases demo y música en vivo.',
    startsInDays: 8, startHour: 17, durationHours: 5,
    city: 'Tegucigalpa', venue: 'Studio Mixto HN',
    address: 'Col. Las Minitas, Tegucigalpa', themeColor: '#2EC4B6',
    status: 'published', capacity: 80, parkingAvailable: true,
    interests: ['fitness-y-entrenamiento', 'musica'],
    ticketTypes: [{ name: 'Entrada general', kind: 'general', price: 200, total: 80, soldCount: 12 }],
    note: 'comercio con eventos Y clases',
  });
  const packOnlyId = await ensureProgram(mixtoId, {
    title: 'Barre Intensivo',
    description: 'Solo se vende por paquete de sesiones.',
    discipline: 'Barre', instructorName: 'Lucía Ramos',
    durationMinutes: 55, capacityPerSession: 10,
    locationName: 'Studio Mixto HN', address: 'Col. Las Minitas, Tegucigalpa',
    city: 'Tegucigalpa', status: 'published',
    templates: [T(1, '07:00'), T(3, '07:00'), T(5, '07:00')],
    packages: [
      { name: 'Pack 4 sesiones', price: 900, kind: 'pack', credits: 4, validityDays: 30 },
      { name: 'Pack 12 sesiones', price: 2400, kind: 'pack', credits: 12, validityDays: 90 },
    ],
    note: 'SOLO PAQUETES (sin entrada suelta)',
  });
  const dropInOnlyId = await ensureProgram(mixtoId, {
    title: 'Yoga Suave',
    description: 'Solo entrada suelta, sin paquetes.',
    discipline: 'Yoga', instructorName: 'Marta Cruz',
    durationMinutes: 60, capacityPerSession: 14,
    locationName: 'Studio Mixto HN', address: 'Col. Las Minitas, Tegucigalpa',
    city: 'Tegucigalpa', status: 'published',
    templates: [T(2, '18:30'), T(4, '18:30'), T(6, '08:00')],
    packages: [
      { name: 'Entrada suelta', price: 180, kind: 'drop_in', credits: 1, validityDays: null },
    ],
    note: 'SOLO ENTRADA SUELTA',
  });

  // 4. Gimnasio en La Ceiba: solo ilimitado, cupo minimo y un borrador.
  console.log('\n[4] gimnasio en La Ceiba: ilimitado, cupo 2 y programa borrador');
  const ceibaId = await ensureProvider(
    'Box Ceiba Fit',
    'box-ceiba-fit',
    'Box de entrenamiento en La Ceiba con pases ilimitados.',
  );
  await ensureEvent(ceibaId, {
    title: 'Reto Box Ceiba',
    description: 'Competencia interna abierta al público.',
    startsInDays: 11, startHour: 8, durationHours: 5,
    city: 'La Ceiba', venue: 'Box Ceiba Fit',
    address: 'Barrio El Iman, La Ceiba', themeColor: '#E63946',
    status: 'published', capacity: 50,
    interests: ['fitness-y-entrenamiento', 'partidos-y-torneos'],
    ticketTypes: [{ name: 'Competidor', kind: 'general', price: 300, total: 50, soldCount: 8 }],
    note: 'abre el gimnasio de La Ceiba',
  });
  await ensureProgram(ceibaId, {
    title: 'Box Ilimitado',
    description: 'Solo pase ilimitado.',
    discipline: 'Funcional', instructorName: 'Carlos Mejía',
    durationMinutes: 60, capacityPerSession: 18,
    locationName: 'Box Ceiba Fit', address: 'Barrio El Iman, La Ceiba',
    city: 'La Ceiba', status: 'published',
    templates: [T(1, '06:00'), T(2, '06:00'), T(3, '06:00'), T(4, '06:00'), T(5, '06:00')],
    packages: [
      { name: 'Ilimitado mensual', price: 1400, kind: 'unlimited', credits: null, validityDays: 30 },
      { name: 'Ilimitado trimestral', price: 3600, kind: 'unlimited', credits: null, validityDays: 90 },
    ],
    note: 'SOLO ILIMITADO',
  });
  const unlimitedProgramId = await prisma
    .$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id FROM class_programs
      WHERE provider_id = ${ceibaId}::uuid AND title = 'Box Ilimitado' LIMIT 1`
    .then((r) => r[0].id);
  const tinyCapacityId = await ensureProgram(ceibaId, {
    title: 'Personal Duo',
    description: 'Sesiones de dos personas: se llena rápido, ideal para probar "sin cupos".',
    discipline: 'Personalizado', instructorName: 'Carlos Mejía',
    durationMinutes: 45, capacityPerSession: 2,
    locationName: 'Box Ceiba Fit', address: 'Barrio El Iman, La Ceiba',
    city: 'La Ceiba', status: 'published',
    templates: [T(1, '17:00'), T(3, '17:00'), T(5, '17:00')],
    packages: [
      { name: 'Entrada suelta', price: 600, kind: 'drop_in', credits: 1, validityDays: null },
      { name: 'Pack 4 sesiones', price: 2200, kind: 'pack', credits: 4, validityDays: 60 },
    ],
    note: 'CUPO 2 (para agotar una ocurrencia)',
  });
  await ensureProgram(ceibaId, {
    title: 'Spinning en borrador',
    description: 'Borrador: no debe aparecer en el perfil público.',
    discipline: 'Spinning', instructorName: 'Ana Portillo',
    durationMinutes: 45, capacityPerSession: 20,
    locationName: 'Box Ceiba Fit', address: 'Barrio El Iman, La Ceiba',
    city: 'La Ceiba', status: 'draft',
    templates: [T(2, '19:00'), T(4, '19:00')],
    packages: [
      { name: 'Entrada suelta', price: 200, kind: 'drop_in', credits: 1, validityDays: null },
    ],
    note: 'BORRADOR (no debe verse publicamente)',
  });

  // 5. Comercio sin contenido: estados vacios del perfil.
  console.log('\n[5] comercio sin contenido (estados vacios)');
  await ensureProvider(
    'Comercio Recién Creado',
    'comercio-recien-creado',
    'Comercio sin eventos ni clases: sirve para ver los estados vacíos del perfil.',
  );
  console.log('  listo (sin eventos ni programas, a proposito)');

  // 6. Billetera del cliente: usable, agotado y vencido a la vez, mas una
  //    reserva para el caso "ya reservaste".
  console.log('\n[6] billetera de clases del cliente de prueba');
  const clientRows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT user_id::text AS id FROM profiles
    WHERE username = 'marlon.cliente' OR full_name = 'Marlon Cliente' LIMIT 1`;
  const clientId = clientRows[0]?.id ?? null;

  if (!clientId) {
    console.log('  saltado: no se encontro el perfil del cliente de prueba');
  } else {
    await ensurePass(clientId, mixtoId, packOnlyId, {
      creditsTotal: 12, creditsRemaining: 5, expiresInDays: 60,
      note: 'USABLE 5/12 (Barre Intensivo)',
    });
    await ensurePass(clientId, ceibaId, unlimitedProgramId, {
      creditsTotal: null, creditsRemaining: null, expiresInDays: 25,
      note: 'ILIMITADO vigente (Box Ilimitado)',
    });
    await ensurePass(clientId, ceibaId, tinyCapacityId, {
      creditsTotal: 4, creditsRemaining: 1, expiresInDays: 40,
      note: 'ULTIMO CREDITO 1/4 (Personal Duo)',
    });
    await ensurePass(clientId, mixtoId, dropInOnlyId, {
      creditsTotal: 1, creditsRemaining: 0, expiresInDays: 30,
      note: 'AGOTADO 0/1 (no debe aparecer)',
    });
    await ensurePass(clientId, ceibaId, unlimitedProgramId, {
      creditsTotal: 8, creditsRemaining: 8, expiresInDays: -3,
      note: 'VENCIDO hace 3 dias (no debe aparecer ni sumar)',
    });
    await ensureReservation(
      clientId, mixtoId, packOnlyId, 1, '07:00', 55,
      'ya reservaste (Barre Intensivo, lunes 07:00)',
    );
  }

  // 7. Agotar una ocurrencia de Personal Duo (cupo 2) con dos reservas
  //    de otros usuarios, para ver "Sin cupos".
  console.log('\n[7] ocurrencia agotada (Personal Duo, cupo 2)');
  const fillers = await prisma.$queryRaw<Array<{ id: string; full_name: string }>>`
    SELECT user_id::text AS id, full_name FROM profiles
    WHERE username IN ('marlon.amigo', 'allons.reviewer') LIMIT 2`;
  if (fillers.length < 2) {
    console.log('  saltado: no hay suficientes perfiles para llenar el cupo');
  } else {
    for (const f of fillers) {
      await ensureReservation(
        f.id, ceibaId, tinyCapacityId, 3, '17:00', 45,
        `relleno de cupo por ${f.full_name}`,
      );
    }
  }

  console.log('\n=== resumen ===');
  const summary = await prisma.$queryRaw<
    Array<{ name: string; events: number; programs: number }>
  >`
    SELECT p.name,
      (SELECT count(*)::int FROM events e WHERE e.provider_id = p.id) AS events,
      (SELECT count(*)::int FROM class_programs c WHERE c.provider_id = p.id) AS programs
    FROM providers p ORDER BY p.name`;
  summary.forEach((s) =>
    console.log(`  ${s.name.padEnd(26)} eventos=${s.events} programas=${s.programs}`),
  );
  const [{ passes }] = await prisma.$queryRaw<Array<{ passes: number }>>`
    SELECT count(*)::int AS passes FROM user_class_passes`;
  const [{ res }] = await prisma.$queryRaw<Array<{ res: number }>>`
    SELECT count(*)::int AS res FROM class_session_reservations WHERE status = 'reserved'`;
  console.log(`  pases: ${passes}   reservas activas: ${res}   (hoy = ${isoDay(0)})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
