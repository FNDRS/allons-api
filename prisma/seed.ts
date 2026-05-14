import { PrismaClient } from '../generated/prisma';

const prisma = new PrismaClient();

async function main() {
  // Keep seed deterministic and safe to re-run.
  const interestLabels: Array<{ slug: string; name: string }> = [
    { slug: 'cine-y-proyecciones', name: 'Cine y proyecciones' },
    { slug: 'festivales-culturales', name: 'Festivales culturales' },
    { slug: 'exhibiciones-de-arte', name: 'Exhibiciones de Arte' },
    { slug: 'musica', name: 'Musica' },
    { slug: 'ciencia-y-tecnologia', name: 'Ciencia y tecnologia' },
    { slug: 'comic-cons', name: 'Comic-Cons' },
    { slug: 'conciertos', name: 'Conciertos' },
    { slug: 'fitness-y-entrenamiento', name: 'Fitness y entrenamiento' },
    { slug: 'partidos-y-torneos', name: 'Partidos y torneos' },
    { slug: 'conferencias', name: 'Conferencias' },
    { slug: 'hackathons', name: 'Hackathons' },
    { slug: 'catas-de-vino-o-cerveza', name: 'Catas de vino o cerveza' },
    { slug: 'festivales-gastronomicos', name: 'Festivales gastronomicos' },
    { slug: 'raves', name: 'Raves' },
    { slug: 'gaming-y-e-sports', name: 'Gaming y e-sports' },
    { slug: 'ferias-y-convenciones', name: 'Ferias y convenciones' },
    { slug: 'comidas', name: 'Comidas' },
    { slug: 'bares-and-drinks', name: 'Bares & drinks' },
  ];

  for (const i of interestLabels) {
    await prisma.interest.upsert({
      // `name` is unique and may already exist from earlier seeds.
      where: { name: i.name },
      update: { slug: i.slug },
      create: { slug: i.slug, name: i.name },
    });
  }

  const interestRows = await prisma.interest.findMany({
    where: { slug: { in: interestLabels.map((i) => i.slug) } },
    select: { id: true, slug: true },
  });
  const interestMap = new Map(interestRows.map((i) => [i.slug, i.id]));

  const providers = [
    {
      handle: 'allons',
      name: 'Allons Originals',
      description: 'Eventos curados por Allons',
      websiteUrl: 'https://allonsapp.com',
    },
    {
      handle: 'cdmx-nightlife',
      name: 'CDMX Nightlife',
      description: 'Colectivo de fiestas y raves',
      websiteUrl: 'https://allonsapp.com',
    },
    {
      handle: 'tech-coffee',
      name: 'Tech & Coffee',
      description: 'Meetups de producto e ingenieria',
      websiteUrl: 'https://allonsapp.com',
    },
    {
      handle: 'arte-abierto',
      name: 'Arte Abierto',
      description: 'Exhibiciones y recorridos',
      websiteUrl: 'https://allonsapp.com',
    },
    {
      handle: 'fndrs',
      name: 'FNDRS Community',
      description: 'Meetups y actividades de la comunidad',
      websiteUrl: 'https://allonsapp.com',
    },
    {
      handle: 'allons-sports',
      name: 'Allons Sports',
      description: 'Partidos, torneos y experiencias fitness',
      websiteUrl: 'https://allonsapp.com',
    },
    {
      handle: 'food-week',
      name: 'Food Week',
      description: 'Catas y experiencias gastronomicas',
      websiteUrl: 'https://allonsapp.com',
    },
  ];

  for (const p of providers) {
    await prisma.provider.upsert({
      where: { handle: p.handle },
      update: {
        name: p.name,
        description: p.description,
        websiteUrl: p.websiteUrl,
      },
      create: p,
    });
  }

  const providerRows = await prisma.provider.findMany({
    where: { handle: { in: providers.map((p) => p.handle) } },
    select: { id: true, handle: true },
  });
  const providerMap = new Map(providerRows.map((p) => [p.handle ?? '', p.id]));

  const now = new Date();
  const addDays = (d: number) => new Date(now.getTime() + d * 24 * 60 * 60 * 1000);
  const atHour = (d: number, h: number) => {
    const dt = addDays(d);
    dt.setHours(h, 0, 0, 0);
    return dt;
  };

  const events: Array<{
    providerHandle: string;
    title: string;
    description: string;
    startsAt: Date;
    endsAt: Date;
    city: string;
    venue: string;
    address: string;
    themeColor: string;
    types?: string[];
    smokingAllowed?: boolean;
    petFriendly?: boolean;
    parkingAvailable?: boolean;
    minAge?: number | null;
  }> = [
    {
      providerHandle: 'allons',
      title: 'After Office: Rooftop Sessions',
      description: 'Musica, drinks y atardecer en terraza.',
      startsAt: addDays(2),
      endsAt: new Date(addDays(2).getTime() + 3 * 60 * 60 * 1000),
      city: 'CDMX',
      venue: 'Terraza Centro',
      address: 'Centro, CDMX',
      themeColor: '#7C4DFF',
      types: ['musica', 'bares-and-drinks'],
      smokingAllowed: true,
      petFriendly: false,
      parkingAvailable: false,
      minAge: 18,
    },
    {
      providerHandle: 'cdmx-nightlife',
      title: 'Rave: Warehouse Edition',
      description: 'Lineup sorpresa. Acceso limitado.',
      startsAt: atHour(5, 23),
      endsAt: atHour(6, 5),
      city: 'CDMX',
      venue: 'Warehouse Norte',
      address: 'Norte, CDMX',
      themeColor: '#FF4D6D',
      types: ['raves', 'musica'],
      smokingAllowed: true,
      petFriendly: false,
      parkingAvailable: true,
      minAge: 21,
    },
    {
      providerHandle: 'tech-coffee',
      title: 'Meetup: React Native + Supabase',
      description: 'Charlas cortas + networking.',
      startsAt: atHour(7, 19),
      endsAt: atHour(7, 21),
      city: 'CDMX',
      venue: 'Cafe Roma',
      address: 'Roma Norte, CDMX',
      themeColor: '#2EC4B6',
      types: ['conferencias', 'ciencia-y-tecnologia'],
      smokingAllowed: false,
      petFriendly: true,
      parkingAvailable: false,
      minAge: null,
    },
    {
      providerHandle: 'arte-abierto',
      title: 'Noche de Galerias',
      description: 'Recorrido por galerias y exhibiciones.',
      startsAt: atHour(10, 18),
      endsAt: atHour(10, 22),
      city: 'CDMX',
      venue: 'Juarez',
      address: 'Col. Juarez, CDMX',
      themeColor: '#FFA62B',
      types: ['exhibiciones-de-arte', 'festivales-culturales'],
      smokingAllowed: false,
      petFriendly: true,
      parkingAvailable: true,
      minAge: null,
    },
    {
      providerHandle: 'fndrs',
      title: 'Startup Coffee: Product & Growth',
      description: 'Cafe y networking. 3 lightning talks + Q&A.',
      startsAt: atHour(3, 9),
      endsAt: atHour(3, 11),
      city: 'CDMX',
      venue: 'Condesa',
      address: 'Condesa, CDMX',
      themeColor: '#00B4D8',
      types: ['conferencias'],
      smokingAllowed: false,
      petFriendly: true,
      parkingAvailable: false,
      minAge: null,
    },
    {
      providerHandle: 'allons-sports',
      title: 'Padel Night: Doubles Mixer',
      description: 'Partidos rapidos, rotacion y drinks post-game.',
      startsAt: atHour(4, 20),
      endsAt: atHour(4, 22),
      city: 'CDMX',
      venue: 'Polanco Padel Club',
      address: 'Polanco, CDMX',
      themeColor: '#80ED99',
      types: ['fitness-y-entrenamiento', 'partidos-y-torneos'],
      smokingAllowed: false,
      petFriendly: false,
      parkingAvailable: true,
      minAge: 18,
    },
    {
      providerHandle: 'food-week',
      title: 'Cata: Vinos Naturales (Intro)',
      description: '6 vinos, maridaje ligero y guia para principiantes.',
      startsAt: atHour(6, 19),
      endsAt: atHour(6, 21),
      city: 'CDMX',
      venue: 'Roma Wine Bar',
      address: 'Roma Norte, CDMX',
      themeColor: '#FFB703',
      types: ['catas-de-vino-o-cerveza', 'festivales-gastronomicos'],
      smokingAllowed: false,
      petFriendly: false,
      parkingAvailable: false,
      minAge: 18,
    },
    {
      providerHandle: 'allons',
      title: 'Cine al Aire Libre: Classics',
      description: 'Proyeccion + picnic. Lleva manta.',
      startsAt: atHour(8, 20),
      endsAt: atHour(8, 23),
      city: 'CDMX',
      venue: 'Parque Mexico',
      address: 'Condesa, CDMX',
      themeColor: '#4CC9F0',
      types: ['cine-y-proyecciones', 'comidas'],
      smokingAllowed: false,
      petFriendly: true,
      parkingAvailable: false,
      minAge: null,
    },
    {
      providerHandle: 'tech-coffee',
      title: 'Workshop: API Design con NestJS',
      description: 'Buenas practicas, DTOs, validation y versionado.',
      startsAt: atHour(12, 18),
      endsAt: atHour(12, 21),
      city: 'CDMX',
      venue: 'Cowork Roma',
      address: 'Roma Norte, CDMX',
      themeColor: '#F72585',
      types: ['conferencias', 'hackathons'],
      smokingAllowed: false,
      petFriendly: false,
      parkingAvailable: false,
      minAge: null,
    },
  ];

  // Remove previously seeded events with same titles for these providers.
  const providerIds = [...providerMap.values()];
  const titles = events.map((e) => e.title);
  if (providerIds.length > 0) {
    await prisma.event.deleteMany({
      where: {
        providerId: { in: providerIds },
        title: { in: titles },
      },
    });
  }

  for (const e of events) {
    const providerId = providerMap.get(e.providerHandle);
    if (!providerId) continue;

    const created = await prisma.event.create({
      data: {
        providerId,
        title: e.title,
        description: e.description,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        city: e.city,
        venue: e.venue,
        address: e.address,
        themeColor: e.themeColor,
        smokingAllowed: e.smokingAllowed ?? false,
        petFriendly: e.petFriendly ?? false,
        parkingAvailable: e.parkingAvailable ?? false,
        minAge: e.minAge ?? null,
      },
    });

    const interestIds = (e.types ?? [])
      .map((slug) => interestMap.get(slug))
      .filter(Boolean) as string[];

    if (interestIds.length > 0) {
      await prisma.eventInterest.createMany({
        data: interestIds.map((interestId) => ({
          eventId: created.id,
          interestId,
        })),
        skipDuplicates: true,
      });
    }

    // Seed basic gallery media for the event (placeholder images).
    await prisma.eventMedia.createMany({
      data: [
        {
          eventId: created.id,
          url: 'https://picsum.photos/seed/allons-1/600/600',
          sortOrder: 0,
        },
        {
          eventId: created.id,
          url: 'https://picsum.photos/seed/allons-2/600/600',
          sortOrder: 1,
        },
        {
          eventId: created.id,
          url: 'https://picsum.photos/seed/allons-3/600/600',
          sortOrder: 2,
        },
      ],
      skipDuplicates: true,
    });
  }

  // Seed some provider reviews (for UI cards).
  for (const [handle, providerId] of providerMap.entries()) {
    if (!providerId || !handle) continue;

    const existing = await prisma.providerReview.count({ where: { providerId } });
    if (existing > 0) continue;

    await prisma.providerReview.createMany({
      data: [
        {
          providerId,
          authorName: 'Humberto',
          body: 'Todos tienen que ir a este evento. Muy recomendado.',
          rating: 5,
        },
        {
          providerId,
          authorName: 'Joseph Reyes',
          body: 'No caminen, corran a ver a este evento.',
          rating: 5,
        },
        {
          providerId,
          authorName: 'JR',
          body: 'Super recomendado.',
          rating: 5,
        },
      ],
    });
  }

  // Provider panel MVP seed: align with a real Supabase auth user id via env (optional).
  const demoPanelOwnerId =
    process.env.SEED_DEMO_PROVIDER_USER_ID ?? '11111111-1111-4111-8111-111111111111';
  const demoPanelHandle = 'demo-panel-comercio';
  const demoPanelProviderName = 'Comercio demo (panel)';

  await prisma.$executeRaw`
    INSERT INTO profiles (user_id, full_name, username, location, avatar_color)
    VALUES (
      ${demoPanelOwnerId}::uuid,
      ${demoPanelProviderName},
      ${'demo_comercio_panel'},
      ${'Tegucigalpa'},
      ${'#F67010'}
    )
    ON CONFLICT (user_id)
    DO UPDATE SET
      full_name = EXCLUDED.full_name,
      username = EXCLUDED.username,
      location = EXCLUDED.location,
      avatar_color = EXCLUDED.avatar_color,
      updated_at = now()
  `;

  await prisma.provider.upsert({
    where: { handle: demoPanelHandle },
    update: {
      name: demoPanelProviderName,
      description: 'Eventos, experiencias y activaciones para comunidad local.',
      websiteUrl: 'https://allonsapp.com',
    },
    create: {
      id: demoPanelOwnerId,
      handle: demoPanelHandle,
      name: demoPanelProviderName,
      description: 'Eventos, experiencias y activaciones para comunidad local.',
      websiteUrl: 'https://allonsapp.com',
    },
  });

  const demoPanelProvider = await prisma.provider.findUniqueOrThrow({
    where: { handle: demoPanelHandle },
    select: { id: true },
  });

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
    INSERT INTO provider_members (provider_id, user_id, role, active)
    VALUES (${demoPanelProvider.id}::uuid, ${demoPanelOwnerId}::uuid, 'owner', true)
    ON CONFLICT (provider_id, user_id)
    DO UPDATE SET role = 'owner', active = true, updated_at = now()
  `;

  await prisma.$executeRaw`
    ALTER TABLE events
    ADD COLUMN IF NOT EXISTS event_type text NOT NULL DEFAULT 'single'
  `;
  await prisma.$executeRaw`
    ALTER TABLE events
    ADD COLUMN IF NOT EXISTS recurrence text
  `;
  await prisma.$executeRaw`
    ALTER TABLE events
    ADD COLUMN IF NOT EXISTS recurrence_custom jsonb
  `;
  await prisma.$executeRaw`
    ALTER TABLE events
    ADD COLUMN IF NOT EXISTS ticket_mode text NOT NULL DEFAULT 'paid'
  `;
  await prisma.$executeRaw`
    ALTER TABLE events
    ADD COLUMN IF NOT EXISTS capacity integer NOT NULL DEFAULT 0
  `;
  await prisma.$executeRaw`
    ALTER TABLE events
    ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft'
  `;

  const demoPanelEventDefs = [
    {
      title: 'Clase funcional sunrise',
      city: 'Tegucigalpa',
      venue: 'Parque La Leona',
      dayOffset: 2,
      hour: 6,
      status: 'published',
      capacity: 80,
    },
    {
      title: 'Masterclass de cocina urbana',
      city: 'Tegucigalpa',
      venue: 'Distrito Food Hall',
      dayOffset: 5,
      hour: 18,
      status: 'published',
      capacity: 50,
    },
    {
      title: 'Networking pymes y creadores',
      city: 'San Pedro Sula',
      venue: 'Hub Norte',
      dayOffset: 8,
      hour: 19,
      status: 'draft',
      capacity: 120,
    },
  ];

  for (const def of demoPanelEventDefs) {
    const start = atHour(def.dayOffset, def.hour);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    const existing = await prisma.event.findFirst({
      where: { providerId: demoPanelProvider.id, title: def.title },
      select: { id: true },
    });
    const event = existing
      ? await prisma.event.update({
          where: { id: existing.id },
          data: {
            title: def.title,
            description: `${def.title} · cupos limitados.`,
            startsAt: start,
            endsAt: end,
            city: def.city,
            venue: def.venue,
            address: `${def.venue}, ${def.city}`,
            themeColor: '#F67010',
            createdBy: demoPanelOwnerId,
          },
        })
      : await prisma.event.create({
          data: {
            providerId: demoPanelProvider.id,
            title: def.title,
            description: `${def.title} · cupos limitados.`,
            startsAt: start,
            endsAt: end,
            city: def.city,
            venue: def.venue,
            address: `${def.venue}, ${def.city}`,
            themeColor: '#F67010',
            createdBy: demoPanelOwnerId,
          },
        });

    await prisma.$executeRaw`
      UPDATE events
      SET
        event_type = 'single',
        ticket_mode = 'paid',
        capacity = ${def.capacity},
        status = ${def.status}
      WHERE id = ${event.id}::uuid
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
      INSERT INTO provider_event_ticket_types (
        provider_id, event_id, name, kind, price, total, sold_count, active
      )
      VALUES (
        ${demoPanelProvider.id}::uuid,
        ${event.id}::uuid,
        ${'General'},
        ${'general'},
        ${180},
        ${def.capacity},
        ${Math.max(6, Math.floor(def.capacity * 0.15))},
        true
      )
      ON CONFLICT DO NOTHING
    `;
    await prisma.$executeRaw`
      INSERT INTO provider_event_ticket_types (
        provider_id, event_id, name, kind, price, total, sold_count, active
      )
      VALUES (
        ${demoPanelProvider.id}::uuid,
        ${event.id}::uuid,
        ${'VIP'},
        ${'vip'},
        ${350},
        ${Math.max(10, Math.floor(def.capacity * 0.2))},
        ${Math.max(2, Math.floor(def.capacity * 0.05))},
        true
      )
      ON CONFLICT DO NOTHING
    `;
  }

  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS provider_scan_records (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      ticket_id uuid,
      ticket_code text NOT NULL,
      attendee_name text,
      ticket_type text,
      scanned_by uuid NOT NULL,
      status text NOT NULL,
      scanned_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  const demoPanelEvents = await prisma.event.findMany({
    where: { providerId: demoPanelProvider.id },
    select: { id: true, title: true },
    take: 5,
  });
  for (const evt of demoPanelEvents) {
    await prisma.$executeRaw`
      INSERT INTO provider_scan_records (
        provider_id,
        event_id,
        ticket_code,
        attendee_name,
        ticket_type,
        scanned_by,
        status
      )
      VALUES (
        ${demoPanelProvider.id}::uuid,
        ${evt.id}::uuid,
        ${`seed-${evt.id.slice(0, 8)}`},
        ${'Asistente Seed'},
        ${'General'},
        ${demoPanelOwnerId}::uuid,
        ${'valid'}
      )
      ON CONFLICT DO NOTHING
    `;
  }

  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS provider_activity_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      type text NOT NULL,
      message text NOT NULL,
      meta text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await prisma.$executeRaw`
    INSERT INTO provider_activity_log (provider_id, type, message, meta)
    VALUES
      (${demoPanelProvider.id}::uuid, 'event', 'Seed inicial del panel provider', 'demo+comercio1@allonsapp.com'),
      (${demoPanelProvider.id}::uuid, 'sale', 'Ventas de ejemplo cargadas', 'dataset-seed'),
      (${demoPanelProvider.id}::uuid, 'scan', 'Escaneos de ejemplo cargados', 'dataset-seed')
    ON CONFLICT DO NOTHING
  `;

  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS provider_follows (
      user_id uuid NOT NULL,
      provider_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, provider_id)
    )
  `;
  await prisma.$executeRaw`
    INSERT INTO provider_follows (user_id, provider_id)
    VALUES (${demoPanelOwnerId}::uuid, ${demoPanelProvider.id}::uuid)
    ON CONFLICT (user_id, provider_id) DO NOTHING
  `;
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
