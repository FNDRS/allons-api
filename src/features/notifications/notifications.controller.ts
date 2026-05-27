import { Body, Controller, Post, Req } from '@nestjs/common';
import { seconds, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';
import { NotificationsService } from './notifications.service';

@Controller('me')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly supabaseAdmin: SupabaseAdminService,
  ) {}

  /** Device registers its Expo push token after login. */
  @Post('push-token')
  @Throttle({ default: { ttl: seconds(60), limit: 10 } })
  async registerPushToken(
    @Req() req: Request,
    @Body() body: { token?: string; platform?: string },
  ) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    await this.notifications.registerPushToken(
      user.id,
      body?.token ?? '',
      body?.platform,
    );
    return { ok: true };
  }
}
