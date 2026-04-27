import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseAdminService } from './supabase-admin.service';

@Injectable()
export class AccountService {
  constructor(private readonly supabaseAdmin: SupabaseAdminService) {}

  async deleteAccount(userId: string) {
    const { error } = await this.supabaseAdmin.db.auth.admin.deleteUser(
      userId,
      true,
    );

    if (error) {
      throw new InternalServerErrorException(error.message);
    }
  }
}
