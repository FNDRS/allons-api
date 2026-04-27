import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseAdminService } from './supabase-admin.service';

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
      throw new BadRequestException('At least one interest must be selected');
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

    const { error: upsertInterestsError } = await db.from('interests').upsert(
      normalizedNames.map((name) => ({ name })),
      {
        onConflict: 'name',
        ignoreDuplicates: true,
      },
    );
    if (upsertInterestsError)
      throw new InternalServerErrorException(upsertInterestsError.message);

    const { data: interests, error: interestsError } = await db
      .from('interests')
      .select('id,name')
      .in('name', normalizedNames);
    if (interestsError)
      throw new InternalServerErrorException(interestsError.message);

    const rowsToInsert = (interests ?? []).map((interest: { id: string }) => ({
      user_id: userId,
      interest_id: interest.id,
    }));

    if (rowsToInsert.length > 0) {
      const { error: insertError } = await db
        .from('profile_interests')
        .insert(rowsToInsert);
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
