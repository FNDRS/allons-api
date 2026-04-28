import { Global, Module } from '@nestjs/common';
import { SupabaseAdminService } from './supabase/supabase-admin.service';
import { MailService } from './mail/mail.service';

@Global()
@Module({
  providers: [SupabaseAdminService, MailService],
  exports: [SupabaseAdminService, MailService],
})
export class SharedModule {}
