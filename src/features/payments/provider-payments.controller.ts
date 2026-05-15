import { Controller, Get, Param, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';
import { ProviderPaymentsService } from './provider-payments.service';

@ApiTags('provider — payments')
@ApiBearerAuth('bearer')
@Controller('provider')
export class ProviderPaymentsController {
  constructor(
    private readonly payments: ProviderPaymentsService,
    private readonly supabaseAdmin: SupabaseAdminService,
  ) {}

  @Get('events/:eventId/payments')
  @ApiOperation({
    summary: 'Event payments (provider view)',
    description:
      'Lists an event\'s payment orders plus an aggregated summary (paid GMV, pending, failed). Only the event owner provider.',
  })
  @ApiParam({ name: 'eventId', format: 'uuid' })
  async listForEvent(@Req() req: Request, @Param('eventId') eventId: string) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    return this.payments.listForEvent(user.id, eventId);
  }
}
