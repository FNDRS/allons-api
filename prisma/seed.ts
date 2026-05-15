import { PrismaClient } from '../generated/prisma';

const prisma = new PrismaClient();

async function main() {
  // Idempotent: safe to run multiple times.
  const interestLabels: Array<{ slug: string; name: string }> = [
    { slug: 'cine-y-proyecciones', name: 'Cine y proyecciones' },
    { slug: 'festivales-culturales', name: 'Festivales culturales' },
    { slug: 'exhibiciones-de-arte', name: 'Exhibiciones de Arte' },
    { slug: 'musica', name: 'Música' },
    { slug: 'ciencia-y-tecnologia', name: 'Ciencia y tecnología' },
    { slug: 'comic-cons', name: 'Comic-Cons' },
    { slug: 'conciertos', name: 'Conciertos' },
    { slug: 'fitness-y-entrenamiento', name: 'Fitness y entrenamiento' },
    { slug: 'partidos-y-torneos', name: 'Partidos y torneos' },
    { slug: 'conferencias', name: 'Conferencias' },
    { slug: 'hackathons', name: 'Hackathons' },
    { slug: 'catas-de-vino-o-cerveza', name: 'Catas de vino o cerveza' },
    { slug: 'festivales-gastronomicos', name: 'Festivales gastronómicos' },
    { slug: 'raves', name: 'Raves' },
    { slug: 'gaming-y-e-sports', name: 'Gaming y e-sports' },
    { slug: 'ferias-y-convenciones', name: 'Ferias y convenciones' },
    { slug: 'comidas', name: 'Comidas' },
    { slug: 'bares-and-drinks', name: 'Bares & drinks' },
  ];

  for (const i of interestLabels) {
    await prisma.interest.upsert({
      where: { slug: i.slug },
      update: { name: i.name, slug: i.slug },
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

  type SeedTicketType = {
    name: string;
    kind: string;
    price: number;
    total: number;
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
    eventType: string;
    ticketMode: string;
    capacity: number;
    status: string;
    recurrence?: string | null;
    recurrenceCustom?: Record<string, unknown> | null;
    ticketTypes: SeedTicketType[];
  }> = [
    {
      providerHandle: 'allons',
      title: 'After Office: terrace sunset',
      description: 'Música en vivo, cerveza artesanal y atardecer en la terraza.',
      startsAt: addDays(2),
      endsAt: new Date(addDays(2).getTime() + 3 * 60 * 60 * 1000),
      city: 'Tegucigalpa',
      venue: 'Hotel Honduras Maya — Terraza',
      address: 'Col. Palmira, frente a La Leona, Tegucigalpa',
      themeColor: '#7C4DFF',
      types: ['musica', 'bares-and-drinks'],
      smokingAllowed: true,
      petFriendly: false,
      parkingAvailable: true,
      minAge: 18,
      eventType: 'single',
      ticketMode: 'single_access',
      capacity: 220,
      status: 'published',
      ticketTypes: [
        { name: 'Entrada general', kind: 'general', price: 485, total: 180 },
        { name: 'Preventa', kind: 'early', price: 350, total: 40 },
        { name: 'Mesa VIP (4 pax)', kind: 'vip', price: 2200, total: 12 },
      ],
    },
    {
      providerHandle: 'cdmx-nightlife',
      title: 'Noche electrónica — sala industrial',
      description: 'Lineup local + invitado regional. Cupo limitado.',
      startsAt: atHour(5, 22),
      endsAt: atHour(6, 4),
      city: 'San Pedro Sula',
      venue: 'Bodega 504',
      address: 'Zona Hipódromo, bloque 8, San Pedro Sula',
      themeColor: '#FF4D6D',
      types: ['raves', 'musica'],
      smokingAllowed: false,
      petFriendly: false,
      parkingAvailable: true,
      minAge: 18,
      eventType: 'single',
      ticketMode: 'single_access',
      capacity: 450,
      status: 'published',
      ticketTypes: [
        { name: 'General', kind: 'general', price: 720, total: 300 },
        { name: 'Preventa', kind: 'early', price: 520, total: 80 },
        { name: 'Backstage', kind: 'vip', price: 1350, total: 70 },
      ],
    },
    {
      providerHandle: 'tech-coffee',
      title: 'Meetup: React Native en producción',
      description: 'Charlas de 20 min + networking con café incluido.',
      startsAt: atHour(7, 18),
      endsAt: atHour(7, 21),
      city: 'La Ceiba',
      venue: 'Cowork Atlántida',
      address: 'Av. San Isidro, La Ceiba, Atlántida',
      themeColor: '#2EC4B6',
      types: ['conferencias', 'ciencia-y-tecnologia'],
      smokingAllowed: false,
      petFriendly: true,
      parkingAvailable: false,
      minAge: null,
      eventType: 'single',
      ticketMode: 'single_access',
      capacity: 80,
      status: 'published',
      ticketTypes: [{ name: 'Participante', kind: 'general', price: 195, total: 80 }],
    },
    {
      providerHandle: 'arte-abierto',
      title: 'Recorrido de galerías nocturno',
      description: 'Cuatro sedes con guía; última parada con vino de honor.',
      startsAt: atHour(10, 18),
      endsAt: atHour(10, 23),
      city: 'Roatán',
      venue: 'West Bay Gallery Walk',
      address: 'West Bay Beach, Roatán, Islas de la Bahía',
      themeColor: '#FFA62B',
      types: ['exhibiciones-de-arte', 'festivales-culturales'],
      smokingAllowed: false,
      petFriendly: true,
      parkingAvailable: true,
      minAge: null,
      eventType: 'single',
      ticketMode: 'single_access',
      capacity: 65,
      status: 'published',
      ticketTypes: [
        { name: 'Recorrido completo', kind: 'general', price: 650, total: 55 },
        { name: 'Estudiante', kind: 'early', price: 420, total: 10 },
      ],
    },
    {
      providerHandle: 'fndrs',
      title: 'Startup breakfast — métricas y retención',
      description: 'Café, 3 mesas redondas y pitch relámpago.',
      startsAt: atHour(3, 7),
      endsAt: atHour(3, 10),
      city: 'Comayagüela',
      venue: 'Centro de convenciones MDC',
      address: 'Centro histórico, Comayagüela',
      themeColor: '#00B4D8',
      types: ['conferencias'],
      smokingAllowed: false,
      petFriendly: false,
      parkingAvailable: true,
      minAge: null,
      eventType: 'single',
      ticketMode: 'single_access',
      capacity: 95,
      status: 'draft',
      ticketTypes: [
        { name: 'Early bird', kind: 'early', price: 275, total: 30 },
        { name: 'General', kind: 'general', price: 380, total: 65 },
      ],
    },
    {
      providerHandle: 'allons-sports',
      title: 'Torneo relámpago de pádel — dobles',
      description: 'Partidos de 12 min; premios patrocinados. Nivel intermedio.',
      startsAt: atHour(4, 19),
      endsAt: atHour(4, 23),
      city: 'El Progreso',
      venue: 'Club Deportivo Progreso',
      address: 'Blvd. Morazán, El Progreso, Yoro',
      themeColor: '#80ED99',
      types: ['fitness-y-entrenamiento', 'partidos-y-torneos'],
      smokingAllowed: false,
      petFriendly: false,
      parkingAvailable: true,
      minAge: 16,
      eventType: 'single',
      ticketMode: 'single_access',
      capacity: 48,
      status: 'published',
      ticketTypes: [
        { name: 'Equipo (2 jugadores)', kind: 'general', price: 880, total: 24 },
        { name: 'Suplente / lista de espera', kind: 'general', price: 120, total: 24 },
      ],
    },
    {
      providerHandle: 'food-week',
      title: 'Cata: cafés de altura y maridaje',
      description: 'Seis orígenes hondureños + tablilla de chocolate local.',
      startsAt: atHour(6, 17),
      endsAt: atHour(6, 20),
      city: 'Santa Rosa de Copán',
      venue: 'Café Don Romeo — sala cátedra',
      address: 'Barrio El Carmen, Santa Rosa de Copán',
      themeColor: '#FFB703',
      types: ['catas-de-vino-o-cerveza', 'festivales-gastronomicos'],
      smokingAllowed: false,
      petFriendly: false,
      parkingAvailable: false,
      minAge: 18,
      eventType: 'single',
      ticketMode: 'single_access',
      capacity: 32,
      status: 'published',
      ticketTypes: [
        { name: 'Cupping guiado', kind: 'general', price: 595, total: 24 },
        { name: 'Preventa', kind: 'early', price: 465, total: 8 },
      ],
    },
    {
      providerHandle: 'allons',
      title: 'Cine bajo las estrellas — clásicos latinoamericanos',
      description: 'Proyección al aire libre; lleva silla o manta.',
      startsAt: atHour(8, 19),
      endsAt: atHour(8, 23),
      city: 'Choluteca',
      venue: 'Parque Manuel José Valenzuela',
      address: 'Centro de Choluteca',
      themeColor: '#4CC9F0',
      types: ['cine-y-proyecciones', 'comidas'],
      smokingAllowed: false,
      petFriendly: true,
      parkingAvailable: false,
      minAge: null,
      eventType: 'single',
      ticketMode: 'free',
      capacity: 500,
      status: 'published',
      ticketTypes: [{ name: 'Acceso sin costo (registro)', kind: 'general', price: 0, total: 500 }],
    },
    {
      providerHandle: 'tech-coffee',
      title: 'Taller intensivo: APIs con NestJS',
      description: 'DTOs, pipes, Prisma y pruebas. Trae laptop.',
      startsAt: atHour(12, 9),
      endsAt: atHour(12, 17),
      city: 'Puerto Cortés',
      venue: 'Cluster Tecnológico Cortés',
      address: 'Zona portuaria, Puerto Cortés',
      themeColor: '#F72585',
      types: ['conferencias', 'hackathons'],
      smokingAllowed: false,
      petFriendly: false,
      parkingAvailable: true,
      minAge: 18,
      eventType: 'single',
      ticketMode: 'single_access',
      capacity: 36,
      status: 'published',
      ticketTypes: [
        { name: 'Boleto taller', kind: 'general', price: 1650, total: 28 },
        { name: 'Estudiante / indie', kind: 'early', price: 1190, total: 8 },
      ],
    },
    {
      providerHandle: 'fndrs',
      title: 'Yoga matutino — paquete mensual',
      description: 'Lunes y miércoles 6:15. Compra el paquete de 8 sesiones.',
      startsAt: atHour(1, 6),
      endsAt: atHour(1, 7),
      city: 'San Pedro Sula',
      venue: 'Studio Bhakti — Zona Kinke',
      address: '12 Avenida, 8 y 9 Calle NE, San Pedro Sula',
      themeColor: '#8338EC',
      types: ['fitness-y-entrenamiento'],
      smokingAllowed: false,
      petFriendly: true,
      parkingAvailable: false,
      minAge: null,
      eventType: 'recurring_class',
      ticketMode: 'class_pack',
      capacity: 18,
      status: 'published',
      recurrence: 'weekly',
      recurrenceCustom: {
        interval: 1,
        unit: 'week',
        weekDays: ['monday', 'wednesday'],
        endType: 'never',
      },
      ticketTypes: [
        { name: 'Paquete 8 clases (mes en curso)', kind: 'general', price: 1380, total: 18 },
      ],
    },
  ];

  // Remove prior events with the same title for these providers.
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

    // Sample gallery images for the event detail screen.
    await prisma.eventMedia.createMany({
      data: [
        {
          eventId: created.id,
          url: 'https://picsum.photos/id/24/600/600',
          sortOrder: 0,
        },
        {
          eventId: created.id,
          url: 'https://picsum.photos/id/37/600/600',
          sortOrder: 1,
        },
        {
          eventId: created.id,
          url: 'https://picsum.photos/id/48/600/600',
          sortOrder: 2,
        },
      ],
      skipDuplicates: true,
    });

    await prisma.$executeRaw`
      UPDATE events
      SET
        event_type = ${e.eventType},
        ticket_mode = ${e.ticketMode},
        capacity = ${e.capacity},
        status = ${e.status},
        recurrence = ${e.recurrence ?? null}
      WHERE id = ${created.id}::uuid
    `;
    if (e.recurrenceCustom != null) {
      await prisma.$executeRaw`
        UPDATE events
        SET recurrence_custom = ${JSON.stringify(e.recurrenceCustom)}::jsonb
        WHERE id = ${created.id}::uuid
      `;
    } else {
      await prisma.$executeRaw`
        UPDATE events SET recurrence_custom = NULL WHERE id = ${created.id}::uuid
      `;
    }

    await prisma.$executeRaw`
      DELETE FROM provider_event_ticket_types WHERE event_id = ${created.id}::uuid
    `;
    for (const tt of e.ticketTypes) {
      await prisma.$executeRaw`
        INSERT INTO provider_event_ticket_types (
          provider_id, event_id, name, kind, price, total, sold_count, active
        )
        VALUES (
          ${providerId}::uuid,
          ${created.id}::uuid,
          ${tt.name},
          ${tt.kind},
          ${tt.price},
          ${tt.total},
          0,
          true
        )
      `;
    }
  }

  // Sample reviews for provider cards in the app.
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

  // Provider panel: ties to the real Supabase Auth user UUID (optional env var).
  const panelProviderUserId =
    process.env.SEED_PANEL_PROVIDER_USER_ID ??
    process.env.SEED_DEMO_PROVIDER_USER_ID ??
    '11111111-1111-4111-8111-111111111111';
  const panelProviderHandle = 'producciones-meta';
  const panelOrganizerName = 'Roberto Mata';
  const panelProviderDisplayName = 'Producciones Meta';

  await prisma.$executeRaw`
    INSERT INTO profiles (user_id, full_name, username, location, avatar_color)
    VALUES (
      ${panelProviderUserId}::uuid,
      ${panelOrganizerName},
      ${'roberto.mata'},
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
    where: { handle: panelProviderHandle },
    update: {
      name: panelProviderDisplayName,
      description:
        'Producción de experiencias presenciales: talleres, activaciones y eventos corporativos en Honduras.',
      websiteUrl: 'https://allonsapp.com',
    },
    create: {
      id: panelProviderUserId,
      handle: panelProviderHandle,
      name: panelProviderDisplayName,
      description:
        'Producción de experiencias presenciales: talleres, activaciones y eventos corporativos en Honduras.',
      websiteUrl: 'https://allonsapp.com',
    },
  });

  const panelProvider = await prisma.provider.findUniqueOrThrow({
    where: { handle: panelProviderHandle },
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
    VALUES (${panelProvider.id}::uuid, ${panelProviderUserId}::uuid, 'owner', true)
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

  const panelProviderEventDefs = [
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

  for (const def of panelProviderEventDefs) {
    const start = atHour(def.dayOffset, def.hour);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    const existing = await prisma.event.findFirst({
      where: { providerId: panelProvider.id, title: def.title },
      select: { id: true },
    });
    const event = existing
      ? await prisma.event.update({
          where: { id: existing.id },
          data: {
            title: def.title,
            description: `${def.title}. Reservas con anticipación; aforo limitado.`,
            startsAt: start,
            endsAt: end,
            city: def.city,
            venue: def.venue,
            address: `${def.venue}, ${def.city}`,
            themeColor: '#F67010',
            createdBy: panelProviderUserId,
          },
        })
      : await prisma.event.create({
          data: {
            providerId: panelProvider.id,
            title: def.title,
            description: `${def.title}. Reservas con anticipación; aforo limitado.`,
            startsAt: start,
            endsAt: end,
            city: def.city,
            venue: def.venue,
            address: `${def.venue}, ${def.city}`,
            themeColor: '#F67010',
            createdBy: panelProviderUserId,
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
        ${panelProvider.id}::uuid,
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
        ${panelProvider.id}::uuid,
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
  const panelEvents = await prisma.event.findMany({
    where: { providerId: panelProvider.id },
    select: { id: true, title: true },
    take: 5,
  });
  for (const evt of panelEvents) {
    const ticketRef = `ING-${evt.id.replace(/-/g, '').slice(0, 10).toUpperCase()}`;
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
        ${panelProvider.id}::uuid,
        ${evt.id}::uuid,
        ${ticketRef},
        ${'Laura Méndez'},
        ${'General'},
        ${panelProviderUserId}::uuid,
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
      (${panelProvider.id}::uuid, 'event', 'Calendario actualizado: nuevas fechas publicadas', 'panel'),
      (${panelProvider.id}::uuid, 'sale', 'Corte de ventas: entradas generales y VIP', 'panel'),
      (${panelProvider.id}::uuid, 'scan', 'Validaciones de acceso registradas en taquilla', 'panel')
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
    VALUES (${panelProviderUserId}::uuid, ${panelProvider.id}::uuid)
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
