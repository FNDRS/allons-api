import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InterestsService } from './features/interests/interests.service';

function makeDb() {
  const state: any = {};
  const chain: any = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => Promise.resolve(state.eqResult)),
    in: jest.fn(() => Promise.resolve(state.inResult)),
    delete: jest.fn(() => chain),
    insert: jest.fn(() => Promise.resolve(state.insertResult)),
    upsert: jest.fn(() => Promise.resolve(state.upsertResult)),
  };
  return {
    state,
    from: jest.fn(() => chain),
  };
}

describe('InterestsService', () => {
  it('maps interest names from supabase', async () => {
    const db = makeDb();
    db.state.eqResult = {
      data: [
        { interest: { name: 'a' } },
        { interest: [{ name: 'b' }] },
        { interest: null },
      ],
      error: null,
    };
    const supabaseAdmin: any = { db };
    const service = new InterestsService(supabaseAdmin);

    await expect(service.getUserInterestNames('u1')).resolves.toEqual(['a', 'b']);
  });

  it('throws when supabase errors', async () => {
    const db = makeDb();
    db.state.eqResult = { data: null, error: { message: 'nope' } };
    const service = new InterestsService({ db } as any);
    await expect(service.getUserInterestNames('u1')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it('rejects empty interests', async () => {
    const db = makeDb();
    const service = new InterestsService({ db } as any);
    await expect(
      service.replaceUserInterests('u1', {}, [' ', '']),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('handles username conflict by retrying profile upsert', async () => {
    const db = makeDb();
    const calls: any[] = [];
    const chain = (db.from as any).mock.results[0]?.value;

    db.from.mockImplementation(() => {
      const c: any = {
        upsert: jest.fn(async (...args) => {
          calls.push(args);
          return calls.length === 1
            ? { error: { code: '23505', message: 'profiles_username_key' } }
            : { error: null };
        }),
        delete: jest.fn(() => c),
        eq: jest.fn(async () => ({ error: null })),
        select: jest.fn(() => c),
        in: jest.fn(async () => ({ data: [{ id: 'i1' }], error: null })),
        insert: jest.fn(async () => ({ error: null })),
      };
      return c;
    });

    const service = new InterestsService({ db } as any);
    await expect(
      service.replaceUserInterests(
        'u1',
        { name: 'Ana', username: 'ana' },
        ['music', 'music', ' art '],
      ),
    ).resolves.toEqual(['music', 'art']);

    // Called for profile upsert (conflict + retry) and interests upsert.
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });
});
