import { Controller, Delete, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SupabaseAdminService } from './supabase-admin.service';
import { AccountService } from './account.service';

@Controller('me')
export class AccountController {
  constructor(
    private readonly supabaseAdmin: SupabaseAdminService,
    private readonly accountService: AccountService,
  ) {}

  @Delete('account')
  async deleteAccount(@Req() req: Request) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    await this.accountService.deleteAccount(user.id);
    return { success: true };
  }
}
