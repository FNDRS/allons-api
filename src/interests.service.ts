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
    const { data, error } = await this.supabaseAdmin.db
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
    const normalizedNames = [
      ...new Set(names.map((item) => item.trim()).filter(Boolean)),
    ];

    if (normalizedNames.length === 0) {
      throw new BadRequestException('At least one interest must be selected');
    }

    const { error: profileError } = await this.supabaseAdmin.db
      .from('profiles')
      .upsert(
        {
          user_id: userId,
          full_name: (metadata.name as string | undefined) ?? null,
          username: (metadata.username as string | undefined) ?? null,
        },
        { onConflict: 'user_id' },
      );

    if (profileError)
      throw new InternalServerErrorException(profileError.message);

    const { error: deleteError } = await this.supabaseAdmin.db
      .from('profile_interests')
      .delete()
      .eq('user_id', userId);
    if (deleteError)
      throw new InternalServerErrorException(deleteError.message);

    const { error: upsertInterestsError } = await this.supabaseAdmin.db
      .from('interests')
      .upsert(
        normalizedNames.map((name) => ({ name })),
        {
          onConflict: 'name',
          ignoreDuplicates: true,
        },
      );
    if (upsertInterestsError)
      throw new InternalServerErrorException(upsertInterestsError.message);

    const { data: interests, error: interestsError } =
      await this.supabaseAdmin.db
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
      const { error: insertError } = await this.supabaseAdmin.db
        .from('profile_interests')
        .insert(rowsToInsert);
      if (insertError)
        throw new InternalServerErrorException(insertError.message);
    }

    return normalizedNames;
  }
}
