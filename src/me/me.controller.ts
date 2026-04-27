import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Patch,
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
    return this.meService.getProfile(user.id, user.email);
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
  async listTickets(@Headers('authorization') authorization?: string) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(authorization);
    return this.meService.listTickets(user.id);
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
