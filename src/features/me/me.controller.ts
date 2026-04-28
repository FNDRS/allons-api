import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { MeService } from './me.service';
import { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';

interface UpdateProfileBody {
  fullName?: string | null;
  location?: string | null;
  avatarUrl?: string | null;
  avatarColor?: string | null;
}

@Controller('me')
export class MeController {
  constructor(
    private readonly meService: MeService,
    private readonly supabaseAdmin: SupabaseAdminService,
  ) {}

  @Get()
  async getMe(@Req() req: Request) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    return this.meService.getProfile(
      user.id,
      user.email,
      user.user_metadata ?? {},
    );
  }

  @Patch()
  async updateMe(@Req() req: Request, @Body() body: UpdateProfileBody) {
    if (body && typeof body !== 'object') {
      throw new BadRequestException('Cuerpo de solicitud inválido');
    }
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    return this.meService.updateProfile(
      user.id,
      user.email,
      body ?? {},
      user.user_metadata ?? {},
    );
  }

  @Get('tickets')
  async listTickets(
    @Req() req: Request,
    @Query('cities') cities?: string | string[],
    @Query('types') types?: string | string[],
  ) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    return this.meService.listTickets(user.id, {
      cities,
      types,
      email: user.email ?? null,
    });
  }

  @Get('tickets/:ticketId')
  async getTicket(@Req() req: Request, @Param('ticketId') ticketId: string) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    return this.meService.getTicketDetails(
      user.id,
      ticketId,
      user.email ?? null,
    );
  }

  @Post('tickets')
  async createTicket(
    @Req() req: Request,
    @Body()
    body: {
      eventId?: string;
      quantity?: number;
      holders?: Array<{ name?: string; email?: string }>;
    },
  ) {
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
    if (quantity < 1 || quantity > 20) {
      throw new BadRequestException('quantity debe estar entre 1 y 20');
    }
    return this.meService.createTicket(user.id, body.eventId, quantity, {
      name:
        (typeof user.user_metadata?.name === 'string'
          ? user.user_metadata.name
          : undefined) ?? null,
      email: user.email ?? null,
      holders: body.holders ?? [],
    });
  }

  @Delete('tickets/:ticketId')
  async cancelTicket(@Req() req: Request, @Param('ticketId') ticketId: string) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    return this.meService.cancelTicket(user.id, ticketId);
  }

  @Post('tickets/:ticketId/share')
  async shareTicket(
    @Req() req: Request,
    @Param('ticketId') ticketId: string,
    @Body() body: { peerUserId?: string },
  ) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    if (!body?.peerUserId || typeof body.peerUserId !== 'string') {
      throw new BadRequestException('peerUserId es requerido');
    }
    return this.meService.shareTicketWithUser(user.id, {
      ticketId,
      peerUserId: body.peerUserId,
    });
  }

  @Post('tickets/:ticketId/invite')
  async inviteTicketRecipient(
    @Req() req: Request,
    @Param('ticketId') ticketId: string,
    @Body() body: { email?: string; name?: string | null },
  ) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    if (!body?.email || typeof body.email !== 'string') {
      throw new BadRequestException('email es requerido');
    }
    const inviterName =
      (typeof user.user_metadata?.name === 'string'
        ? user.user_metadata.name
        : undefined) ??
      user.email ??
      'Un amigo';
    return this.meService.inviteTicketRecipient(user.id, {
      ticketId,
      email: body.email,
      name: body.name ?? null,
      inviterName,
    });
  }

  @Post('tickets/:ticketId/accept')
  async acceptTicketInvitation(
    @Req() req: Request,
    @Param('ticketId') ticketId: string,
  ) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    return this.meService.acceptTicketInvitation(
      user.id,
      user.email ?? null,
      ticketId,
    );
  }

  @Get('conversations')
  async listConversations(@Req() req: Request) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    return this.meService.listConversations(user.id);
  }

  @Get('notifications')
  async listNotifications(@Req() req: Request) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    return this.meService.listNotifications(user.id);
  }

  @Get('event-history')
  async listEventHistory(@Req() req: Request) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    return this.meService.listEventHistory(user.id);
  }
}
