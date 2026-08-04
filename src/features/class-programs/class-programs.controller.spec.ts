import type { Request } from 'express';
import type { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';
import { ClassProgramsController } from './class-programs.controller';
import type { ClassProgramsService } from './class-programs.service';

function makeController(getAuthenticatedUser: jest.Mock) {
  const classPrograms = {
    getAvailability: jest.fn().mockResolvedValue([]),
    getPublicProgram: jest.fn().mockResolvedValue({}),
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
