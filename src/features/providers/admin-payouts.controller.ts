import { Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { AdminSecretGuard } from '../admin/admin-secret.guard';
import { ProvidersService } from './providers.service';

/**
 * Operator endpoint to close out a provider payout after the bank transfer is
 * done (settlement stays manual/out-of-band). Guarded by the shared admin
 * secret header (`x-admin-secret`), same access pattern as other `/admin/*`
 * routes — no user token.
 */
@UseGuards(AdminSecretGuard)
@Controller('admin/payouts')
export class AdminPayoutsController {
  constructor(private readonly providersService: ProvidersService) {}

  @Post(':id/complete')
  @HttpCode(200)
  async complete(@Param('id') id: string) {
    return this.providersService.completePayout(id);
  }
}
