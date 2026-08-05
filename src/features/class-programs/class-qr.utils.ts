import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Logger } from '@nestjs/common';

/**
 * Codes and signed QR payloads for class-session reservations.
 *
 * Deliberately separate from `ticket-qr.utils.ts` rather than an extra field on
 * that payload. A class reservation and an event ticket are different rows in
 * different tables with different admission rules, and the two must never be
 * interchangeable: a signed class QR presented at an event door has to fail to
 * parse, not resolve to some ticket id. Keeping the payload shapes disjoint —
 * `{c,p,ts,s}` here against `{t,e,ts,s}` there — makes that structural instead
 * of a check someone can forget. `class-qr.utils.spec.ts` asserts both
 * directions.
 */

const ALGO = 'sha256';
const HMAC_LEN_HEX = 64;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// `CLS-XXXXXX`, from an alphabet with no 0/O or 1/I so a code read aloud or
// typed by an operator does not turn into a different one. The prefix differs
// from the ticket `ALL-` on purpose: manual entry resolves a typed code to a
// row, and a shared prefix would leave "which table?" ambiguous.
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_BODY_LEN = 6;
// `I` and `O` are excluded: neither generated codes nor the migration's hex
// backfill can produce them, so a code containing one is a mistyped `1` or `0`
// and worth rejecting before it costs a database lookup.
//
// `0` and `1` themselves stay accepted even though the generator omits them —
// the backfill is hex, so an existing code legitimately can contain either.
const CLASS_CODE_BODY_REGEX = /^CLS([0-9A-HJ-NP-Z]{6})$/;

const logger = new Logger('ClassQr');

/** Builds a fresh `CLS-XXXXXX` reservation code. */
export function generateClassCode(): string {
  let body = '';
  for (let i = 0; i < CODE_BODY_LEN; i += 1) {
    body += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return `CLS-${body}`;
}

/**
 * Normalizes an operator-typed reservation code to canonical `CLS-XXXXXX`, so
 * manual entry tolerates lowercase, stray spaces and a missing or extra dash.
 * Returns null when the input is not a class code — including when it is a
 * ticket `ALL-` code.
 */
export function normalizeClassCode(raw: string): string | null {
  const compact = raw.trim().toUpperCase().replace(/[\s-]/g, '');
  const match = CLASS_CODE_BODY_REGEX.exec(compact);
  return match ? `CLS-${match[1]}` : null;
}

export interface ParsedClassQr {
  reservationId: string;
  /** Program id encoded in the QR, when the payload carried one. */
  programId: string | null;
  /**
   * `true` only when the payload carried an HMAC this server could verify.
   * A manually typed reservation id comes back `false` — still scannable, but
   * the operator can see it was not cryptographic.
   */
  verified: boolean;
}

/**
 * Builds the payload encoded into the client-facing QR.
 *
 * Format (signed):
 *   { "c": "<reservationId>", "p": "<programId>", "ts": <unix_secs>, "s": "<hex>" }
 *
 * Falls back to an unsigned `{c,p,ts}` when `secret` is empty, which is what
 * local development without `TICKET_QR_SECRET` gets. The scanner accepts both
 * and reports which it saw; production should always have the secret set.
 *
 * Carries no name, email or anything else about the holder: a QR gets
 * photographed, and the scanner can look the person up server-side once the
 * signature checks out.
 */
export function buildClassQrPayload(
  reservationId: string,
  programId: string,
  secret: string | null,
): string {
  const ts = Math.floor(Date.now() / 1000);
  const base = { c: reservationId, p: programId, ts };
  if (!secret) {
    return JSON.stringify(base);
  }
  const sig = createHmac(ALGO, secret)
    .update(JSON.stringify(base))
    .digest('hex');
  return JSON.stringify({ ...base, s: sig });
}

/**
 * Parses and verifies a scanned payload.
 *
 * Accepts:
 *  - a raw UUID (staff manual entry of a reservation id) — `verified: false`;
 *  - a signed `{c,p,ts,s}` — the HMAC is recomputed and compared in constant
 *    time, and only a match returns `verified: true`;
 *  - an unsigned `{c,p,ts}` — `verified: false`.
 *
 * Returns null when the input is unrecognizable or the signature does not
 * match, which the caller should treat as an invalid scan. An event-ticket
 * payload returns null here: it has no `c`.
 */
export function parseClassQrPayload(
  raw: string,
  secret: string | null,
): ParsedClassQr | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (UUID_REGEX.test(trimmed)) {
    return { reservationId: trimmed, programId: null, verified: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;

  const c = typeof obj.c === 'string' ? obj.c : null;
  const p = typeof obj.p === 'string' ? obj.p : null;
  const ts = typeof obj.ts === 'number' ? obj.ts : null;
  const s = typeof obj.s === 'string' ? obj.s : null;
  if (!c || !UUID_REGEX.test(c) || p === null || ts === null) return null;

  const encodedProgramId = UUID_REGEX.test(p) ? p : null;
  if (!s) {
    return { reservationId: c, programId: encodedProgramId, verified: false };
  }
  if (!secret) {
    logger.warn(
      'parseClassQrPayload: signed QR received but TICKET_QR_SECRET is not set',
    );
    return { reservationId: c, programId: encodedProgramId, verified: false };
  }
  const expected = createHmac(ALGO, secret)
    .update(JSON.stringify({ c, p, ts }))
    .digest('hex');
  if (safeHexEqual(expected, s)) {
    return { reservationId: c, programId: encodedProgramId, verified: true };
  }
  logger.warn(`parseClassQrPayload: signature mismatch for reservation=${c}`);
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
