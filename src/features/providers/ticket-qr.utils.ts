import { createHmac, timingSafeEqual } from 'node:crypto';
import { Logger } from '@nestjs/common';

const ALGO = 'sha256';
const HMAC_LEN_HEX = 64;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const logger = new Logger('TicketQr');

export interface ParsedTicketQr {
  ticketId: string;
  /** Event id encoded in the QR (only present for signed QRs). */
  eventId: string | null;
  /**
   * `true` when the QR carried a valid HMAC the server can verify. Older
   * tickets and plain-UUID inputs (manual entry) come back `false` —
   * still scannable, but the operator can see they weren't cryptographic.
   */
  verified: boolean;
}

/**
 * Builds the JSON payload encoded into the customer-facing QR.
 *
 * Format (signed):
 *   { "t": "<ticketId>", "e": "<eventId>", "ts": <unix_secs>, "s": "<hex>" }
 *
 * Falls back to an unsigned `{t,e,ts}` if `secret` is empty (dev/local
 * environments without `TICKET_QR_SECRET` set). The scanner accepts both;
 * production environments should always provide a secret.
 *
 * Notably absent: holderName / holderEmail. Those used to live in the
 * QR; they leak PII if anyone photographs the ticket. The scanner now
 * looks them up server-side after verifying the signature.
 */
export function buildTicketQrPayload(
  ticketId: string,
  eventId: string,
  secret: string | null,
): string {
  const ts = Math.floor(Date.now() / 1000);
  const base = { t: ticketId, e: eventId, ts };
  if (!secret) {
    return JSON.stringify(base);
  }
  const sig = createHmac(ALGO, secret)
    .update(JSON.stringify(base))
    .digest('hex');
  return JSON.stringify({ ...base, s: sig });
}

/**
 * Parses + verifies an incoming QR payload from the scanner.
 *
 * Accepts three shapes:
 *  - A raw UUID (manual entry by staff, or legacy QRs predating signing).
 *    Returns `verified: false`.
 *  - A signed JSON `{t,e,ts,s}` — HMAC is recomputed and compared in
 *    constant time. Returns `verified: true` only when the signature
 *    matches.
 *  - A legacy JSON `{ticketId, eventId, …}` (the pre-signing format) —
 *    `ticketId` is honored, `verified: false`.
 *
 * Returns `null` when the input is unrecognizable or the signature
 * doesn't match. The caller should treat that as `status: 'invalid'`.
 */
export function parseTicketQrPayload(
  raw: string,
  secret: string | null,
): ParsedTicketQr | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (UUID_REGEX.test(trimmed)) {
    return { ticketId: trimmed, eventId: null, verified: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;

  // Signed compact format.
  const t = typeof obj.t === 'string' ? obj.t : null;
  const e = typeof obj.e === 'string' ? obj.e : null;
  const ts = typeof obj.ts === 'number' ? obj.ts : null;
  const s = typeof obj.s === 'string' ? obj.s : null;
  if (t && UUID_REGEX.test(t) && e && UUID_REGEX.test(e) && ts !== null) {
    if (!s) {
      // Unsigned compact form (dev / pre-secret bootstrap).
      return { ticketId: t, eventId: e, verified: false };
    }
    if (!secret) {
      // We received a signed QR but the server has no secret to verify
      // against. Surface as unverified but valid pointer.
      logger.warn(
        'parseTicketQrPayload: signed QR received but TICKET_QR_SECRET is not set',
      );
      return { ticketId: t, eventId: e, verified: false };
    }
    const expected = createHmac(ALGO, secret)
      .update(JSON.stringify({ t, e, ts }))
      .digest('hex');
    if (safeHexEqual(expected, s)) {
      return { ticketId: t, eventId: e, verified: true };
    }
    logger.warn(`parseTicketQrPayload: signature mismatch for ticketId=${t}`);
    return null;
  }

  // Legacy verbose format with `ticketId` field (pre-signing).
  const legacyTicketId = typeof obj.ticketId === 'string' ? obj.ticketId : null;
  const legacyEventId = typeof obj.eventId === 'string' ? obj.eventId : null;
  if (legacyTicketId && UUID_REGEX.test(legacyTicketId)) {
    return {
      ticketId: legacyTicketId,
      eventId:
        legacyEventId && UUID_REGEX.test(legacyEventId) ? legacyEventId : null,
      verified: false,
    };
  }

  return null;
}

function safeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length || a.length !== HMAC_LEN_HEX) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}
