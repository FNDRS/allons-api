import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import type { SupabaseAdminService } from '../supabase/supabase-admin.service';
import { AllonsThrottlerGuard } from './allons-throttler.guard';

/**
 * `getTracker` is what actually resolves the rate-limit bucket for a
 * request — this is the regression test for the bug Codex flagged on PR #43:
 * a handler authenticating and setting `req.userId` itself is always too
 * late, because guards run before the route handler. Only the guard's own
 * pre-authentication (tested here) can affect that same request's tracker.
 */
function makeHandler(throttleNames: string[] = []) {
  const handler = function fakeHandler() {};
  for (const name of throttleNames) {
    Reflect.defineMetadata(`THROTTLER:LIMIT${name}`, 10, handler);
  }
  return handler;
}

function makeContext(throttleNames: string[] = []): ExecutionContext {
  const handler = makeHandler(throttleNames);
  class FakeController {}
  return {
    getHandler: () => handler,
    getClass: () => FakeController,
  } as unknown as ExecutionContext;
}

function makeGuard(getAuthenticatedUser: jest.Mock) {
  const supabaseAdmin = {
    getAuthenticatedUser,
  } as unknown as SupabaseAdminService;
  return new AllonsThrottlerGuard(
    { throttlers: [] },
    {} as any,
    new Reflector(),
    supabaseAdmin,
  );
}

describe('AllonsThrottlerGuard.getTracker', () => {
  it('tracks by user id for a per-user throttle name with a valid token', async () => {
    const getAuthenticatedUser = jest.fn().mockResolvedValue({ id: 'user-1' });
    const guard = makeGuard(getAuthenticatedUser);
    const req: Record<string, any> = {
      headers: { authorization: 'Bearer good-token' },
    };

    const tracker = await (guard as any).getTracker(
      req,
      makeContext(['class-reservation-cancel']),
    );

    expect(tracker).toBe('u:user-1');
    expect(getAuthenticatedUser).toHaveBeenCalledWith('Bearer good-token');
  });

  it('still tracks by user id for the pre-existing payment-initiate route', async () => {
    const getAuthenticatedUser = jest.fn().mockResolvedValue({ id: 'user-2' });
    const guard = makeGuard(getAuthenticatedUser);
    const req: Record<string, any> = {
      headers: { authorization: 'Bearer good-token' },
    };

    const tracker = await (guard as any).getTracker(
      req,
      makeContext(['payment-initiate']),
    );

    expect(tracker).toBe('u:user-2');
  });

  it('falls back to IP for a route with no per-user throttle name', async () => {
    const getAuthenticatedUser = jest.fn();
    const guard = makeGuard(getAuthenticatedUser);
    const req: Record<string, any> = {
      headers: { authorization: 'Bearer good-token' },
      ip: '203.0.113.5',
    };

    // e.g. paygate-webhook, or any route with no @Throttle() override at all.
    const tracker = await (guard as any).getTracker(
      req,
      makeContext(['paygate-webhook']),
    );

    expect(tracker).toBe('ip:203.0.113.5');
    expect(getAuthenticatedUser).not.toHaveBeenCalled();
  });

  it('falls back to IP when the token is invalid, even on a per-user route', async () => {
    const getAuthenticatedUser = jest
      .fn()
      .mockRejectedValue(new Error('invalid token'));
    const guard = makeGuard(getAuthenticatedUser);
    const req: Record<string, any> = {
      headers: { authorization: 'Bearer bad-token' },
      ip: '203.0.113.5',
    };

    const tracker = await (guard as any).getTracker(
      req,
      makeContext(['class-package-payment']),
    );

    expect(tracker).toBe('ip:203.0.113.5');
  });

  it('does not re-authenticate when req.userId is already set', async () => {
    const getAuthenticatedUser = jest.fn();
    const guard = makeGuard(getAuthenticatedUser);
    const req: Record<string, any> = {
      headers: { authorization: 'Bearer good-token' },
      userId: 'already-set',
    };

    const tracker = await (guard as any).getTracker(
      req,
      makeContext(['class-reservation-create']),
    );

    expect(tracker).toBe('u:already-set');
    expect(getAuthenticatedUser).not.toHaveBeenCalled();
  });
});
