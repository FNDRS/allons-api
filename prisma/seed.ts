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
  }
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
