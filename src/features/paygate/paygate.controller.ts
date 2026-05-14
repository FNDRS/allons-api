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
    summary: 'Verifica configuración de Paygate y conectividad sandbox/prod',
    description:
      'Endpoint de diagnóstico. Hace un GET a /pos?limit=1 contra el API base configurado y reporta el estado. El resultado se cachea 30s en memoria para evitar fan-out hacia Paygate ante requests masivos; `cached: true` indica que el cuerpo viene del cache.',
  })
  async health(): Promise<PaygateHealthResponse> {
    return this.paygate.health();
  }
}
