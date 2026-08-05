/**
 * Wipes Allons application data and reseeds a clean demo dataset.
 *
 * Unlike dev-reset-seed.ts, this script PRESERVES every Supabase Auth user.
 * Only `public` app rows are deleted, so existing accounts survive and simply
 * go through onboarding again on their next sign-in.
 *
 * It also empties the `event-images` storage bucket and guarantees the three
 * App Review demo accounts exist.
 *
 * Env (all required to run):
 *   DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   ALLOW_DEV_DATABASE_RESET=yes
 *   DEV_SEED_PASSWORD=...      — password for the dev+* accounts
 *   REVIEW_SEED_PASSWORD=...   — password for the review.* App Review accounts
 *
 * Run: cd allons-api && pnpm db:seed:fresh-start
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { PrismaClient } from '../../generated/prisma';
import { seedClassProgramGyms } from './seed-class-program-gyms';

const prisma = new PrismaClient();

const STORAGE_BUCKET = 'event-images';

const EMAIL_CLIENTE = 'dev+cliente@allonsapp.com';
const EMAIL_COMERCIO = 'dev+comercio@allonsapp.com';
const EMAIL_STAFF = 'dev+staff@allonsapp.com';
const EMAIL_AMIGO = 'dev+amigo@allonsapp.com';
const EMAIL_REVIEW_CLIENTE = 'review.cliente@allonsapp.com';
const EMAIL_REVIEW_COMERCIO = 'review.comercio@allonsapp.com';
const EMAIL_REVIEW_STAFF = 'review.staff@allonsapp.com';

/**
 * Child-first order so foreign keys never block a delete.
 * Auth tables are intentionally absent: this script never touches them.
 */
const DELETE_ORDER = [
  'conversation_reads',
  'notifications',
  'messages',
  'conversation_members',
  'conversations',
  'refunds',
  'ticket_holders',
  'tickets',
  // Class programs are listed explicitly rather than left to cascade from
  // `providers`: the cascade works, but a silent one made it impossible to
  // tell from this list that a wipe also drops every class program and pass.
  'class_session_reservations',
  'user_class_passes',
  'class_packages',
  'class_session_templates',
  'class_programs',
  'payment_orders',
  'provider_subscription_orders',
  'push_outbox',
  'push_tokens',
  'event_attendees',
  'event_interests',
  'event_media',
  'provider_scan_records',
  'provider_event_ticket_types',
  'provider_activity_log',
  'provider_payout_requests',
  'provider_discounts',
  'provider_brand_settings',
  'provider_refund_policies',
  'provider_members',
  'events',
  'provider_follows',
  'friendships',
  'customer_referral_events',
  'customer_referral_benefits',
  'customer_referral_claims',
  'customer_referral_codes',
  'account_deletion_requests',
  'provider_reviews',
  'profile_interests',
  'profiles',
  'providers',
] as const;

async function wipeAppTables(): Promise<void> {
  for (const table of DELETE_ORDER) {
    try {
      await prisma.$executeRawUnsafe(`DELETE FROM ${table}`);
    } catch {
      console.warn(`[fresh-start] omitido: ${table} (¿tabla inexistente?)`);
    }
  }
}

/** Objects `storage.list` returns per call; it will not return more than this. */
const STORAGE_PAGE_SIZE = 1000;

/** Recursively collects every object path under `prefix`. */
async function listStoragePaths(
  admin: SupabaseClient,
  prefix = '',
): Promise<string[]> {
  const paths: string[] = [];
  // Walk offsets until a short page arrives. Without paging, a folder holding
  // more than one page of objects would be silently half-collected and the
  // wipe would report success while leaving files behind.
  for (let offset = 0; ; offset += STORAGE_PAGE_SIZE) {
    const { data, error } = await admin.storage
      .from(STORAGE_BUCKET)
      .list(prefix, { limit: STORAGE_PAGE_SIZE, offset });
    if (error) throw error;
    const entries = data ?? [];

    for (const entry of entries) {
      const full = prefix ? `${prefix}/${entry.name}` : entry.name;
      // Supabase marks folders by returning a null id.
      if (entry.id === null) {
        paths.push(...(await listStoragePaths(admin, full)));
      } else {
        paths.push(full);
      }
    }

    if (entries.length < STORAGE_PAGE_SIZE) break;
  }
  return paths;
}

async function emptyStorageBucket(admin: SupabaseClient): Promise<number> {
  const paths = await listStoragePaths(admin);
  if (paths.length === 0) return 0;

  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await admin.storage
      .from(STORAGE_BUCKET)
      .remove(paths.slice(i, i + 100));
    if (error) throw error;
  }
  return paths.length;
}

/** Creates the auth user, or updates password/metadata when it already exists. */
async function ensureAuthUser(
  admin: SupabaseClient,
  email: string,
  password: string,
  metadata: Record<string, unknown>,
): Promise<string> {
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: metadata,
  });
  if (created.data?.user?.id) return created.data.user.id;

  // Already registered: find it and realign password + metadata.
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    const users = data?.users ?? [];
    const match = users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    );
    if (match) {
      await admin.auth.admin.updateUserById(match.id, {
        password,
        user_metadata: { ...match.user_metadata, ...metadata },
      });
      return match.id;
    }
    if (users.length < 200) break;
  }
  throw new Error(
    `No se pudo crear ni encontrar el usuario ${email}: ${created.error?.message ?? 'desconocido'}`,
  );
}

async function ensureInterest(slug: string, name: string) {
  return prisma.interest.upsert({
    where: { slug },
    update: { name },
    create: { slug, name },
  });
}

async function attachInterests(eventId: string, interestIds: string[]) {
  if (interestIds.length === 0) return;
  await prisma.eventInterest.createMany({
    data: interestIds.map((interestId) => ({ eventId, interestId })),
  });
}

async function addMember(
  providerId: string,
  userId: string,
  role: string,
  fullName: string,
  email: string,
): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO provider_members (provider_id, user_id, role, active, full_name, email, updated_at)
    VALUES (${providerId}::uuid, ${userId}::uuid, ${role}, true, ${fullName}, ${email}, now())
    ON CONFLICT (provider_id, user_id) DO UPDATE SET
      role = EXCLUDED.role,
      active = EXCLUDED.active,
      full_name = EXCLUDED.full_name,
      email = EXCLUDED.email,
      updated_at = now()
  `;
}

async function addTicketType(
  providerId: string,
  eventId: string,
  name: string,
  price: number,
  total: number,
): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO provider_event_ticket_types
      (provider_id, event_id, name, kind, price, total, sold_count, active, updated_at)
    VALUES (${providerId}::uuid, ${eventId}::uuid, ${name}, 'general', ${price}, ${total}, 0, true, now())
  `;
}

type EventSpec = {
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  city: string;
  venue: string;
  address: string;
  themeColor: string;
  eventType: 'single' | 'recurring_class';
  ticketMode: 'single_access' | 'class_pack' | 'free';
  capacity: number;
  /** Only for recurring_class events. */
  recurrence?: 'weekly' | 'monthly';
  recurrenceCustom?: Record<string, unknown>;
  minAge?: number;
  petFriendly?: boolean;
  parkingAvailable?: boolean;
  interests: string[];
  ticket: { name: string; price: number };
};

async function createEvent(
  providerId: string,
  createdBy: string | null,
  spec: EventSpec,
  interestIds: Record<string, string>,
): Promise<string> {
  const recurrenceCustom = spec.recurrenceCustom
    ? JSON.stringify(spec.recurrenceCustom)
    : null;

  // Raw INSERT on purpose: the Prisma Event model declares `class_discipline`
  // and `capacity_per_occurrence`, which this database does not have yet, so
  // `prisma.event.create()` fails on them. Listing columns explicitly keeps the
  // seed working against both the current and the migrated schema.
  const [event] = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO events (
      provider_id, created_by, title, description, starts_at, ends_at,
      city, venue, address, theme_color, min_age, pet_friendly,
      parking_available, event_type, ticket_mode, capacity, status,
      recurrence, recurrence_custom
    ) VALUES (
      ${providerId}::uuid,
      ${createdBy}::uuid,
      ${spec.title},
      ${spec.description},
      ${new Date(spec.startsAt)}::timestamptz,
      ${new Date(spec.endsAt)}::timestamptz,
      ${spec.city},
      ${spec.venue},
      ${spec.address},
      ${spec.themeColor},
      ${spec.minAge ?? null},
      ${spec.petFriendly ?? false},
      ${spec.parkingAvailable ?? false},
      ${spec.eventType},
      ${spec.ticketMode},
      ${spec.capacity},
      'published',
      ${spec.recurrence ?? null},
      ${recurrenceCustom}::jsonb
    )
    RETURNING id::text
  `;

  await attachInterests(
    event.id,
    spec.interests.map((slug) => interestIds[slug]).filter(Boolean),
  );
  await addTicketType(
    providerId,
    event.id,
    spec.ticket.name,
    spec.ticket.price,
    spec.capacity,
  );
  return event.id;
}

async function main() {
  if (process.env.ALLOW_DEV_DATABASE_RESET !== 'yes') {
    throw new Error(
      [
        'Destructive reset blocked.',
        'Run:',
        "  ALLOW_DEV_DATABASE_RESET=yes DEV_SEED_PASSWORD='...' REVIEW_SEED_PASSWORD='...' pnpm db:seed:fresh-start",
      ].join('\n'),
    );
  }
  const devPassword = process.env.DEV_SEED_PASSWORD?.trim();
  const reviewPassword = process.env.REVIEW_SEED_PASSWORD?.trim();
  if (!devPassword || devPassword.length < 8) {
    throw new Error('DEV_SEED_PASSWORD es obligatorio (mín. 8 caracteres).');
  }
  if (!reviewPassword || reviewPassword.length < 8) {
    throw new Error('REVIEW_SEED_PASSWORD es obligatorio (mín. 8 caracteres).');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL es obligatorio.');
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son obligatorios.');
  }

  const admin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: before } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  const authCountBefore = before?.users?.length ?? 0;

  console.log('[fresh-start] borrando datos de la app…');
  await wipeAppTables();

  console.log('[fresh-start] vaciando el bucket de imágenes…');
  const removed = await emptyStorageBucket(admin);
  console.log(`[fresh-start]   ${removed} archivos eliminados`);

  console.log('[fresh-start] asegurando cuentas…');
  const idCliente = await ensureAuthUser(admin, EMAIL_CLIENTE, devPassword, {
    role: 'client',
    full_name: 'Marlon Cliente',
    name: 'Marlon Cliente',
  });
  const idComercio = await ensureAuthUser(admin, EMAIL_COMERCIO, devPassword, {
    role: 'provider',
    full_name: 'Marlon Comercio',
    name: 'Marlon Comercio',
  });
  const idStaff = await ensureAuthUser(admin, EMAIL_STAFF, devPassword, {
    role: 'staff',
    full_name: 'Marlon Staff',
    staff_role: 'scanner',
    name: 'Marlon Staff',
  });
  const idAmigo = await ensureAuthUser(admin, EMAIL_AMIGO, devPassword, {
    role: 'client',
    full_name: 'Marlon Amigo',
    name: 'Marlon Amigo',
  });
  const idRevCliente = await ensureAuthUser(
    admin,
    EMAIL_REVIEW_CLIENTE,
    reviewPassword,
    { role: 'client', full_name: 'Allons Reviewer', name: 'Allons Reviewer' },
  );
  const idRevComercio = await ensureAuthUser(
    admin,
    EMAIL_REVIEW_COMERCIO,
    reviewPassword,
    { role: 'provider', full_name: 'Allons Review Comercio', name: 'Allons Review Comercio' },
  );
  const idRevStaff = await ensureAuthUser(
    admin,
    EMAIL_REVIEW_STAFF,
    reviewPassword,
    {
      role: 'staff',
      full_name: 'Allons Review Staff',
      staff_role: 'scanner',
      name: 'Allons Review Staff',
    },
  );

  console.log('[fresh-start] perfiles…');
  await prisma.profile.createMany({
    data: [
      { userId: idCliente, fullName: 'Marlon Cliente', username: 'marlon.cliente' },
      { userId: idComercio, fullName: 'Marlon Comercio', username: 'marlon.comercio' },
      { userId: idStaff, fullName: 'Marlon Staff', username: 'marlon.staff' },
      { userId: idAmigo, fullName: 'Marlon Amigo', username: 'marlon.amigo' },
      { userId: idRevCliente, fullName: 'Allons Reviewer', username: 'allons.reviewer' },
      { userId: idRevComercio, fullName: 'Allons Review Comercio', username: 'allons.review.comercio' },
      { userId: idRevStaff, fullName: 'Allons Review Staff', username: 'allons.review.staff' },
    ],
    skipDuplicates: true,
  });

  const interestSlugs: Array<[string, string]> = [
    ['conciertos', 'Conciertos'],
    ['musica', 'Música'],
    ['fitness-y-entrenamiento', 'Fitness y entrenamiento'],
    ['comidas', 'Comidas'],
    ['ferias-y-convenciones', 'Ferias y convenciones'],
    ['conferencias', 'Conferencias'],
    ['catas-de-vino-o-cerveza', 'Catas de vino o cerveza'],
    ['ciencia-y-tecnologia', 'Ciencia y tecnología'],
    ['arte-y-cultura', 'Arte y cultura'],
    ['baile', 'Baile'],
  ];
  const interestIds: Record<string, string> = {};
  for (const [slug, name] of interestSlugs) {
    interestIds[slug] = (await ensureInterest(slug, name)).id;
  }

  // ---------------------------------------------------------------------
  // Comercio principal (dev+comercio): un evento único. Sus clases
  // recurrentes ahora son class_programs, sembrados más abajo.
  // ---------------------------------------------------------------------
  console.log('[fresh-start] comercio principal + 1 evento…');
  const main1 = await prisma.provider.create({
    data: {
      name: 'Expresión Cultural HN',
      handle: 'expresion-cultural-hn',
      description:
        'Producción de conciertos, talleres y festivales en Tegucigalpa y San Pedro Sula.',
      websiteUrl: 'https://allonsapp.com',
    },
  });
  await addMember(main1.id, idComercio, 'owner', 'Marlon Comercio', EMAIL_COMERCIO);
  await addMember(main1.id, idStaff, 'staff_scanner', 'Marlon Staff', EMAIL_STAFF);
  await prisma.$executeRaw`
    INSERT INTO provider_brand_settings (provider_id, logo_color, updated_at)
    VALUES (${main1.id}::uuid, '#F67010', now())
    ON CONFLICT (provider_id) DO NOTHING
  `;

  await createEvent(main1.id, idComercio, {
    title: 'Concierto acústico: Luna y piedra',
    description:
      'Noche íntima de autoras hondureñas. Entradas con pago en línea; aforo limitado.',
    startsAt: '2026-08-28T20:00:00-06:00',
    endsAt: '2026-08-28T23:00:00-06:00',
    city: 'Tegucigalpa',
    venue: 'Teatro Manuel Bonilla',
    address: 'Av. Miguel Paz Barahona, Tegucigalpa',
    themeColor: '#F67010',
    eventType: 'single',
    ticketMode: 'single_access',
    capacity: 180,
    minAge: 16,
    parkingAvailable: true,
    interests: ['conciertos', 'musica'],
    ticket: { name: 'Entrada general', price: 450 },
  }, interestIds);

  // Recurring classes are no longer seeded as `recurring_class` events: that
  // model is superseded by `class_programs`, providers can't create it from the
  // app anymore, and leaving published examples around meant testers kept
  // landing on the old pick-a-date-before-paying flow. Class data now comes
  // from `seedClassProgramGyms` below.

  // ---------------------------------------------------------------------
  // Comercio para App Review (review.comercio + review.staff)
  // ---------------------------------------------------------------------
  console.log('[fresh-start] comercio de App Review…');
  const reviewProvider = await prisma.provider.create({
    data: {
      name: 'Café de Origen SPS',
      handle: 'cafe-de-origen-sps',
      description:
        'Catas, talleres de barismo y experiencias de café hondureño de altura.',
      websiteUrl: 'https://allonsapp.com',
    },
  });
  await addMember(reviewProvider.id, idRevComercio, 'owner', 'Allons Review Comercio', EMAIL_REVIEW_COMERCIO);
  await addMember(reviewProvider.id, idRevStaff, 'staff_scanner', 'Allons Review Staff', EMAIL_REVIEW_STAFF);
  await prisma.$executeRaw`
    INSERT INTO provider_brand_settings (provider_id, logo_color, updated_at)
    VALUES (${reviewProvider.id}::uuid, '#8D6E63', now())
    ON CONFLICT (provider_id) DO NOTHING
  `;

  await createEvent(reviewProvider.id, idRevComercio, {
    title: 'Cata de cafés de origen',
    description:
      'Recorrido sensorial por fincas de Santa Bárbara, Copán y Ocotepeque.',
    startsAt: '2026-08-22T16:00:00-06:00',
    endsAt: '2026-08-22T18:30:00-06:00',
    city: 'San Pedro Sula',
    venue: 'Tostaduría La Cumbre',
    address: 'Barrio Río de Piedras, San Pedro Sula',
    themeColor: '#8D6E63',
    eventType: 'single',
    ticketMode: 'single_access',
    capacity: 12,
    minAge: 18,
    interests: ['catas-de-vino-o-cerveza', 'comidas'],
    ticket: { name: 'Cupo cata', price: 380 },
  }, interestIds);

  await createEvent(reviewProvider.id, idRevComercio, {
    title: 'Taller de barismo gratuito',
    description:
      'Introducción gratuita al espresso y latte art. Reserva tu cupo sin pago.',
    startsAt: '2026-08-30T10:00:00-06:00',
    endsAt: '2026-08-30T12:00:00-06:00',
    city: 'San Pedro Sula',
    venue: 'Tostaduría La Cumbre',
    address: 'Barrio Río de Piedras, San Pedro Sula',
    themeColor: '#A1887F',
    eventType: 'single',
    ticketMode: 'free',
    capacity: 40,
    interests: ['comidas', 'conferencias'],
    ticket: { name: 'Cupo taller', price: 0 },
  }, interestIds);

  // ---------------------------------------------------------------------
  // Otros comercios (pueblan el feed de clientes)
  // ---------------------------------------------------------------------
  console.log('[fresh-start] otros comercios…');
  const extra1 = await prisma.provider.create({
    data: {
      name: 'Ruta Gastronómica HN',
      handle: 'ruta-gastronomica-hn',
      description: 'Ferias de comida, food trucks y mercados nocturnos.',
      websiteUrl: 'https://allonsapp.com',
    },
  });
  await createEvent(extra1.id, null, {
    title: 'Mercado nocturno de food trucks',
    description: 'Más de 20 food trucks, música en vivo y zona familiar.',
    startsAt: '2026-08-15T18:00:00-06:00',
    endsAt: '2026-08-15T23:00:00-06:00',
    city: 'Tegucigalpa',
    venue: 'Explanada Los Próceres',
    address: 'Bulevar Morazán, Tegucigalpa',
    themeColor: '#FFB703',
    eventType: 'single',
    ticketMode: 'free',
    capacity: 500,
    petFriendly: true,
    parkingAvailable: true,
    interests: ['comidas', 'ferias-y-convenciones'],
    ticket: { name: 'Entrada libre', price: 0 },
  }, interestIds);
  await createEvent(extra1.id, null, {
    title: 'Feria de emprendedores de agosto',
    description: 'Marcas locales, artesanía y diseño hondureño.',
    startsAt: '2026-08-23T10:00:00-06:00',
    endsAt: '2026-08-23T18:00:00-06:00',
    city: 'San Pedro Sula',
    venue: 'Centro de Convenciones SPS',
    address: 'Av. Circunvalación, San Pedro Sula',
    themeColor: '#06D6A0',
    eventType: 'single',
    ticketMode: 'single_access',
    capacity: 300,
    interests: ['ferias-y-convenciones', 'arte-y-cultura'],
    ticket: { name: 'Entrada general', price: 100 },
  }, interestIds);

  const extra2 = await prisma.provider.create({
    data: {
      name: 'Nodo Tech Honduras',
      handle: 'nodo-tech-honduras',
      description: 'Meetups, hackathons y formación en tecnología.',
      websiteUrl: 'https://allonsapp.com',
    },
  });
  await createEvent(extra2.id, null, {
    title: 'Honduras Fintech Day',
    description:
      'Panel sobre pagos digitales, banca abierta y el ecosistema fintech hondureño.',
    startsAt: '2026-08-19T09:00:00-06:00',
    endsAt: '2026-08-19T17:00:00-06:00',
    city: 'Tegucigalpa',
    venue: 'Centro de Convenciones Hotel Real',
    address: 'Col. Hato de Enmedio, Tegucigalpa',
    themeColor: '#118AB2',
    eventType: 'single',
    ticketMode: 'single_access',
    capacity: 250,
    parkingAvailable: true,
    interests: ['conferencias', 'ciencia-y-tecnologia'],
    ticket: { name: 'Entrada general', price: 600 },
  }, interestIds);
  // The monthly robotics club is intentionally gone: `class_programs` models
  // schedules as weekday + time only, so a monthly cadence can't be expressed
  // (setting a weekday would offer it every week instead of once a month).
  // Classes in Allons are taught weekly, so monthly recurrence is out of scope.

  // ---------------------------------------------------------------------
  // Programas de clases (modelo class_programs) — reemplaza recurring_class
  // ---------------------------------------------------------------------
  console.log('[fresh-start] programas de clases (gimnasios)…');
  await seedClassProgramGyms(prisma);

  const { data: after } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  const [providers, events, profiles, classPrograms] = await Promise.all([
    prisma.provider.count(),
    // Raw count for the same reason createEvent uses a raw INSERT.
    prisma
      .$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM events`
      .then((rows) => Number(rows[0].n)),
    prisma.profile.count(),
    prisma
      .$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM class_programs`
      .then((rows) => Number(rows[0].n)),
  ]);

  console.log('\n[fresh-start] listo.');
  console.log('–––––––––––––––––––––––––––––');
  console.log(`  comercios:        ${providers}`);
  console.log(`  eventos:          ${events}`);
  console.log(`  prog. de clases:  ${classPrograms}`);
  console.log(`  perfiles:         ${profiles}`);
  console.log(`  auth users antes: ${authCountBefore}`);
  console.log(`  auth users ahora: ${after?.users?.length ?? 0}  (ninguno borrado)`);
  console.log('–––––––––––––––––––––––––––––');
  console.log(`  ${EMAIL_CLIENTE} / ${EMAIL_COMERCIO} / ${EMAIL_STAFF}`);
  console.log(`  ${EMAIL_REVIEW_CLIENTE} / ${EMAIL_REVIEW_COMERCIO} / ${EMAIL_REVIEW_STAFF}`);
  console.log('–––––––––––––––––––––––––––––');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
