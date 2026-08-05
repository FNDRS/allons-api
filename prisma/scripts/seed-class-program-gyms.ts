/**
 * Adds gym `providers`, each with one published `class_program` (weekly
 * schedule + a drop_in/pack/unlimited package mix), so the client-facing
 * buy-sessions / reserve-a-class flow can be tested against real data.
 *
 * Purely additive: unlike `fresh-start-seed.ts` this never deletes anything.
 * Providers are upserted by `handle`, and a program is skipped when one with
 * the same title already exists for that provider, so re-running is a no-op.
 *
 * Mirrors the INSERT shape of
 * `ClassProgramsRepository.createProgramWithChildren` (same columns, same
 * casts) so seeded rows are indistinguishable from API-created ones.
 *
 * Env: DATABASE_URL
 *
 * `generated/prisma` is gitignored, so a fresh checkout must generate the
 * client before this script can import it — same reason the `db:seed:*`
 * entries in package.json all prefix `prisma generate`.
 *
 * Run: cd allons-api && pnpm exec prisma generate \
 *        && pnpm exec ts-node --transpile-only \
 *           prisma/scripts/seed-class-program-gyms.ts
 */

import { PrismaClient } from '../../generated/prisma';

const prisma = new PrismaClient();

type PackageSpec = {
  name: string;
  price: number;
  kind: 'drop_in' | 'pack' | 'unlimited';
  credits: number | null;
  validityDays: number | null;
  sortOrder: number;
};

type TemplateSpec = {
  /** 0 = Sunday … 6 = Saturday, matching `class_session_templates.weekday`. */
  weekday: number;
  startTime: string;
  /** Null falls back to the program's own value. */
  durationMinutes: number | null;
  capacity: number | null;
  instructorName: string | null;
};

type GymSpec = {
  providerName: string;
  providerHandle: string;
  providerDescription: string;
  program: {
    title: string;
    description: string;
    discipline: string;
    instructorName: string;
    durationMinutes: number;
    capacityPerSession: number;
    locationName: string;
    address: string;
    city: string;
  };
  templates: TemplateSpec[];
  packages: PackageSpec[];
};

/** drop-in + 8-session pack + monthly unlimited, priced off a single per-class base. */
function standardPackages(basePrice: number): PackageSpec[] {
  return [
    {
      name: 'Entrada suelta',
      price: basePrice,
      kind: 'drop_in',
      credits: 1,
      validityDays: null,
      sortOrder: 0,
    },
    {
      name: 'Pack 8 sesiones',
      price: Math.round(basePrice * 6.2),
      kind: 'pack',
      credits: 8,
      validityDays: 45,
      sortOrder: 1,
    },
    {
      name: 'Pase ilimitado mensual',
      price: Math.round(basePrice * 11),
      kind: 'unlimited',
      credits: null,
      validityDays: 30,
      sortOrder: 2,
    },
  ];
}

const GYMS: GymSpec[] = [
  {
    providerName: 'Erei Wellness',
    providerHandle: 'erei-wellness',
    providerDescription:
      'Estudio de entrenamiento funcional en Tegucigalpa. Cupos limitados por sesión.',
    program: {
      title: 'Erei Crossfit',
      description:
        'Entrenamiento funcional de alta intensidad, clases de 60 minutos.',
      discipline: 'Crossfit',
      instructorName: 'Francisco Guillén',
      durationMinutes: 60,
      capacityPerSession: 12,
      locationName: 'Erei Wellness',
      address: 'Col. Palmira, Tegucigalpa',
      city: 'Tegucigalpa',
    },
    templates: [
      { weekday: 1, startTime: '06:00', durationMinutes: null, capacity: null, instructorName: null },
      { weekday: 3, startTime: '06:00', durationMinutes: null, capacity: null, instructorName: null },
      // Smaller Friday cap exercises the per-template capacity override.
      { weekday: 5, startTime: '06:00', durationMinutes: null, capacity: 10, instructorName: null },
      { weekday: 2, startTime: '18:00', durationMinutes: null, capacity: null, instructorName: 'Andrea Reyes' },
      { weekday: 4, startTime: '18:00', durationMinutes: null, capacity: null, instructorName: 'Andrea Reyes' },
    ],
    packages: standardPackages(150),
  },
  {
    providerName: 'Reformer Studio SPS',
    providerHandle: 'reformer-studio-sps',
    providerDescription:
      'Pilates reformer en San Pedro Sula, cupo reducido por clase para atención personalizada.',
    program: {
      title: 'Reformer Pilates',
      description: 'Clases de pilates reformer de 50 minutos, todos los niveles.',
      discipline: 'Pilates',
      instructorName: 'Andrea González',
      durationMinutes: 50,
      capacityPerSession: 8,
      locationName: 'Reformer Studio SPS',
      address: 'Col. Trejo, San Pedro Sula',
      city: 'San Pedro Sula',
    },
    templates: [
      { weekday: 1, startTime: '07:00', durationMinutes: null, capacity: null, instructorName: null },
      { weekday: 3, startTime: '07:00', durationMinutes: null, capacity: null, instructorName: null },
      { weekday: 2, startTime: '17:30', durationMinutes: null, capacity: null, instructorName: null },
      { weekday: 4, startTime: '17:30', durationMinutes: null, capacity: null, instructorName: null },
      // A 6-spot Saturday makes the "last spot" / sold-out path easy to reach.
      { weekday: 6, startTime: '09:00', durationMinutes: 60, capacity: 6, instructorName: 'Andrea González' },
    ],
    packages: standardPackages(220),
  },
  {
    providerName: 'RAVA Studio',
    providerHandle: 'rava-studio',
    providerDescription:
      'Espacio de movimiento funcional en Tegucigalpa, clases matutinas y fin de semana.',
    program: {
      title: 'RAVA Open',
      description:
        'Sesiones abiertas de movilidad y acondicionamiento funcional, 45 minutos.',
      discipline: 'Funcional',
      instructorName: 'Diego Martínez',
      durationMinutes: 45,
      capacityPerSession: 15,
      locationName: 'RAVA Studio',
      address: 'Col. Kennedy, Tegucigalpa',
      city: 'Tegucigalpa',
    },
    templates: [
      { weekday: 1, startTime: '06:30', durationMinutes: null, capacity: null, instructorName: null },
      { weekday: 2, startTime: '06:30', durationMinutes: null, capacity: null, instructorName: null },
      { weekday: 3, startTime: '06:30', durationMinutes: null, capacity: null, instructorName: null },
      { weekday: 4, startTime: '06:30', durationMinutes: null, capacity: null, instructorName: null },
      { weekday: 5, startTime: '06:30', durationMinutes: null, capacity: null, instructorName: null },
      { weekday: 6, startTime: '08:00', durationMinutes: 60, capacity: 20, instructorName: null },
    ],
    packages: standardPackages(130),
  },
];

async function ensureProvider(spec: GymSpec): Promise<string> {
  const provider = await prisma.provider.upsert({
    where: { handle: spec.providerHandle },
    update: {},
    create: {
      name: spec.providerName,
      handle: spec.providerHandle,
      description: spec.providerDescription,
      websiteUrl: 'https://allonsapp.com',
    },
  });
  return provider.id;
}

async function findExistingProgramId(
  providerId: string,
  title: string,
): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id::text AS id FROM class_programs
    WHERE provider_id = ${providerId}::uuid AND title = ${title}
    LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

async function createProgramWithChildren(
  providerId: string,
  spec: GymSpec,
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO class_programs (
        provider_id, title, description, discipline, instructor_name,
        duration_minutes, capacity_per_session, location_name, address, city,
        latitude, longitude, cover_image_url, theme_color, status
      ) VALUES (
        ${providerId}::uuid, ${spec.program.title}, ${spec.program.description},
        ${spec.program.discipline}, ${spec.program.instructorName},
        ${spec.program.durationMinutes}, ${spec.program.capacityPerSession},
        ${spec.program.locationName}, ${spec.program.address},
        ${spec.program.city}, NULL, NULL, NULL, NULL, 'published'
      )
      RETURNING id::text AS id
    `;
    const programId = rows[0].id;

    for (const template of spec.templates) {
      await tx.$executeRaw`
        INSERT INTO class_session_templates (
          program_id, weekday, start_time, duration_minutes, capacity,
          instructor_name, active
        ) VALUES (
          ${programId}::uuid, ${template.weekday}, ${template.startTime}::time,
          ${template.durationMinutes}, ${template.capacity},
          ${template.instructorName}, true
        )
      `;
    }

    for (const item of spec.packages) {
      await tx.$executeRaw`
        INSERT INTO class_packages (
          program_id, name, price, credits, validity_days, kind, active,
          sort_order
        ) VALUES (
          ${programId}::uuid, ${item.name}, ${item.price}, ${item.credits},
          ${item.validityDays}, ${item.kind}, true, ${item.sortOrder}
        )
      `;
    }

    return programId;
  });
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL es obligatorio.');
  }

  console.log('[seed-class-gyms] creando gimnasios de prueba…');
  for (const gym of GYMS) {
    const providerId = await ensureProvider(gym);
    const existing = await findExistingProgramId(providerId, gym.program.title);
    if (existing) {
      console.log(
        `  omitido: "${gym.program.title}" ya existe en ${gym.providerHandle} (${existing})`,
      );
      continue;
    }
    const programId = await createProgramWithChildren(providerId, gym);
    console.log(
      `  creado: ${gym.providerName} → "${gym.program.title}" (${programId}), ` +
        `${gym.templates.length} horarios, ${gym.packages.length} paquetes`,
    );
  }
  console.log('[seed-class-gyms] listo.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
