import {
  buildClassQrPayload,
  generateClassCode,
  normalizeClassCode,
  parseClassQrPayload,
} from './class-qr.utils';
import {
  buildTicketQrPayload,
  parseTicketQrPayload,
} from '../providers/ticket-qr.utils';

const SECRET = 'test-secret';
const RESERVATION = '11111111-2222-4333-8444-555555555555';
const PROGRAM = '66666666-7777-4888-8999-aaaaaaaaaaaa';

describe('generateClassCode', () => {
  it('produces CLS- plus six characters from the unambiguous alphabet', () => {
    for (let i = 0; i < 50; i += 1) {
      // No 0/O or 1/I: a code gets read aloud and typed by an operator, and
      // those pairs are where that goes wrong.
      expect(generateClassCode()).toMatch(
        /^CLS-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/,
      );
    }
  });
});

describe('normalizeClassCode', () => {
  it('accepts what an operator plausibly types', () => {
    expect(normalizeClassCode('cls-ab23cd')).toBe('CLS-AB23CD');
    expect(normalizeClassCode('  CLSAB23CD ')).toBe('CLS-AB23CD');
    expect(normalizeClassCode('CLS--AB23CD')).toBe('CLS-AB23CD');
  });

  it('rejects a ticket code', () => {
    // The whole point of the distinct prefix: an event ticket code must not
    // resolve to a reservation lookup.
    expect(normalizeClassCode('ALL-AB23CD')).toBeNull();
  });

  it('rejects nonsense', () => {
    expect(normalizeClassCode('')).toBeNull();
    expect(normalizeClassCode('CLS-AB23')).toBeNull();
    expect(normalizeClassCode('CLS-AB23CDE')).toBeNull();
  });
});

describe('parseClassQrPayload', () => {
  it('round-trips a signed payload', () => {
    const raw = buildClassQrPayload(RESERVATION, PROGRAM, SECRET);
    expect(parseClassQrPayload(raw, SECRET)).toEqual({
      reservationId: RESERVATION,
      programId: PROGRAM,
      verified: true,
    });
  });

  it('rejects a payload signed with a different secret', () => {
    const raw = buildClassQrPayload(RESERVATION, PROGRAM, 'other-secret');
    expect(parseClassQrPayload(raw, SECRET)).toBeNull();
  });

  it('rejects a tampered reservation id', () => {
    const raw = buildClassQrPayload(RESERVATION, PROGRAM, SECRET);
    const tampered = raw.replace(
      RESERVATION,
      '99999999-2222-4333-8444-555555555555',
    );
    expect(parseClassQrPayload(tampered, SECRET)).toBeNull();
  });

  it('reads an unsigned payload as unverified', () => {
    const raw = buildClassQrPayload(RESERVATION, PROGRAM, null);
    expect(parseClassQrPayload(raw, SECRET)).toEqual({
      reservationId: RESERVATION,
      programId: PROGRAM,
      verified: false,
    });
  });

  it('reports a signed payload as unverified when the server has no secret', () => {
    const raw = buildClassQrPayload(RESERVATION, PROGRAM, SECRET);
    expect(parseClassQrPayload(raw, null)).toMatchObject({
      reservationId: RESERVATION,
      verified: false,
    });
  });

  it('accepts a bare reservation id from manual entry, unverified', () => {
    expect(parseClassQrPayload(RESERVATION, SECRET)).toEqual({
      reservationId: RESERVATION,
      programId: null,
      verified: false,
    });
  });

  it('rejects malformed input', () => {
    expect(parseClassQrPayload('', SECRET)).toBeNull();
    expect(parseClassQrPayload('not json', SECRET)).toBeNull();
    expect(
      parseClassQrPayload('{"c":"nope","p":"x","ts":1}', SECRET),
    ).toBeNull();
    expect(parseClassQrPayload('[]', SECRET)).toBeNull();
  });
});

// The reason the two payload formats are kept disjoint. A class reservation and
// an event ticket are different rows with different admission rules, so neither
// scanner may accept the other's QR — and this must hold structurally, not
// because a caller remembered to check.
describe('class and ticket QRs are not interchangeable', () => {
  it('a signed class QR does not parse as a ticket', () => {
    const classQr = buildClassQrPayload(RESERVATION, PROGRAM, SECRET);
    expect(parseTicketQrPayload(classQr, SECRET)).toBeNull();
  });

  it('a signed ticket QR does not parse as a class reservation', () => {
    const ticketQr = buildTicketQrPayload(RESERVATION, PROGRAM, SECRET);
    expect(parseClassQrPayload(ticketQr, SECRET)).toBeNull();
  });
});
