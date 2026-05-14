import { Body, Controller, Headers, Logger, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('webhooks')
@Controller('webhooks/paygate')
export class PaygateWebhookController {
  private readonly logger = new Logger(PaygateWebhookController.name);

  @Post()
  @ApiOperation({
    summary: 'Webhook Paygate (Clinpays)',
    description:
      'Endpoint público para recibir notificaciones de Paygate. En Fase 0 lo usamos para capturar payloads reales desde sandbox. La validación de firma debe implementarse cuando confirmemos el header/algoritmo exacto desde el portal de Paygate.',
  })
  async handleWebhook(
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ): Promise<{ ok: true }> {
    // NOTE: mantenemos logging mínimo para no filtrar PII accidentalmente.
    // Para debugging puntual en sandbox, subir temporalmente el nivel y loguear el body.
    const eventHint =
      headers['x-paygate-event'] ??
      headers['x-event'] ??
      headers['x-webhook-event'] ??
      undefined;

    this.logger.log(
      `Paygate webhook received${eventHint ? ` (event=${String(eventHint)})` : ''}`,
    );

    // TODO(fase-0): implementar validación de firma con PAYGATE_WEBHOOK_SECRET
    // cuando Paygate confirme el header (ej: X-Paygate-Signature) y el algoritmo.
    void body;

    return { ok: true };
  }
}
