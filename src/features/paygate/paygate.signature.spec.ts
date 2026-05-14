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

function hmac(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

const SECRET = 'sandbox-webhook-secret';
const BODY = '{"_id":"abc","status":"APPROVED"}';
const RAW_BODY = Buffer.from(BODY, 'utf8');

describe('PaygateSignatureVerifier', () => {
  it('throws missing_secret when PAYGATE_WEBHOOK_SECRET is not set', () => {
    const verifier = buildVerifier({});

    expect(() =>
      verifier.verify({
        rawBody: RAW_BODY,
        headers: { 'x-paygate-signature': hmac(SECRET, BODY) },
      }),
    ).toThrow(PaygateWebhookSignatureError);

    try {
      verifier.verify({
        rawBody: RAW_BODY,
        headers: { 'x-paygate-signature': hmac(SECRET, BODY) },
      });
    } catch (err) {
      expect((err as PaygateWebhookSignatureError).reason).toBe(
        'missing_secret',
      );
    }
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

  it('accepts a valid HMAC signature', () => {
    const verifier = buildVerifier({ PAYGATE_WEBHOOK_SECRET: SECRET });

    expect(() =>
      verifier.verify({
        rawBody: RAW_BODY,
        headers: { 'x-paygate-signature': hmac(SECRET, BODY) },
      }),
    ).not.toThrow();
  });

  it('accepts when the header carries the "sha256=" prefix convention', () => {
    const verifier = buildVerifier({ PAYGATE_WEBHOOK_SECRET: SECRET });

    expect(() =>
      verifier.verify({
        rawBody: RAW_BODY,
        headers: {
          'x-paygate-signature': `sha256=${hmac(SECRET, BODY)}`,
        },
      }),
    ).not.toThrow();
  });

  it('throws mismatch when the body has been tampered with', () => {
    const verifier = buildVerifier({ PAYGATE_WEBHOOK_SECRET: SECRET });
    const goodSig = hmac(SECRET, BODY);
    const tamperedBody = Buffer.from('{"_id":"abc","status":"DENIED"}', 'utf8');

    try {
      verifier.verify({
        rawBody: tamperedBody,
        headers: { 'x-paygate-signature': goodSig },
      });
      fail('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PaygateWebhookSignatureError);
      expect((err as PaygateWebhookSignatureError).reason).toBe('mismatch');
    }
  });

  it('throws mismatch when the signed payload uses a different secret', () => {
    const verifier = buildVerifier({ PAYGATE_WEBHOOK_SECRET: SECRET });
    const attackerSig = hmac('not-the-real-secret', BODY);

    expect(() =>
      verifier.verify({
        rawBody: RAW_BODY,
        headers: { 'x-paygate-signature': attackerSig },
      }),
    ).toThrow(PaygateWebhookSignatureError);
  });

  it('is case-insensitive on the signature header name', () => {
    const verifier = buildVerifier({ PAYGATE_WEBHOOK_SECRET: SECRET });

    expect(() =>
      verifier.verify({
        rawBody: RAW_BODY,
        headers: { 'X-Paygate-Signature': hmac(SECRET, BODY) },
      }),
    ).not.toThrow();
  });

  it('handles arrays in the header by using the first value', () => {
    const verifier = buildVerifier({ PAYGATE_WEBHOOK_SECRET: SECRET });

    expect(() =>
      verifier.verify({
        rawBody: RAW_BODY,
        headers: { 'x-paygate-signature': [hmac(SECRET, BODY), 'extra'] },
      }),
    ).not.toThrow();
  });

  it('treats malformed hex in the header as a mismatch (not a crash)', () => {
    const verifier = buildVerifier({ PAYGATE_WEBHOOK_SECRET: SECRET });

    expect(() =>
      verifier.verify({
        rawBody: RAW_BODY,
        headers: { 'x-paygate-signature': 'not-hex-at-all' },
      }),
    ).toThrow(PaygateWebhookSignatureError);
  });
});
