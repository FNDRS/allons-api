import { createHmac } from 'node:crypto';
import { buildTicketQrPayload, parseTicketQrPayload } from './ticket-qr.utils';

const TICKET = '11111111-2222-4333-8444-555555555555';
const EVENT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SECRET = 'unit-test-secret';

describe('buildTicketQrPayload', () => {
  it('emits a compact JSON without PII fields', () => {
    const raw = buildTicketQrPayload(TICKET, EVENT, SECRET);
    const obj = JSON.parse(raw);
    expect(obj.t).toBe(TICKET);
    expect(obj.e).toBe(EVENT);
    expect(typeof obj.ts).toBe('number');
    expect(typeof obj.s).toBe('string');
    expect(obj.s).toHaveLength(64);
    expect(obj.holderName).toBeUndefined();
    expect(obj.holderEmail).toBeUndefined();
    expect(obj.ticketId).toBeUndefined();
    expect(obj.eventId).toBeUndefined();
  });

  it('omits the signature when no secret is provided', () => {
    const raw = buildTicketQrPayload(TICKET, EVENT, null);
    const obj = JSON.parse(raw);
    expect(obj.s).toBeUndefined();
    expect(obj.t).toBe(TICKET);
  });
});

describe('parseTicketQrPayload', () => {
  it('returns null for empty / unrecognized input', () => {
    expect(parseTicketQrPayload('', SECRET)).toBeNull();
    expect(parseTicketQrPayload('not a uuid or json', SECRET)).toBeNull();
    expect(parseTicketQrPayload('{not json', SECRET)).toBeNull();
  });

  it('accepts a raw UUID as unverified (manual entry path)', () => {
    const result = parseTicketQrPayload(TICKET, SECRET);
    expect(result).toEqual({
      ticketId: TICKET,
      eventId: null,
      verified: false,
    });
  });

  it('verifies a properly signed compact QR', () => {
    const raw = buildTicketQrPayload(TICKET, EVENT, SECRET);
    const result = parseTicketQrPayload(raw, SECRET);
    expect(result).toEqual({
      ticketId: TICKET,
      eventId: EVENT,
      verified: true,
    });
  });

  it('rejects a QR signed with a different secret', () => {
    const raw = buildTicketQrPayload(TICKET, EVENT, 'wrong-secret');
    expect(parseTicketQrPayload(raw, SECRET)).toBeNull();
  });

  it('rejects a QR whose payload was tampered after signing', () => {
    const ts = 1_700_000_000;
    const sig = createHmac('sha256', SECRET)
      .update(JSON.stringify({ t: TICKET, e: EVENT, ts }))
      .digest('hex');
    const tampered = JSON.stringify({
      t: TICKET,
      e: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      ts,
      s: sig,
    });
    expect(parseTicketQrPayload(tampered, SECRET)).toBeNull();
  });

  it('accepts an unsigned compact form as unverified', () => {
    const raw = JSON.stringify({ t: TICKET, e: EVENT, ts: 12345 });
    const result = parseTicketQrPayload(raw, SECRET);
    expect(result).toEqual({
      ticketId: TICKET,
      eventId: EVENT,
      verified: false,
    });
  });

  it('accepts the legacy verbose format with `ticketId` (pre-signing tickets)', () => {
    const raw = JSON.stringify({
      ticketId: TICKET,
      eventId: EVENT,
      holderName: 'Anyone',
      holderEmail: 'someone@example.com',
    });
    const result = parseTicketQrPayload(raw, SECRET);
    expect(result).toEqual({
      ticketId: TICKET,
      eventId: EVENT,
      verified: false,
    });
  });

  it('handles a signed QR even when the server has no secret (logged, unverified)', () => {
    const raw = buildTicketQrPayload(TICKET, EVENT, SECRET);
    const result = parseTicketQrPayload(raw, null);
    expect(result).toEqual({
      ticketId: TICKET,
      eventId: EVENT,
      verified: false,
    });
  });
});
