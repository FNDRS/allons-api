import { verifyJwtHs256 } from './jwt-hs256';
import { createHmac } from 'crypto';

function base64Url(input: Buffer | string) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signHs256(payload: Record<string, unknown>, secret: string) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const h = base64Url(JSON.stringify(header));
  const p = base64Url(JSON.stringify(payload));
  const signingInput = `${h}.${p}`;
  const sig = createHmac('sha256', secret).update(signingInput).digest();
  return `${signingInput}.${base64Url(sig)}`;
}

describe('verifyJwtHs256', () => {
  it('accepts a valid token', () => {
    const secret = 'test-secret';
    const token = signHs256(
      { sub: 'abc', exp: Math.floor(Date.now() / 1000) + 60 },
      secret,
    );
    const payload = verifyJwtHs256(token, secret);
    expect(payload.sub).toBe('abc');
  });

  it('rejects invalid signature', () => {
    const secret = 'test-secret';
    const token = signHs256({ sub: 'abc' }, secret) + 'x';
    expect(() => verifyJwtHs256(token, secret)).toThrow();
  });

  it('rejects expired token', () => {
    const secret = 'test-secret';
    const token = signHs256({ sub: 'abc', exp: 1 }, secret);
    expect(() => verifyJwtHs256(token, secret)).toThrow('expired');
  });
});
