/**
 * Dev-only: wipes Allons application data (+ auth identities), preserves waitlist*.
 *
 * Env (all required to run):
 *   DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   ALLOW_DEV_DATABASE_RESET=yes
 *   DEV_SEED_PASSWORD=...   — password assigned to each seeded login
 *
 * Run: cd allons-api && pnpm db:seed:dev-reset
 */

import { createClient } from '@supabase/supabase-js';
import { PrismaClient } from '../../generated/prisma';

const EMAIL_CLIENTE = 'marlon.castro+cliente@allonsapp.com';
const EMAIL_COMERCIO = 'marlon.castro+comercio@allonsapp.com';
const EMAIL_STAFF = 'marlon.castro+staff@allonsapp.com';

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
  'ticket_holders',
  'tickets',
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
      console.warn(`[seed] skip or failed delete: ${table} (missing table?)`);
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
          console.warn(`[seed] auth delete warn ${u.id}`, e?.message ?? e);
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
    throw new Error('Set DEV_SEED_PASSWORD (min 8 chars) for seeded accounts.');
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required.');
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  }

  console.log('[seed] wiping app tables…');
  await wipePublicAppTables();

  console.log('[seed] deleting auth users…');
  await deleteAllAuthUsers();

  console.log('[seed] ensure runtime provider DDL…');
  await ensureRuntimeProviderTables();

  const admin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const interestConciertos = await ensureInterest('conciertos', 'Conciertos');
  const interestMusica = await ensureInterest('musica', 'Musica');
  const interestFitness = await ensureInterest(
    'fitness-y-entrenamiento',
    'Fitness y entrenamiento',
  );
  const interestHack = await ensureInterest('hackathons', 'Hackathons');
  const interestTech = await ensureInterest(
    'ciencia-y-tecnologia',
    'Ciencia y tecnologia',
  );

  console.log('[seed] creating Auth users…');
  const [{ data: uCliente }, { data: uComercio }, { data: uStaff }] =
    await Promise.all([
      admin.auth.admin.createUser({
        email: EMAIL_CLIENTE,
        password,
        email_confirm: true,
        user_metadata: {
          role: 'client',
          full_name: 'Cliente demo',
          name: 'Cliente demo',
        },
      }),
      admin.auth.admin.createUser({
        email: EMAIL_COMERCIO,
        password,
        email_confirm: true,
        user_metadata: {
          role: 'provider',
          full_name: 'Comercio demo',
          name: 'Comercio demo',
        },
      }),
      admin.auth.admin.createUser({
        email: EMAIL_STAFF,
        password,
        email_confirm: true,
        user_metadata: {
          role: 'staff',
          full_name: 'Staff demo',
          staff_role: 'scanner',
          name: 'Staff demo',
        },
      }),
    ]);

  const idCliente = uCliente?.user?.id;
  const idComercio = uComercio?.user?.id;
  const idStaff = uStaff?.user?.id;

  if (!idCliente || !idComercio || !idStaff) {
    console.error(uCliente?.user ?? uCliente, uComercio, uStaff);
    throw new Error('Failed creating one or more auth users.');
  }

  console.log('[seed] profiles…');
  await prisma.profile.createMany({
    data: [
      {
        userId: idCliente,
        fullName: 'Cliente demo',
        username: 'demo_cliente_seed',
      },
      {
        userId: idComercio,
        fullName: 'Comercio demo',
        username: 'demo_comercio_seed',
      },
      {
        userId: idStaff,
        fullName: 'Staff demo',
        username: 'demo_staff_seed',
      },
    ],
  });

  console.log('[seed] provider org + staff membership…');
  const provider = await prisma.provider.create({
    data: {
      name: 'Comercio demo (seed)',
      handle: 'demo-seed-org',
      description: 'Organización de prueba (script prisma/scripts/dev-reset-seed.ts)',
      websiteUrl: 'https://allonsapp.com',
    },
  });

  await prisma.$executeRaw`
    INSERT INTO provider_members (provider_id, user_id, role, active, full_name, email, updated_at)
    VALUES (${provider.id}::uuid, ${idComercio}::uuid, 'owner', true, 'Comercio demo', ${EMAIL_COMERCIO}, now()),
           (${provider.id}::uuid, ${idStaff}::uuid, 'staff_scanner', true, 'Staff demo', ${EMAIL_STAFF}, now())
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

  console.log('[seed] events…');
  const startsConcert = new Date('2026-06-20T20:00:00-06:00');
  const endsConcert = new Date('2026-06-20T23:00:00-06:00');
  const ev1 = await prisma.event.create({
    data: {
      providerId: provider.id,
      createdBy: idComercio,
      title: 'Concierto Acústico — Seed Demo',
      description:
        'Evento single público para probar checkout y filtro “eventos normales”.',
      startsAt: startsConcert,
      endsAt: endsConcert,
      city: 'Tegucigalpa',
      venue: 'Foro Indie Seed',
      address: 'Col. Kennedy, ejemplo de dirección local',
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
    price: 399,
    total: 400,
  });
  await upsertTicketType(provider.id, ev1.id, {
    name: 'Early bird',
    kind: 'early',
    price: 249,
    total: 100,
  });

  const startsClass = new Date('2026-05-26T06:45:00-06:00');
  const endsClass = new Date('2026-05-26T08:15:00-06:00');
  const ev2 = await prisma.event.create({
    data: {
      providerId: provider.id,
      createdBy: idComercio,
      title: 'Yoga Flow Matutino (clases recurrentes)',
      description:
        'Martes y jueves. Paquete de clases seed para probar recurrence y reserva multi-fecha.',
      startsAt: startsClass,
      endsAt: endsClass,
      city: 'San Pedro Sula',
      venue: 'Estudio Centro Seed',
      address: 'SPS — dirección ejemplo',
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
    price: 1200,
    total: 24,
  });

  const startsHack = new Date('2026-07-05T09:30:00-06:00');
  const endsHack = new Date('2026-07-06T18:00:00-06:00');
  const ev3 = await prisma.event.create({
    data: {
      providerId: provider.id,
      createdBy: idComercio,
      title: 'Hackathon ciudadana 24h — Allons QA',
      description:
        'Evento single formato maratón: ideal para probar talleres sin recurrencia y multi-perfil equipo.',
      startsAt: startsHack,
      endsAt: endsHack,
      city: 'Tegucigalpa',
      venue: 'Hub Creativo QA',
      address: 'Zona Tec, ejemplo seed',
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
    price: 0,
    total: 120,
  });

  console.log('[seed] done.');
  console.log('–––––––––––––––––––––––––––––');
  console.log(`  ${EMAIL_CLIENTE}`);
  console.log(`  ${EMAIL_COMERCIO}`);
  console.log(`  ${EMAIL_STAFF}`);
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
