import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { MeService } from './me.service';
import { SupabaseAdminService } from '../supabase-admin.service';

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
  async getMe(@Headers('authorization') authorization?: string) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(authorization);
    return this.meService.getProfile(
      user.id,
      user.email,
      user.user_metadata ?? {},
    );
  }

  @Patch()
  async updateMe(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: UpdateProfileBody,
  ) {
    if (body && typeof body !== 'object') {
      throw new BadRequestException('Invalid body');
    }
    const user = await this.supabaseAdmin.getAuthenticatedUser(authorization);
    return this.meService.updateProfile(
      user.id,
      user.email,
      body ?? {},
      user.user_metadata ?? {},
    );
  }

  @Get('tickets')
  async listTickets(
    @Headers('authorization') authorization?: string,
    @Query('cities') cities?: string | string[],
    @Query('types') types?: string | string[],
  ) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(authorization);
    return this.meService.listTickets(user.id, { cities, types });
  }

  @Get('tickets/:ticketId')
  async getTicket(
    @Headers('authorization') authorization: string | undefined,
    @Param('ticketId') ticketId: string,
  ) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(authorization);
    return this.meService.getTicketDetails(user.id, ticketId);
  }

  @Post('tickets')
  async createTicket(
    @Headers('authorization') authorization: string | undefined,
    @Body()
    body: {
      eventId?: string;
      quantity?: number;
      holders?: Array<{ name?: string; email?: string }>;
    },
  ) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(authorization);
    if (!body?.eventId || typeof body.eventId !== 'string') {
      throw new BadRequestException('eventId is required');
    }
    const quantity =
      typeof body.quantity === 'number' && Number.isFinite(body.quantity)
        ? Math.floor(body.quantity)
        : 1;
    if (quantity < 1 || quantity > 20) {
      throw new BadRequestException('quantity must be between 1 and 20');
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
  async cancelTicket(
    @Headers('authorization') authorization: string | undefined,
    @Param('ticketId') ticketId: string,
  ) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(authorization);
    return this.meService.cancelTicket(user.id, ticketId);
  }

  @Get('conversations')
  async listConversations(@Headers('authorization') authorization?: string) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(authorization);
    return this.meService.listConversations(user.id);
  }

  @Get('notifications')
  async listNotifications(@Headers('authorization') authorization?: string) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(authorization);
    return this.meService.listNotifications(user.id);
  }

  @Get('event-history')
  async listEventHistory(@Headers('authorization') authorization?: string) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(authorization);
    return this.meService.listEventHistory(user.id);
  }
}
