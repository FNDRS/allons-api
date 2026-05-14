import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';
import {
  InitiatePaymentBodyDto,
  InitiatePaymentResponseDto,
  PaymentOrderDetailResponseDto,
  PaymentOrderListResponseDto,
} from './me-payments.dto';
import { MePaymentsService } from './me-payments.service';

@ApiTags('me — payments')
@ApiBearerAuth('bearer')
@Controller('me/payments')
export class MePaymentsController {
  constructor(
    private readonly payments: MePaymentsService,
    private readonly supabaseAdmin: SupabaseAdminService,
  ) {}

  @Post('initiate')
  @ApiOperation({
    summary: 'Iniciar pago (orden + link Paygate)',
    description:
      'Crea una orden `pending_payment`, genera un payment link en Paygate y devuelve la URL de checkout. Requiere sesión Supabase (JWT). Puede aplicar descuento por código de referido.',
  })
  @ApiBody({ type: InitiatePaymentBodyDto })
  @ApiResponse({ status: 201, type: InitiatePaymentResponseDto })
  @ApiResponse({
    status: 400,
    description:
      'Validación de negocio, payload inválido o total 0 tras descuento.',
  })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido.' })
  @ApiResponse({ status: 404, description: 'Evento no encontrado.' })
  @ApiResponse({
    status: 503,
    description: 'Paygate no disponible al crear el link.',
  })
  async initiate(@Req() req: Request, @Body() body: InitiatePaymentBodyDto) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    if (!body?.eventId || typeof body.eventId !== 'string') {
      throw new BadRequestException('eventId es requerido');
    }
    const quantity =
      typeof body.quantity === 'number' && Number.isFinite(body.quantity)
        ? Math.floor(body.quantity)
        : 1;
    return this.payments.initiatePayment(user.id, {
      eventId: body.eventId,
      entryTypeId:
        typeof body.entryTypeId === 'string' ? body.entryTypeId : null,
      quantity,
      referralCode:
        typeof body.referralCode === 'string' ? body.referralCode : null,
    });
  }

  @Get('orders/:orderId')
  @ApiOperation({
    summary: 'Estado de una orden de pago',
    description:
      'Devuelve el estado de la orden y los `ticketIds` cuando está `paid`. Solo el dueño de la orden.',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiResponse({ status: 200, type: PaymentOrderDetailResponseDto })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido.' })
  @ApiResponse({
    status: 403,
    description: 'La orden pertenece a otro usuario.',
  })
  @ApiResponse({ status: 404, description: 'Orden no encontrada.' })
  async getOrder(@Req() req: Request, @Param('orderId') orderId: string) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    return this.payments.getOrder(user.id, orderId);
  }

  @Get('orders')
  @ApiOperation({
    summary: 'Listar mis órdenes de pago',
    description: 'Historial de órdenes del usuario autenticado.',
  })
  @ApiResponse({ status: 200, type: PaymentOrderListResponseDto })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido.' })
  async listOrders(@Req() req: Request) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    return this.payments.listOrders(user.id);
  }
}
