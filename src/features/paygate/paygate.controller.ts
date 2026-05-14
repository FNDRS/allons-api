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
      'No requiere autenticación de usuario. Útil para diagnosticar si las credenciales sandbox de Paygate están bien configuradas. Hace un GET a /pos?limit=1 contra el API base configurado.',
  })
  async health(): Promise<PaygateHealthResponse> {
    return this.paygate.health();
  }
}
