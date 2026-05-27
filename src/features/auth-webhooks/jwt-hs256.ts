import { createHmac, timingSafeEqual } from 'crypto';

type JwtHeader = { alg?: string; typ?: string; [k: string]: unknown };
type JwtPayload = { exp?: number; iat?: number; [k: string]: unknown };

function base64UrlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4;
  const padded = pad === 0 ? normalized : normalized + '='.repeat(4 - pad);
  return Buffer.from(padded, 'base64');
}

function safeJsonParse<T>(raw: Buffer): T {
  return JSON.parse(raw.toString('utf8')) as T;
}

/** Minimal HS256 JWT verification (no external deps). */
export function verifyJwtHs256(token: string, secret: string): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('invalid jwt');

  const [h64, p64, s64] = parts;
  const header = safeJsonParse<JwtHeader>(base64UrlDecode(h64));
  if (header.alg !== 'HS256') throw new Error('unsupported alg');

  const signingInput = `${h64}.${p64}`;
  const expected = createHmac('sha256', secret).update(signingInput).digest();
  const actual = base64UrlDecode(s64);
  if (actual.length !== expected.length) throw new Error('bad signature');
  if (!timingSafeEqual(actual, expected)) throw new Error('bad signature');

  const payload = safeJsonParse<JwtPayload>(base64UrlDecode(p64));
  if (typeof payload.exp === 'number') {
    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp < nowSec) throw new Error('expired');
  }
  return payload;
}
