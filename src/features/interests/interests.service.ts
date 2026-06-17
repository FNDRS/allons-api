import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';

@Injectable()
export class InterestsService {
  constructor(private readonly supabaseAdmin: SupabaseAdminService) {}

  async getUserInterestNames(userId: string) {
    const db = this.supabaseAdmin.db as any;
    const { data, error } = await db
      .from('profile_interests')
      .select('interest:interests(name)')
      .eq('user_id', userId);

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return (data ?? [])
      .map(
        (row: { interest: { name?: string } | { name?: string }[] | null }) => {
          if (Array.isArray(row.interest)) return row.interest[0]?.name;
          return row.interest?.name;
        },
      )
      .filter((name): name is string => Boolean(name));
  }

  async replaceUserInterests(
    userId: string,
    metadata: Record<string, unknown>,
    names: string[],
  ) {
    const db = this.supabaseAdmin.db as any;
    const normalizedNames = [
      ...new Set(names.map((item) => item.trim()).filter(Boolean)),
    ];

    if (normalizedNames.length === 0) {
      throw new BadRequestException('Debes seleccionar al menos un interés');
    }

    const fullName =
      getMetadataString(metadata, 'name') ??
      getMetadataString(metadata, 'full_name') ??
      null;
    const preferredUsername =
      getMetadataString(metadata, 'username') ??
      getMetadataString(metadata, 'preferred_username') ??
      null;

    const { error: profileError } = await db.from('profiles').upsert(
      {
        user_id: userId,
        full_name: fullName,
        username: preferredUsername,
      },
      { onConflict: 'user_id' },
    );

    if (profileError) {
      const isUsernameConflict =
        profileError.code === '23505' ||
        String(profileError.message).includes('profiles_username_key');

      if (isUsernameConflict) {
        const { error: fallbackProfileError } = await db
          .from('profiles')
          .upsert(
            {
              user_id: userId,
              full_name: fullName,
              username: null,
            },
            { onConflict: 'user_id' },
          );

        if (fallbackProfileError) {
          throw new InternalServerErrorException(fallbackProfileError.message);
        }
      } else {
        throw new InternalServerErrorException(profileError.message);
      }
    }

    const { error: deleteError } = await db
      .from('profile_interests')
      .delete()
      .eq('user_id', userId);
    if (deleteError)
      throw new InternalServerErrorException(deleteError.message);

    /** One row per slug so we never hit `interests_slug_key` when names differ but slugs match (e.g. seed `Musica` vs app `Música`). */
    const slugToDisplayName = new Map<string, string>();
    for (const name of normalizedNames) {
      const slug = toSlug(name);
      if (!slug) {
        throw new BadRequestException(`Interés inválido: "${name}"`);
      }
      if (!slugToDisplayName.has(slug)) slugToDisplayName.set(slug, name);
    }
    const slugs = [...slugToDisplayName.keys()];
    const displayNames = [...slugToDisplayName.values()];

    // Reuse interests that already exist by slug OR name. Legacy rows can carry
    // the same display name under a different slug, so inserting the computed
    // slug would trip `interests_name_key`; matching by name avoids that.
    const [bySlugResult, byNameResult] = await Promise.all([
      db.from('interests').select('id,name,slug').in('slug', slugs),
      db.from('interests').select('id,name,slug').in('name', displayNames),
    ]);
    if (bySlugResult.error)
      throw new InternalServerErrorException(bySlugResult.error.message);
    if (byNameResult.error)
      throw new InternalServerErrorException(byNameResult.error.message);

    const interestIdBySlug = new Map<string, string>();
    const interestIdByName = new Map<string, string>();
    for (const row of bySlugResult.data ?? []) {
      if (row?.id && row?.slug) interestIdBySlug.set(row.slug, row.id);
    }
    for (const row of byNameResult.data ?? []) {
      if (row?.id && row?.name) interestIdByName.set(row.name, row.id);
    }

    // Create only the interests that exist under neither slug nor name.
    const missingRows = slugs
      .map((slug) => ({ slug, name: slugToDisplayName.get(slug)! }))
      .filter(
        ({ slug, name }) =>
          !interestIdBySlug.has(slug) && !interestIdByName.has(name),
      );
    if (missingRows.length > 0) {
      const { error: createInterestsError } = await db
        .from('interests')
        .upsert(missingRows, { onConflict: 'slug', ignoreDuplicates: true });
      if (createInterestsError)
        throw new InternalServerErrorException(createInterestsError.message);

      const { data: createdInterests, error: createdError } = await db
        .from('interests')
        .select('id,slug')
        .in(
          'slug',
          missingRows.map((row) => row.slug),
        );
      if (createdError)
        throw new InternalServerErrorException(createdError.message);
      for (const row of createdInterests ?? []) {
        if (row?.id && row?.slug) interestIdBySlug.set(row.slug, row.id);
      }
    }

    // Resolve each slug to an interest id, preferring slug then name match.
    const seenInterestIds = new Set<string>();
    const rowsToInsert: { user_id: string; interest_id: string }[] = [];
    for (const slug of slugs) {
      const name = slugToDisplayName.get(slug)!;
      const interestId =
        interestIdBySlug.get(slug) ?? interestIdByName.get(name);
      if (!interestId || seenInterestIds.has(interestId)) continue;
      seenInterestIds.add(interestId);
      rowsToInsert.push({ user_id: userId, interest_id: interestId });
    }

    if (rowsToInsert.length !== slugs.length) {
      throw new InternalServerErrorException(
        'No se pudieron resolver todos los intereses tras guardar.',
      );
    }

    if (rowsToInsert.length > 0) {
      const { error: insertError } = await db
        .from('profile_interests')
        .upsert(rowsToInsert, {
          onConflict: 'user_id,interest_id',
          ignoreDuplicates: true,
        });
      if (insertError)
        throw new InternalServerErrorException(insertError.message);
    }

    return normalizedNames;
  }
}

function getMetadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function toSlug(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' y ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
