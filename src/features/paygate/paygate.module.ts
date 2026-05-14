import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { PaygateConfigService } from './paygate.config';
import { PaygateController } from './paygate.controller';
import { PaygateService } from './paygate.service';

@Module({
  imports: [HttpModule],
  controllers: [PaygateController],
  providers: [PaygateConfigService, PaygateService],
  exports: [PaygateConfigService, PaygateService],
})
export class PaygateModule {}
