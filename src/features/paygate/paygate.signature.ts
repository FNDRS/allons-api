import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PaygateConfigService } from './paygate.config';
import { PaygateWebhookSignatureError } from './paygate.errors';

/**
 * Default header Paygate is expected to send the HMAC in. We don't have
 * confirmation from the sandbox portal yet — see
 * docs/paygate-webhook-contract.md. Phase 3 will pin this down with a
 * real captured webhook; until then this is the working assumption.
 */
const DEFAULT_SIGNATURE_HEADER = 'x-paygate-signature';

/**
 * Algorithm used to compute the HMAC. Same caveat as the header name —
 * adjust here when Paygate confirms.
 */
const DEFAULT_ALGORITHM = 'sha256';

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
 *    catch and decide whether to accept the request anyway (useful for
 *    Phase 0 payload capture).
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

    const provided = extractHeader(input.headers, this.headerName);
    if (!provided) {
      throw new PaygateWebhookSignatureError(
        'missing_header',
        `Missing signature header "${this.headerName}"`,
      );
    }

    const expected = createHmac(DEFAULT_ALGORITHM, secret)
      .update(input.rawBody)
      .digest('hex');

    if (!safeEqualHex(expected, provided)) {
      this.logger.warn('Paygate webhook signature mismatch');
      throw new PaygateWebhookSignatureError(
        'mismatch',
        'Computed HMAC does not match the signature header',
      );
    }
  }
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
