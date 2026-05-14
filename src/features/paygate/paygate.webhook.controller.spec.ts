import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import type { Request } from 'express';
import { PaygateConfigService } from './paygate.config';
import { PaygateSignatureVerifier } from './paygate.signature';
import { PaygateWebhookController } from './paygate.webhook.controller';
import { PaymentOrdersRepository } from '../payments/payment-orders.repository';
import { MeService } from '../me/me.service';
import { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';
import { PrismaService } from '../../prisma/prisma.service';

async function buildController(env: Record<string, string | undefined>) {
  const moduleRef = await Test.createTestingModule({
    controllers: [PaygateWebhookController],
    providers: [
      PaygateConfigService,
      PaygateSignatureVerifier,
      {
        provide: PaymentOrdersRepository,
        useValue: {
          findById: jest.fn(),
          findByPaygateLinkId: jest.fn(),
          findByPaygatePaymentId: jest.fn(),
          transitionStatus: jest.fn(),
        },
      },
      {
        provide: MeService,
        useValue: { createTicket: jest.fn() },
      },
      {
        provide: SupabaseAdminService,
        useValue: { db: { auth: { admin: { getUserById: jest.fn() } } } },
      },
      {
        provide: PrismaService,
        useValue: {
          event: { findUnique: jest.fn() },
          ticket: { count: jest.fn() },
        },
      },
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

function signatureHeader(ts: number) {
  const signedPayload = `${ts}.${BODY}`;
  const sig = createHmac('sha256', SECRET).update(signedPayload).digest('hex');
  return `t=${ts},v1=${sig}`;
}

describe('PaygateWebhookController', () => {
  it('rejects when the webhook secret is unset and unsigned mode is off', async () => {
    const controller = await buildController({});

    expect(() => controller.handleWebhook(fakeReq(RAW), {})).toThrow(
      UnauthorizedException,
    );
  });

  it('accepts with a warning when PAYGATE_WEBHOOK_ALLOW_UNSIGNED=true', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const controller = await buildController({
      PAYGATE_WEBHOOK_ALLOW_UNSIGNED: 'true',
    });

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
    const now = 1_700_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now * 1000);

    const result = controller.handleWebhook(fakeReq(RAW), {
      'x-clinpays-webhook-signature': signatureHeader(now),
    });

    expect(result).toEqual({ ok: true });

    jest.restoreAllMocks();
  });

  it('rejects with 401 when the secret is set but the signature is wrong', async () => {
    const controller = await buildController({
      PAYGATE_WEBHOOK_SECRET: SECRET,
    });
    const now = 1_700_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now * 1000);

    expect(() =>
      controller.handleWebhook(fakeReq(RAW), {
        'x-clinpays-webhook-signature': `t=${now},v1=${'deadbeef'.repeat(8)}`,
      }),
    ).toThrow(UnauthorizedException);

    jest.restoreAllMocks();
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
    const now = 1_700_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now * 1000);

    expect(() =>
      controller.handleWebhook(fakeReq(undefined), {
        'x-clinpays-webhook-signature': signatureHeader(now),
      }),
    ).toThrow(UnauthorizedException);

    jest.restoreAllMocks();
  });
});
