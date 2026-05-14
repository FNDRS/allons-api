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
    summary: 'Pagos de un evento (vista del proveedor)',
    description:
      'Lista las órdenes de pago de un evento y un resumen agregado (GMV pagado, pendientes, fallidas). Solo el proveedor dueño del evento.',
  })
  @ApiParam({ name: 'eventId', format: 'uuid' })
  async listForEvent(@Req() req: Request, @Param('eventId') eventId: string) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    return this.payments.listForEvent(user.id, eventId);
  }
}
