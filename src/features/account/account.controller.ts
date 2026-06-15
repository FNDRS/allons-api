import { Controller, Delete, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';
import { AccountService } from './account.service';
import { PostHogService } from '../../shared/posthog/posthog.service';

@Controller('me')
export class AccountController {
  constructor(
    private readonly supabaseAdmin: SupabaseAdminService,
    private readonly accountService: AccountService,
    private readonly posthog: PostHogService,
  ) {}

  @Delete('account')
  async deleteAccount(@Req() req: Request) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    const result = await this.accountService.deleteAccount(
      user.id,
      user.email ?? null,
    );
    this.posthog.capture({
      distinctId: user.id,
      event: 'account deleted',
    });
    return result;
  }
}
