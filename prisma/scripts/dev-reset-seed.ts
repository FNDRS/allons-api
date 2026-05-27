/**
 * Dev-only: wipes Allons application data (+ auth identities).
 * Does NOT truncate: waitlist*, waitlist_qr_sources, admin_audit_logs.
 *
 * Env (all required to run):
 *   DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   ALLOW_DEV_DATABASE_RESET=yes
 *   DEV_SEED_PASSWORD=...   — temporary password for local accounts created by this script
 *   DEV_SEED_EMAIL_PREFIX=dev — optional email prefix ({prefix}+cliente|comercio|staff@allonsapp.com); default: dev
 *
 * Run: cd allons-api && pnpm db:seed:dev-reset
 */

import { createClient } from '@supabase/supabase-js';
import { PrismaClient } from '../../generated/prisma';

const devEmailPrefix = (process.env.DEV_SEED_EMAIL_PREFIX ?? 'dev').trim() || 'dev';
const EMAIL_CLIENTE = `${devEmailPrefix}+cliente@allonsapp.com`;
const EMAIL_COMERCIO = `${devEmailPrefix}+comercio@allonsapp.com`;
const EMAIL_STAFF = `${devEmailPrefix}+staff@allonsapp.com`;
const EMAIL_AMIGO = `${devEmailPrefix}+amigo@allonsapp.com`;

const prisma = new PrismaClient();

async function ensureRuntimeProviderTables(): Promise<void> {
  await prisma.$executeRaw`
    ALTER TABLE events
    ADD COLUMN IF NOT EXISTS event_type text NOT NULL DEFAULT 'single'
  `;
  await prisma.$executeRaw`
    ALTER TABLE events ADD COLUMN IF NOT EXISTS recurrence text
  `;
  await prisma.$executeRaw`
    ALTER TABLE events ADD COLUMN IF NOT EXISTS recurrence_custom jsonb
  `;
  await prisma.$executeRaw`
    ALTER TABLE events ADD COLUMN IF NOT EXISTS ticket_mode text NOT NULL DEFAULT 'paid'
  `;
  await prisma.$executeRaw`
    ALTER TABLE events ADD COLUMN IF NOT EXISTS capacity integer NOT NULL DEFAULT 0
  `;
  await prisma.$executeRaw`
    ALTER TABLE events ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft'
  `;
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS provider_members (
      provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      user_id uuid NOT NULL,
      role text NOT NULL DEFAULT 'owner',
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (provider_id, user_id)
    )
  `;
  await prisma.$executeRaw`
    ALTER TABLE provider_members ADD COLUMN IF NOT EXISTS full_name text
  `;
  await prisma.$executeRaw`
    ALTER TABLE provider_members ADD COLUMN IF NOT EXISTS email text
  `;

  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS provider_event_ticket_types (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      name text NOT NULL,
      kind text NOT NULL DEFAULT 'general',
      price numeric(12,2) NOT NULL DEFAULT 0,
      total integer NOT NULL DEFAULT 0,
      sold_count integer NOT NULL DEFAULT 0,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS provider_brand_settings (
      provider_id uuid PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
      logo_color text NOT NULL DEFAULT '#F67010',
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
}

const DELETE_ORDER_EXACT = [
  'conversation_reads',
  'notifications',
  'messages',
  'conversation_members',
  'conversations',
  'refunds',
  'ticket_holders',
  'tickets',
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

async function wipePublicAppTables() {
  for (const table of DELETE_ORDER_EXACT) {
    try {
      await prisma.$executeRawUnsafe(`DELETE FROM ${table}`);
    } catch {
      console.warn(`[dev-reset] omitido o falló: ${table} (¿tabla inexistente?)`);
    }
  }
}

async function deleteAllAuthUsers() {
  const url = process.env.SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    const users = data?.users ?? [];
    if (users.length === 0) break;
    await Promise.all(
      users.map((u) =>
        admin.auth.admin.deleteUser(u.id).catch((e) => {
          console.warn(`[dev-reset] aviso al borrar usuario ${u.id}`, e?.message ?? e);
        }),
      ),
    );
    page += 1;
    if (users.length < 200) break;
  }
}

async function ensureInterest(slug: string, name: string) {
  return prisma.interest.upsert({
    where: { slug },
    update: { name },
    create: { slug, name },
  });
}

async function attachInterests(eventId: string, interestIds: string[]) {
  await prisma.eventInterest.deleteMany({ where: { eventId } });
  if (interestIds.length === 0) return;
  await prisma.eventInterest.createMany({
    data: interestIds.map((interestId) => ({ eventId, interestId })),
  });
}

async function upsertTicketType(
  providerId: string,
  eventId: string,
  params: {
    name: string;
    kind?: string;
    price: number;
    total: number;
  },
) {
  await prisma.$executeRaw`
    INSERT INTO provider_event_ticket_types (
      provider_id, event_id, name, kind, price, total, sold_count, active
    )
    VALUES (
      ${providerId}::uuid,
      ${eventId}::uuid,
      ${params.name},
      ${params.kind ?? 'general'},
      ${params.price},
      ${params.total},
      0,
      true
    )
  `;
}

async function main() {
  if (process.env.ALLOW_DEV_DATABASE_RESET !== 'yes') {
    throw new Error(
      'Set ALLOW_DEV_DATABASE_RESET=yes to confirm destructive reset.',
    );
  }
  const password = process.env.DEV_SEED_PASSWORD?.trim();
  if (!password || password.length < 8) {
    throw new Error(
      'Define DEV_SEED_PASSWORD (mín. 8 caracteres) para las cuentas locales.',
    );
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required.');
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  }

  console.log('[dev-reset] borrando tablas de la app…');
  await wipePublicAppTables();

  console.log('[dev-reset] eliminando usuarios de autenticación…');
  await deleteAllAuthUsers();

  console.log('[dev-reset] comprobando DDL de proveedor…');
  await ensureRuntimeProviderTables();

  const admin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const interestConciertos = await ensureInterest('conciertos', 'Conciertos');
  const interestMusica = await ensureInterest('musica', 'Música');
  const interestFitness = await ensureInterest(
    'fitness-y-entrenamiento',
    'Fitness y entrenamiento',
  );
  const interestHack = await ensureInterest('hackathons', 'Hackathons');
  const interestTech = await ensureInterest(
    'ciencia-y-tecnologia',
    'Ciencia y tecnología',
  );
  const interestComidas = await ensureInterest('comidas', 'Comidas');
  const interestFerias = await ensureInterest(
    'ferias-y-convenciones',
    'Ferias y convenciones',
  );
  const interestConferencias = await ensureInterest('conferencias', 'Conferencias');
  const interestCatas = await ensureInterest(
    'catas-de-vino-o-cerveza',
    'Catas de vino o cerveza',
  );

  console.log('[dev-reset] creando usuarios de autenticación…');
  const [{ data: uCliente }, { data: uComercio }, { data: uStaff }, { data: uAmigo }] =
    await Promise.all([
      admin.auth.admin.createUser({
        email: EMAIL_CLIENTE,
        password,
        email_confirm: true,
        user_metadata: {
          role: 'client',
          full_name: 'Marlon Geovany Castro Mejia',
          name: 'Marlon Geovany Castro Mejia',
        },
      }),
      admin.auth.admin.createUser({
        email: EMAIL_COMERCIO,
        password,
        email_confirm: true,
        user_metadata: {
          role: 'provider',
          full_name: 'Marlon Comercio',
          name: 'Marlon Comercio',
        },
      }),
      admin.auth.admin.createUser({
        email: EMAIL_STAFF,
        password,
        email_confirm: true,
        user_metadata: {
          role: 'staff',
          full_name: 'Marlon Staff',
          staff_role: 'scanner',
          name: 'Marlon Staff',
        },
      }),
      admin.auth.admin.createUser({
        email: EMAIL_AMIGO,
        password,
        email_confirm: true,
        user_metadata: {
          role: 'client',
          full_name: 'Marlon Amigo',
          name: 'Marlon Amigo',
        },
      }),
    ]);

  const idCliente = uCliente?.user?.id;
  const idComercio = uComercio?.user?.id;
  const idStaff = uStaff?.user?.id;
  const idAmigo = uAmigo?.user?.id;

  if (!idCliente || !idComercio || !idStaff || !idAmigo) {
    console.error(uCliente?.user ?? uCliente, uComercio, uStaff, uAmigo);
    throw new Error('Failed creating one or more auth users.');
  }

  console.log('[dev-reset] perfiles…');
  await prisma.profile.createMany({
    data: [
      {
        userId: idCliente,
        fullName: 'Marlon Geovany Castro Mejia',
        username: 'marlon.castro',
      },
      {
        userId: idComercio,
        fullName: 'Marlon Comercio',
        username: 'marlon.comercio',
      },
      {
        userId: idStaff,
        fullName: 'Marlon Staff',
        username: 'marlon.staff',
      },
      {
        userId: idAmigo,
        fullName: 'Marlon Amigo',
        username: 'marlon.amigo',
      },
    ],
  });

  console.log('[dev-reset] organización y equipo…');
  const provider = await prisma.provider.create({
    data: {
      name: 'Expresión Cultural HN',
      handle: 'expresion-cultural-hn',
      description:
        'Producción de conciertos, talleres y festivales en Tegucigalpa y San Pedro Sula.',
      websiteUrl: 'https://allonsapp.com',
    },
  });

  await prisma.$executeRaw`
    INSERT INTO provider_members (provider_id, user_id, role, active, full_name, email, updated_at)
    VALUES (${provider.id}::uuid, ${idComercio}::uuid, 'owner', true, 'Roberto Castellanos', ${EMAIL_COMERCIO}, now()),
           (${provider.id}::uuid, ${idStaff}::uuid, 'staff_scanner', true, 'Claudia Reyes', ${EMAIL_STAFF}, now())
    ON CONFLICT (provider_id, user_id)
    DO UPDATE SET
      role = EXCLUDED.role,
      active = EXCLUDED.active,
      full_name = EXCLUDED.full_name,
      email = EXCLUDED.email,
      updated_at = now()
  `;

  await prisma.$executeRaw`
    INSERT INTO provider_brand_settings (provider_id, logo_color, updated_at)
    VALUES (${provider.id}::uuid, '#F67010', now())
    ON CONFLICT (provider_id) DO NOTHING
  `;

  const recurCustom = JSON.stringify({
    interval: 1,
    unit: 'week',
    weekDays: ['tuesday', 'thursday'],
    endType: 'never',
  });

  console.log('[dev-reset] eventos…');
  const startsConcert = new Date('2026-06-20T20:00:00-06:00');
  const endsConcert = new Date('2026-06-20T23:00:00-06:00');
  const ev1 = await prisma.event.create({
    data: {
      providerId: provider.id,
      createdBy: idComercio,
      title: 'Concierto acústico: Luna y piedra',
      description:
        'Noche íntima de autoras hondureñas. Entradas con pago en línea; aforo limitado.',
      startsAt: startsConcert,
      endsAt: endsConcert,
      city: 'Tegucigalpa',
      venue: 'Teatro Manuel Bonilla — Sala experimental',
      address: 'Col. Palmira, frente a Parque La Leona, Tegucigalpa',
      themeColor: '#7C4DFF',
      eventType: 'single',
      parkingAvailable: true,
      minAge: 18,
    },
  });

  await prisma.$executeRaw`
    UPDATE events
    SET event_type = 'single',
        ticket_mode = 'single_access',
        capacity = 400,
        status = 'published',
        recurrence = NULL,
        recurrence_custom = NULL
    WHERE id = ${ev1.id}::uuid
  `;
  await attachInterests(ev1.id, [interestConciertos.id, interestMusica.id]);
  await upsertTicketType(provider.id, ev1.id, {
    name: 'Entrada general',
    kind: 'general',
    price: 580,
    total: 400,
  });
  await upsertTicketType(provider.id, ev1.id, {
    name: 'Preventa',
    kind: 'early',
    price: 395,
    total: 100,
  });

  const startsClass = new Date('2026-05-26T06:45:00-06:00');
  const endsClass = new Date('2026-05-26T08:15:00-06:00');
  const ev2 = await prisma.event.create({
    data: {
      providerId: provider.id,
      createdBy: idComercio,
      title: 'Yoga al amanecer — paquete mayo–junio',
      description:
        'Martes y jueves, 6:45 a.m. Paquete de ocho sesiones; compra única del paquete.',
      startsAt: startsClass,
      endsAt: endsClass,
      city: 'San Pedro Sula',
      venue: 'Shala Prana · Zona gourmet',
      address: '12 Calle, local 4B, Col. Jardines del Valle, San Pedro Sula',
      themeColor: '#2EC4B6',
      petFriendly: true,
    },
  });
  await prisma.$executeRaw`
    UPDATE events
    SET event_type = 'recurring_class',
        ticket_mode = 'class_pack',
        capacity = 24,
        status = 'published',
        recurrence = 'weekly',
        recurrence_custom = ${recurCustom}::jsonb
    WHERE id = ${ev2.id}::uuid
  `;
  await attachInterests(ev2.id, [interestFitness.id]);
  await upsertTicketType(provider.id, ev2.id, {
    name: 'Paquete 8 clases Mayo–Jun',
    kind: 'general',
    price: 1280,
    total: 24,
  });

  const startsHack = new Date('2026-07-05T09:30:00-06:00');
  const endsHack = new Date('2026-07-06T18:00:00-06:00');
  const ev3 = await prisma.event.create({
    data: {
      providerId: provider.id,
      createdBy: idComercio,
      title: 'Hackathon Ciudad Abierta — 24 horas',
      description:
        'Reto cívico y datos abiertos; equipos de hasta cuatro personas. Incluye mentorías y cena.',
      startsAt: startsHack,
      endsAt: endsHack,
      city: 'Tegucigalpa',
      venue: 'Universidad Nacional Autónoma de Honduras — Edificio A-7',
      address: 'Boulevard Suyapa, Ciudad Universitaria, Tegucigalpa',
      themeColor: '#00B4D8',
      minAge: 16,
      parkingAvailable: true,
    },
  });
  await prisma.$executeRaw`
    UPDATE events
    SET event_type = 'single',
        ticket_mode = 'single_access',
        capacity = 120,
        status = 'published',
        recurrence = NULL,
        recurrence_custom = NULL
    WHERE id = ${ev3.id}::uuid
  `;
  await attachInterests(ev3.id, [interestHack.id, interestTech.id]);
  await upsertTicketType(provider.id, ev3.id, {
    name: 'Equipo (hasta 4 personas)',
    kind: 'general',
    price: 1650,
    total: 120,
  });

  // Free in the app → reservation with “pay at venue” (ticket_mode = free).
  const startsFeria = new Date('2026-06-14T09:00:00-06:00');
  const endsFeria = new Date('2026-06-14T18:00:00-06:00');
  const ev4 = await prisma.event.create({
    data: {
      providerId: provider.id,
      createdBy: idComercio,
      title: 'Mercado de arte y diseño — acceso libre',
      description:
        'Entrada sin costo en la app; compras y consumo se pagan en los puestos el día del evento.',
      startsAt: startsFeria,
      endsAt: endsFeria,
      city: 'Tegucigalpa',
      venue: 'Plaza República',
      address: 'Centro histórico, Tegucigalpa',
      themeColor: '#FFB703',
      eventType: 'single',
      petFriendly: true,
    },
  });
  await prisma.$executeRaw`
    UPDATE events
    SET event_type = 'single',
        ticket_mode = 'free',
        capacity = 800,
        status = 'published',
        recurrence = NULL,
        recurrence_custom = NULL
    WHERE id = ${ev4.id}::uuid
  `;
  await attachInterests(ev4.id, [interestFerias.id, interestComidas.id]);
  await upsertTicketType(provider.id, ev4.id, {
    name: 'Acceso general',
    kind: 'general',
    price: 0,
    total: 800,
  });

  const startsStand = new Date('2026-08-02T20:30:00-06:00');
  const endsStand = new Date('2026-08-02T23:00:00-06:00');
  const ev5 = await prisma.event.create({
    data: {
      providerId: provider.id,
      createdBy: idComercio,
      title: 'Stand-up: Open Mic — Noche de comediantes',
      description: 'Cómicos locales y una consumición mínima en taquilla.',
      startsAt: startsStand,
      endsAt: endsStand,
      city: 'San Pedro Sula',
      venue: 'Sótano Cultural',
      address: 'Barrio Suyapa, San Pedro Sula',
      themeColor: '#FF4D6D',
      eventType: 'single',
      minAge: 18,
    },
  });
  await prisma.$executeRaw`
    UPDATE events
    SET event_type = 'single',
        ticket_mode = 'single_access',
        capacity = 180,
        status = 'published',
        recurrence = NULL,
        recurrence_custom = NULL
    WHERE id = ${ev5.id}::uuid
  `;
  await attachInterests(ev5.id, [interestConciertos.id, interestComidas.id]);
  await upsertTicketType(provider.id, ev5.id, {
    name: 'Entrada general',
    kind: 'general',
    price: 295,
    total: 180,
  });

  const startsCata = new Date('2026-07-19T16:00:00-06:00');
  const endsCata = new Date('2026-07-19T19:30:00-06:00');
  const ev6 = await prisma.event.create({
    data: {
      providerId: provider.id,
      createdBy: idComercio,
      title: 'Cata de cafés de origen — 12 cupping',
      description:
        'Pago en línea. Sesión guiada con 4 orígenes y degustación; cupos limitados.',
      startsAt: startsCata,
      endsAt: endsCata,
      city: 'Tegucigalpa',
      venue: 'La Tostaduría Lab',
      address: 'Lomas del Guijarro, Tegucigalpa',
      themeColor: '#6F4E37',
      eventType: 'single',
      minAge: 18,
    },
  });
  await prisma.$executeRaw`
    UPDATE events
    SET event_type = 'single',
        ticket_mode = 'single_access',
        capacity = 36,
        status = 'published',
        recurrence = NULL,
        recurrence_custom = NULL
    WHERE id = ${ev6.id}::uuid
  `;
  await attachInterests(ev6.id, [interestCatas.id, interestComidas.id]);
  await upsertTicketType(provider.id, ev6.id, {
    name: 'Participante',
    kind: 'general',
    price: 485,
    total: 28,
  });
  await upsertTicketType(provider.id, ev6.id, {
    name: 'Preventa',
    kind: 'early',
    price: 395,
    total: 8,
  });

  const startsTaller = new Date('2026-06-07T15:00:00-06:00');
  const endsTaller = new Date('2026-06-07T17:30:00-06:00');
  const ev7 = await prisma.event.create({
    data: {
      providerId: provider.id,
      createdBy: idComercio,
      title: 'Taller infantil: máscaras de papel — gratis (materiales en local)',
      description:
        'Reserva tu cupo sin pago en la app; contribución opcional por materiales en el salón.',
      startsAt: startsTaller,
      endsAt: endsTaller,
      city: 'Comayagüela',
      venue: 'Biblioteca municipal Ramón Amaya Amador',
      address: 'Calle del Comercio, Comayagüela MDC',
      themeColor: '#4CC9F0',
      eventType: 'single',
    },
  });
  await prisma.$executeRaw`
    UPDATE events
    SET event_type = 'single',
        ticket_mode = 'free',
        capacity = 40,
        status = 'published',
        recurrence = NULL,
        recurrence_custom = NULL
    WHERE id = ${ev7.id}::uuid
  `;
  await attachInterests(ev7.id, [interestConferencias.id, interestComidas.id]);
  await upsertTicketType(provider.id, ev7.id, {
    name: 'Cupo taller',
    kind: 'general',
    price: 0,
    total: 40,
  });

  console.log('[dev-reset] listo.');
  console.log('–––––––––––––––––––––––––––––');
  console.log(`  ${EMAIL_CLIENTE}`);
  console.log(`  ${EMAIL_COMERCIO}`);
  console.log(`  ${EMAIL_STAFF}`);
  console.log(`  ${EMAIL_AMIGO}`);
  console.log(`  Password: ${password}`);
  console.log('–––––––––––––––––––––––––––––');
  console.log('Waitlist:* tables were NOT modified.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
