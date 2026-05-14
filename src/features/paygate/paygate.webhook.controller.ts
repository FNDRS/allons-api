import {
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  UnauthorizedException,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PaygateConfigService } from './paygate.config';
import { PaygateWebhookSignatureError } from './paygate.errors';
import { PaygateSignatureVerifier } from './paygate.signature';

@ApiTags('webhooks')
@Controller('webhooks/paygate')
export class PaygateWebhookController {
  private readonly logger = new Logger(PaygateWebhookController.name);

  constructor(
    private readonly cfg: PaygateConfigService,
    private readonly signature: PaygateSignatureVerifier,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Paygate (Clinpays) webhook receiver',
    description:
      'Public endpoint Paygate calls when a payment status changes. If PAYGATE_WEBHOOK_SECRET is configured, the request must carry a valid HMAC signature (default header `x-paygate-signature`); otherwise the request is rejected with 401. When the secret is unset (Phase 0 capture mode) the request is accepted with a warning log so payloads can be inspected before signature validation is enforced. Order-state transitions and ticket creation happen in Phase 3.',
  })
  handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ): { ok: true } {
    const eventHint =
      headers['x-paygate-event'] ??
      headers['x-event'] ??
      headers['x-webhook-event'] ??
      undefined;

    if (this.cfg.webhookSecret) {
      const rawBody = req.rawBody;
      if (!rawBody) {
        // Should never happen with rawBody: true in main.ts, but
        // guard explicitly — without the raw bytes we can't verify.
        this.logger.error(
          'Paygate webhook arrived without rawBody; check main.ts rawBody flag',
        );
        throw new UnauthorizedException('Signature could not be verified');
      }

      try {
        this.signature.verify({ rawBody, headers });
      } catch (err) {
        if (err instanceof PaygateWebhookSignatureError) {
          this.logger.warn(
            `Paygate webhook rejected (${err.reason}): ${err.message}`,
          );
          throw new UnauthorizedException('Invalid Paygate signature');
        }
        throw err;
      }
    } else {
      this.logger.warn(
        'Paygate webhook accepted WITHOUT signature verification (PAYGATE_WEBHOOK_SECRET not set). Set the secret to enable strict validation.',
      );
    }

    this.logger.log(
      `Paygate webhook received${eventHint ? ` (event=${String(eventHint)})` : ''}`,
    );

    // TODO(phase-3): parse `req.body` as PaygateWebhookPayload, look up
    // the matching payment_orders row, transition state, and create
    // tickets. Today we only acknowledge so payloads can be captured.

    return { ok: true };
  }
}
