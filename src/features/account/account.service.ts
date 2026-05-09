import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';

@Injectable()
export class AccountService {
  constructor(
    private readonly supabaseAdmin: SupabaseAdminService,
    private readonly prisma: PrismaService,
  ) {}

  private async ensureDeletionRequestsTable() {
    await this.prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS account_deletion_requests (
        user_id uuid PRIMARY KEY,
        email text,
        requested_at timestamptz NOT NULL DEFAULT now()
      )
    `;
  }

  async deleteAccount(userId: string, email?: string | null) {
    await this.ensureDeletionRequestsTable();
    await this.prisma.$executeRaw`
      INSERT INTO account_deletion_requests (user_id, email, requested_at)
      VALUES (${userId}::uuid, ${email ?? null}, now())
      ON CONFLICT (user_id)
      DO UPDATE SET
        email = EXCLUDED.email,
        requested_at = now()
    `;

    // Ban for ~100 years to effectively disable login globally.
    const { error } = await this.supabaseAdmin.db.auth.admin.updateUserById(
      userId,
      { ban_duration: '876000h' },
    );

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return { success: true, disabled: true };
  }
}
