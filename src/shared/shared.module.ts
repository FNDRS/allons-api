import { Global, Module } from '@nestjs/common';
import { SupabaseAdminService } from './supabase/supabase-admin.service';
import { MailService } from './mail/mail.service';
import { FeatureFlagsService } from './feature-flags.service';
import { ObservabilityService } from './observability/observability.service';
import { PostHogService } from './posthog/posthog.service';

@Global()
@Module({
  providers: [
    SupabaseAdminService,
    MailService,
    FeatureFlagsService,
    ObservabilityService,
    PostHogService,
  ],
  exports: [
    SupabaseAdminService,
    MailService,
    FeatureFlagsService,
    ObservabilityService,
    PostHogService,
  ],
})
export class SharedModule {}
