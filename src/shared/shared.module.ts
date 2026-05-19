import { Global, Module } from '@nestjs/common';
import { SupabaseAdminService } from './supabase/supabase-admin.service';
import { MailService } from './mail/mail.service';
import { FeatureFlagsService } from './feature-flags.service';

@Global()
@Module({
  providers: [SupabaseAdminService, MailService, FeatureFlagsService],
  exports: [SupabaseAdminService, MailService, FeatureFlagsService],
})
export class SharedModule {}
