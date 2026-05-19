import { Global, Module } from '@nestjs/common';
import { SupabaseAdminService } from './supabase/supabase-admin.service';
import { MailService } from './mail/mail.service';
import { FeatureFlagsService } from './feature-flags.service';
import { ObservabilityService } from './observability/observability.service';

@Global()
@Module({
  providers: [SupabaseAdminService, MailService, FeatureFlagsService, ObservabilityService],
  exports: [SupabaseAdminService, MailService, FeatureFlagsService, ObservabilityService],
})
export class SharedModule {}
