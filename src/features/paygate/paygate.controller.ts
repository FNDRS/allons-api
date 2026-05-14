import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaygateService } from './paygate.service';
import type { PaygateHealthResponse } from './paygate.types';

@ApiTags('paygate')
@Controller('paygate')
export class PaygateController {
  constructor(private readonly paygate: PaygateService) {}

  @Get('health')
  @ApiOperation({
    summary: 'Paygate configuration and connectivity probe',
    description:
      'Diagnostic endpoint: GET /pos?limit=1 against the configured Paygate base URL and returns status. The response is cached in memory (~30s) to avoid fan-out under load; `cached: true` means the payload came from cache.',
  })
  async health(): Promise<PaygateHealthResponse> {
    return this.paygate.health();
  }
}
