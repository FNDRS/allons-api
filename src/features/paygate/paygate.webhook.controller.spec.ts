import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import type { Request } from 'express';
import { PaygateConfigService } from './paygate.config';
import { PaygateSignatureVerifier } from './paygate.signature';
import { PaygateWebhookController } from './paygate.webhook.controller';

async function buildController(env: Record<string, string | undefined>) {
  const moduleRef = await Test.createTestingModule({
    controllers: [PaygateWebhookController],
    providers: [
      PaygateConfigService,
      PaygateSignatureVerifier,
      {
        provide: ConfigService,
        useValue: { get: (key: string) => env[key] },
      },
    ],
  }).compile();
  return moduleRef.get(PaygateWebhookController);
}

function fakeReq(
  rawBody: Buffer | undefined,
): Parameters<PaygateWebhookController['handleWebhook']>[0] {
  return { rawBody } as unknown as Parameters<
    PaygateWebhookController['handleWebhook']
  >[0] & { rawBody?: Buffer; body?: unknown; headers: Request['headers'] };
}

const SECRET = 'webhook-secret';
const BODY = '{"_id":"abc","status":"APPROVED"}';
const RAW = Buffer.from(BODY, 'utf8');

describe('PaygateWebhookController', () => {
  it('accepts with a warning when PAYGATE_WEBHOOK_SECRET is unset', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const controller = await buildController({});

    const result = controller.handleWebhook(fakeReq(RAW), {});

    expect(result).toEqual({ ok: true });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('WITHOUT signature verification'),
    );
    warn.mockRestore();
  });

  it('accepts a request with a valid signature', async () => {
    const controller = await buildController({
      PAYGATE_WEBHOOK_SECRET: SECRET,
    });
    const sig = createHmac('sha256', SECRET).update(BODY).digest('hex');

    const result = controller.handleWebhook(fakeReq(RAW), {
      'x-paygate-signature': sig,
    });

    expect(result).toEqual({ ok: true });
  });

  it('rejects with 401 when the secret is set but the signature is wrong', async () => {
    const controller = await buildController({
      PAYGATE_WEBHOOK_SECRET: SECRET,
    });

    expect(() =>
      controller.handleWebhook(fakeReq(RAW), {
        'x-paygate-signature': 'deadbeef'.repeat(8),
      }),
    ).toThrow(UnauthorizedException);
  });

  it('rejects with 401 when the signature header is missing entirely', async () => {
    const controller = await buildController({
      PAYGATE_WEBHOOK_SECRET: SECRET,
    });

    expect(() => controller.handleWebhook(fakeReq(RAW), {})).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects with 401 when rawBody is missing (rawBody flag not enabled)', async () => {
    const controller = await buildController({
      PAYGATE_WEBHOOK_SECRET: SECRET,
    });

    expect(() =>
      controller.handleWebhook(fakeReq(undefined), {
        'x-paygate-signature': createHmac('sha256', SECRET)
          .update(BODY)
          .digest('hex'),
      }),
    ).toThrow(UnauthorizedException);
  });
});
