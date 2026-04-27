import { PrismaClient } from '../generated/prisma';

const prisma = new PrismaClient();

async function main() {
  // Keep seed deterministic and safe to re-run.
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

  const events = [
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

    await prisma.event.create({
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
      },
    });
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
