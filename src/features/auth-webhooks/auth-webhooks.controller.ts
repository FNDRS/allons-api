import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AuthWebhookJwtGuard } from './auth-webhooks.guard';
import { AuthWebhooksService } from './auth-webhooks.service';

// Supabase Auth Hook receiver.
//
// Configure Supabase Auth hooks to call:
//   POST https://<api>/webhooks/auth/signup
// with Authorization: Bearer <JWT signed with SUPABASE_AUTH_HOOK_SECRET>.
@Controller('webhooks/auth')
@SkipThrottle({
  default: true,
  'payment-initiate': true,
  'paygate-webhook': true,
})
export class AuthWebhooksController {
  constructor(private readonly service: AuthWebhooksService) {}

  @Post('signup')
  @UseGuards(AuthWebhookJwtGuard)
  async onSignup(@Body() body: Record<string, unknown>) {
    void body;
    await this.service.handleSignupHook();
    return { ok: true };
  }
}
