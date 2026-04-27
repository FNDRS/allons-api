import { PrismaClient } from '../generated/prisma';

const prisma = new PrismaClient();

async function main() {
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

  const providerMap = new Map(
    (await prisma.provider.findMany({ where: { handle: { in: providers.map((p) => p.handle) } } }))
      .map((p) => [p.handle ?? '', p.id]),
  );

  const now = new Date();
  const addDays = (d: number) => new Date(now.getTime() + d * 24 * 60 * 60 * 1000);

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
      startsAt: new Date(addDays(5).setHours(23, 0, 0, 0)),
      endsAt: new Date(addDays(6).setHours(5, 0, 0, 0)),
      city: 'CDMX',
      venue: 'Warehouse Norte',
      address: 'Norte, CDMX',
      themeColor: '#FF4D6D',
    },
    {
      providerHandle: 'tech-coffee',
      title: 'Meetup: React Native + Supabase',
      description: 'Charlas cortas + networking.',
      startsAt: new Date(addDays(7).setHours(19, 0, 0, 0)),
      endsAt: new Date(addDays(7).setHours(21, 0, 0, 0)),
      city: 'CDMX',
      venue: 'Cafe Roma',
      address: 'Roma Norte, CDMX',
      themeColor: '#2EC4B6',
    },
    {
      providerHandle: 'arte-abierto',
      title: 'Noche de Galerias',
      description: 'Recorrido por galerias y exhibiciones.',
      startsAt: new Date(addDays(10).setHours(18, 0, 0, 0)),
      endsAt: new Date(addDays(10).setHours(22, 0, 0, 0)),
      city: 'CDMX',
      venue: 'Juarez',
      address: 'Col. Juarez, CDMX',
      themeColor: '#FFA62B',
    },
  ];

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
