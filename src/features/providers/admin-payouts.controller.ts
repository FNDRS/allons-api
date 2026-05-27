import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminSecretGuard } from '../admin/admin-secret.guard';
import { ProvidersService } from './providers.service';

/**
 * Operator endpoints for provider payouts. Guarded by the shared admin secret
 * header (`x-admin-secret`), same access pattern as other `/admin/*` routes —
 * no user token. Settlement (the bank transfer) stays manual/out-of-band; this
 * only lists requests and records that one was paid.
 */
@UseGuards(AdminSecretGuard)
@Controller('admin/payouts')
export class AdminPayoutsController {
  constructor(private readonly providersService: ProvidersService) {}

  @Get('recent')
  async recent(@Query('limit') limit?: string) {
    return this.providersService.listAllPayouts(
      Number.parseInt(limit ?? '20', 10) || 20,
    );
  }

  @Post(':id/complete')
  @HttpCode(200)
  async complete(@Param('id') id: string) {
    return this.providersService.completePayout(id);
  }
}
