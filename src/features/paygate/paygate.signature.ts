import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PaygateConfigService } from './paygate.config';
import { PaygateWebhookSignatureError } from './paygate.errors';

// Clinpays/Paygate webhook signing.
// Header format: `t=<unix_ts>,v1=<hexsig>[,v1=<hexsig_old>]`
// Signed payload: `${t}.${rawBody}`
const DEFAULT_SIGNATURE_HEADER = 'x-clinpays-webhook-signature';
const DEFAULT_ALGORITHM = 'sha256';
const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

export interface VerifySignatureInput {
  /**
   * Raw request body as bytes (NOT the parsed JSON object). HMAC must
   * be computed over the exact bytes Paygate signed.
   */
  rawBody: Buffer;
  /** Headers Nest gives us (case-insensitive). */
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Verifies the HMAC signature of an incoming Paygate webhook.
 *
 * Behavior:
 *  - If `PAYGATE_WEBHOOK_SECRET` is unset, `verify()` throws
 *    `PaygateWebhookSignatureError('missing_secret')`. Callers can
 *    catch and decide whether to accept the request anyway (useful
 *    while capturing payloads before the secret has been provisioned).
 *  - If the secret is set but the signature header is missing,
 *    throws `'missing_header'`.
 *  - If the computed HMAC doesn't match the header (constant-time
 *    compare), throws `'mismatch'`.
 *  - Otherwise returns silently.
 */
@Injectable()
export class PaygateSignatureVerifier {
  private readonly logger = new Logger(PaygateSignatureVerifier.name);

  constructor(private readonly cfg: PaygateConfigService) {}

  /** Header name we look up (lowercase). */
  get headerName(): string {
    return DEFAULT_SIGNATURE_HEADER;
  }

  verify(input: VerifySignatureInput): void {
    const secret = this.cfg.webhookSecret;
    if (!secret) {
      throw new PaygateWebhookSignatureError(
        'missing_secret',
        'PAYGATE_WEBHOOK_SECRET is not configured; cannot verify webhook signature',
      );
    }

    const signatureHeader = extractHeader(input.headers, this.headerName);
    if (!signatureHeader) {
      throw new PaygateWebhookSignatureError(
        'missing_header',
        `Missing signature header "${this.headerName}"`,
      );
    }

    const parsed = parseClinpaysSignatureHeader(signatureHeader);
    if (!parsed) {
      throw new PaygateWebhookSignatureError(
        'mismatch',
        'Malformed signature header',
      );
    }

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parsed.timestamp) > DEFAULT_TOLERANCE_SECONDS) {
      throw new PaygateWebhookSignatureError(
        'mismatch',
        'Webhook timestamp outside tolerance window',
      );
    }

    const signedPayload = `${parsed.timestamp}.${input.rawBody.toString('utf8')}`;
    const expected = createHmac(DEFAULT_ALGORITHM, secret)
      .update(signedPayload)
      .digest('hex');

    const ok = parsed.signatures.some((sig) => safeEqualHex(expected, sig));
    if (!ok) {
      this.logger.warn('Clinpays webhook signature mismatch');
      throw new PaygateWebhookSignatureError(
        'mismatch',
        'Computed HMAC does not match any signature in the header',
      );
    }
  }
}

function parseClinpaysSignatureHeader(header: string): {
  timestamp: number;
  signatures: string[];
} | null {
  const parts = header
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const tPart = parts.find((p) => p.startsWith('t='));
  const timestamp = tPart ? Number(tPart.slice(2)) : NaN;
  if (!Number.isFinite(timestamp)) return null;
  const sigs = parts
    .filter((p) => p.startsWith('v1='))
    .map((p) => p.slice(3))
    .filter(Boolean);
  if (sigs.length === 0) return null;
  return { timestamp, signatures: sigs };
}

function extractHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  // Nest lowercases header names but we don't assume.
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) {
      const value = headers[key];
      if (Array.isArray(value)) return value[0] ?? null;
      return value ?? null;
    }
  }
  return null;
}

/**
 * Hex-encoded constant-time equality. We strip a leading "sha256=" if
 * the provider sends one (common convention) before comparing.
 */
function safeEqualHex(expected: string, provided: string): boolean {
  const cleaned = provided.startsWith('sha256=') ? provided.slice(7) : provided;
  if (cleaned.length !== expected.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(cleaned, 'hex'),
      Buffer.from(expected, 'hex'),
    );
  } catch {
    // Bad hex in the header → not equal.
    return false;
  }
}
