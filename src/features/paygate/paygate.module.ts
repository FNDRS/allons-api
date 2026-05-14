import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { PaygateClient } from './paygate.client';
import { PaygateConfigService } from './paygate.config';
import { PaygateController } from './paygate.controller';
import { PaygateService } from './paygate.service';
import { PaygateSignatureVerifier } from './paygate.signature';

@Module({
  imports: [HttpModule],
  controllers: [PaygateController],
  providers: [
    PaygateConfigService,
    PaygateClient,
    PaygateService,
    PaygateSignatureVerifier,
  ],
  exports: [PaygateConfigService, PaygateService, PaygateSignatureVerifier],
})
export class PaygateModule {}
