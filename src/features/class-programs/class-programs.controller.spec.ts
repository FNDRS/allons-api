import type { Request } from 'express';
import type { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';
import { ClassProgramsController } from './class-programs.controller';
import type { ClassProgramsService } from './class-programs.service';

function makeController(getAuthenticatedUser: jest.Mock) {
  const classPrograms = {
    getAvailability: jest.fn().mockResolvedValue([]),
    getPublicProgram: jest.fn().mockResolvedValue({}),
    listDiscoveryPrograms: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<ClassProgramsService>;
  const supabaseAdmin = {
    getAuthenticatedUser,
  } as unknown as SupabaseAdminService;
  return {
    controller: new ClassProgramsController(classPrograms, supabaseAdmin),
    classPrograms,
  };
}

function makeRequest(authorization?: string): Request {
  return { headers: authorization ? { authorization } : {} } as Request;
}

describe('ClassProgramsController.getAvailability', () => {
  it('passes the resolved userId through for a valid token', async () => {
    const getAuthenticatedUser = jest.fn().mockResolvedValue({ id: 'user-1' });
    const { controller, classPrograms } = makeController(getAuthenticatedUser);

    await controller.getAvailability(
      makeRequest('Bearer good-token'),
      'program-1',
    );

    expect(classPrograms.getAvailability).toHaveBeenCalledWith('program-1', {
      from: undefined,
      days: 7,
      userId: 'user-1',
    });
  });

  it('degrades to guest (userId: null) for a request with no Authorization header', async () => {
    const getAuthenticatedUser = jest.fn();
    const { controller, classPrograms } = makeController(getAuthenticatedUser);

    await controller.getAvailability(makeRequest(), 'program-1');

    expect(getAuthenticatedUser).not.toHaveBeenCalled();
    expect(classPrograms.getAvailability).toHaveBeenCalledWith('program-1', {
      from: undefined,
      days: 7,
      userId: null,
    });
  });

  it('degrades to guest instead of failing when the token is invalid — this is a public route', async () => {
    const getAuthenticatedUser = jest
      .fn()
      .mockRejectedValue(new Error('invalid token'));
    const { controller, classPrograms } = makeController(getAuthenticatedUser);

    await controller.getAvailability(
      makeRequest('Bearer expired-token'),
      'program-1',
    );

    expect(classPrograms.getAvailability).toHaveBeenCalledWith('program-1', {
      from: undefined,
      days: 7,
      userId: null,
    });
  });
});

describe('ClassProgramsController.getPublicProgram', () => {
  // Auth degradation itself (missing/invalid token -> guest) is already
  // covered by the getAvailability tests above via the same tryGetUserId
  // helper; this only checks the resolved id reaches the right call.
  it('passes the resolved userId through to the service', async () => {
    const getAuthenticatedUser = jest.fn().mockResolvedValue({ id: 'user-1' });
    const { controller, classPrograms } = makeController(getAuthenticatedUser);

    await controller.getPublicProgram(
      makeRequest('Bearer good-token'),
      'program-1',
    );

    expect(classPrograms.getPublicProgram).toHaveBeenCalledWith('program-1', {
      userId: 'user-1',
    });
  });
});

describe('ClassProgramsController.listDiscovery', () => {
  function listDiscovery(
    city?: string | string[],
    cities?: string | string[],
    limit?: string,
  ) {
    const { controller, classPrograms } = makeController(jest.fn());
    controller.listDiscovery(city, cities, limit);
    return classPrograms.listDiscoveryPrograms.mock.calls[0][0];
  }

  it('defaults to no city filter and a limit of 20', () => {
    expect(listDiscovery()).toEqual({ cities: [], limit: 20 });
  });

  it('accepts comma-separated cities, the form the mobile client sends', () => {
    expect(listDiscovery(undefined, 'La Ceiba,Tegucigalpa').cities).toEqual([
      'La Ceiba',
      'Tegucigalpa',
    ]);
  });

  it('accepts a repeated city param', () => {
    expect(listDiscovery(['La Ceiba', 'Tegucigalpa']).cities).toEqual([
      'La Ceiba',
      'Tegucigalpa',
    ]);
  });

  it('merges city and cities, dropping duplicates', () => {
    expect(listDiscovery('La Ceiba', 'La Ceiba,Tegucigalpa').cities).toEqual([
      'La Ceiba',
      'Tegucigalpa',
    ]);
  });

  it('trims surrounding whitespace and ignores empty entries', () => {
    expect(
      listDiscovery(undefined, ' La Ceiba , , Tegucigalpa ').cities,
    ).toEqual(['La Ceiba', 'Tegucigalpa']);
  });

  it('caps the limit at 50 so a caller cannot ask for the whole table', () => {
    expect(listDiscovery(undefined, undefined, '500').limit).toBe(50);
  });

  it('floors a fractional limit', () => {
    expect(listDiscovery(undefined, undefined, '7.9').limit).toBe(7);
  });

  it('rejects a limit below 1', () => {
    const { controller } = makeController(jest.fn());
    expect(() => controller.listDiscovery(undefined, undefined, '0')).toThrow(
      'limit debe ser mayor a 0',
    );
  });

  it('rejects a non-numeric limit', () => {
    const { controller } = makeController(jest.fn());
    expect(() => controller.listDiscovery(undefined, undefined, 'abc')).toThrow(
      'limit debe ser mayor a 0',
    );
  });

  it('never authenticates — discovery is guest-accessible', () => {
    const getAuthenticatedUser = jest.fn();
    const { controller } = makeController(getAuthenticatedUser);
    controller.listDiscovery('La Ceiba');
    expect(getAuthenticatedUser).not.toHaveBeenCalled();
  });
});

describe('ClassProgramsController.listDiscovery — search term', () => {
  function call(q?: string) {
    const { controller, classPrograms } = makeController(jest.fn());
    controller.listDiscovery(undefined, undefined, undefined, q);
    return classPrograms.listDiscoveryPrograms.mock.calls[0][0];
  }

  it('forwards the search term to the service', () => {
    expect(call('pilates').q).toBe('pilates');
  });

  it('forwards undefined when no term is given', () => {
    expect(call().q).toBeUndefined();
  });
});
