import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { PaygateConfigService } from './paygate.config';
import { PaygateController } from './paygate.controller';
import { PaygateWebhookController } from './paygate.webhook.controller';
import { PaygateService } from './paygate.service';

@Module({
  imports: [HttpModule],
  controllers: [PaygateController, PaygateWebhookController],
  providers: [PaygateConfigService, PaygateService],
  exports: [PaygateConfigService, PaygateService],
})
export class PaygateModule {}
