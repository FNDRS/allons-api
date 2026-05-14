import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { PaygateConfigService } from './paygate.config';
import { PaygateWebhookSignatureError } from './paygate.errors';
import { PaygateSignatureVerifier } from './paygate.signature';

function buildVerifier(env: Record<string, string | undefined>) {
  const cfg = new PaygateConfigService({
    get: (key: string) => env[key],
  } as unknown as ConfigService);
  return new PaygateSignatureVerifier(cfg);
}

function clinpaysHeader(secret: string, body: string, ts: number): string {
  const signedPayload = `${ts}.${body}`;
  const sig = createHmac('sha256', secret).update(signedPayload).digest('hex');
  return `t=${ts},v1=${sig}`;
}

const SECRET = 'sandbox-webhook-secret';
const BODY = '{"_id":"abc","status":"APPROVED"}';
const RAW_BODY = Buffer.from(BODY, 'utf8');

describe('PaygateSignatureVerifier', () => {
  it('throws missing_secret when PAYGATE_WEBHOOK_SECRET is not set', () => {
    const verifier = buildVerifier({});
    const now = 1_700_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now * 1000);

    expect(() =>
      verifier.verify({
        rawBody: RAW_BODY,
        headers: {
          'x-clinpays-webhook-signature': clinpaysHeader(SECRET, BODY, now),
        },
      }),
    ).toThrow(PaygateWebhookSignatureError);

    try {
      verifier.verify({
        rawBody: RAW_BODY,
        headers: {
          'x-clinpays-webhook-signature': clinpaysHeader(SECRET, BODY, now),
        },
      });
    } catch (err) {
      expect((err as PaygateWebhookSignatureError).reason).toBe(
        'missing_secret',
      );
    }

    jest.restoreAllMocks();
  });

  it('throws missing_header when the secret is set but the header is absent', () => {
    const verifier = buildVerifier({ PAYGATE_WEBHOOK_SECRET: SECRET });

    try {
      verifier.verify({ rawBody: RAW_BODY, headers: {} });
      fail('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PaygateWebhookSignatureError);
      expect((err as PaygateWebhookSignatureError).reason).toBe(
        'missing_header',
      );
    }
  });

  it('accepts a valid Clinpays signature', () => {
    const verifier = buildVerifier({ PAYGATE_WEBHOOK_SECRET: SECRET });
    const now = 1_700_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now * 1000);

    expect(() =>
      verifier.verify({
        rawBody: RAW_BODY,
        headers: {
          'x-clinpays-webhook-signature': clinpaysHeader(SECRET, BODY, now),
        },
      }),
    ).not.toThrow();

    jest.restoreAllMocks();
  });

  it('accepts when one of multiple v1 signatures matches (rotation window)', () => {
    const verifier = buildVerifier({ PAYGATE_WEBHOOK_SECRET: SECRET });
    const now = 1_700_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now * 1000);

    const good = clinpaysHeader(SECRET, BODY, now);
    const attacker = clinpaysHeader('not-the-real-secret', BODY, now);
    const combined = `t=${now},v1=${attacker.split('v1=')[1]},v1=${good.split('v1=')[1]}`;

    expect(() =>
      verifier.verify({
        rawBody: RAW_BODY,
        headers: { 'x-clinpays-webhook-signature': combined },
      }),
    ).not.toThrow();

    jest.restoreAllMocks();
  });

  it('throws mismatch when the body has been tampered with', () => {
    const verifier = buildVerifier({ PAYGATE_WEBHOOK_SECRET: SECRET });
    const now = 1_700_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now * 1000);
    const goodHeader = clinpaysHeader(SECRET, BODY, now);
    const tamperedBody = Buffer.from('{"_id":"abc","status":"DENIED"}', 'utf8');

    try {
      verifier.verify({
        rawBody: tamperedBody,
        headers: { 'x-clinpays-webhook-signature': goodHeader },
      });
      fail('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PaygateWebhookSignatureError);
      expect((err as PaygateWebhookSignatureError).reason).toBe('mismatch');
    }

    jest.restoreAllMocks();
  });

  it('throws mismatch when the signed payload uses a different secret', () => {
    const verifier = buildVerifier({ PAYGATE_WEBHOOK_SECRET: SECRET });
    const now = 1_700_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now * 1000);
    const attackerHeader = clinpaysHeader('not-the-real-secret', BODY, now);

    expect(() =>
      verifier.verify({
        rawBody: RAW_BODY,
        headers: { 'x-clinpays-webhook-signature': attackerHeader },
      }),
    ).toThrow(PaygateWebhookSignatureError);

    jest.restoreAllMocks();
  });

  it('is case-insensitive on the signature header name', () => {
    const verifier = buildVerifier({ PAYGATE_WEBHOOK_SECRET: SECRET });
    const now = 1_700_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now * 1000);

    expect(() =>
      verifier.verify({
        rawBody: RAW_BODY,
        headers: {
          'X-Clinpays-Webhook-Signature': clinpaysHeader(SECRET, BODY, now),
        },
      }),
    ).not.toThrow();

    jest.restoreAllMocks();
  });

  it('handles arrays in the header by using the first value', () => {
    const verifier = buildVerifier({ PAYGATE_WEBHOOK_SECRET: SECRET });
    const now = 1_700_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now * 1000);

    expect(() =>
      verifier.verify({
        rawBody: RAW_BODY,
        headers: {
          'x-clinpays-webhook-signature': [
            clinpaysHeader(SECRET, BODY, now),
            'extra',
          ],
        },
      }),
    ).not.toThrow();

    jest.restoreAllMocks();
  });

  it('treats malformed hex in the header as a mismatch (not a crash)', () => {
    const verifier = buildVerifier({ PAYGATE_WEBHOOK_SECRET: SECRET });
    const now = 1_700_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now * 1000);

    expect(() =>
      verifier.verify({
        rawBody: RAW_BODY,
        headers: {
          'x-clinpays-webhook-signature': `t=${now},v1=not-hex-at-all`,
        },
      }),
    ).toThrow(PaygateWebhookSignatureError);

    jest.restoreAllMocks();
  });
});
