import { Controller, Delete, Headers } from '@nestjs/common';
import { SupabaseAdminService } from './supabase-admin.service';
import { AccountService } from './account.service';

@Controller('me')
export class AccountController {
  constructor(
    private readonly supabaseAdmin: SupabaseAdminService,
    private readonly accountService: AccountService,
  ) {}

  @Delete('account')
  async deleteAccount(@Headers('authorization') authorization?: string) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(authorization);
    await this.accountService.deleteAccount(user.id);
    return { success: true };
  }
}
