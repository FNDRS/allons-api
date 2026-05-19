import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { SupabaseAdminService } from '../supabase/supabase-admin.service';

const PAYMENT_INITIATE_LIMIT_KEY = 'THROTTLER:LIMITpayment-initiate';

// Uses authenticated user id when available. Falls back to the client IP
// (trust proxy is enabled in main.ts).
@Injectable()
export class AllonsThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly supabaseAdmin: SupabaseAdminService,
  ) {
    super(options, storageService, reflector);
  }

  protected async getTracker(
    req: Record<string, any>,
    context?: ExecutionContext,
  ): Promise<string> {
    if (context) {
      const paymentLimit = this.reflector.getAllAndOverride(
        PAYMENT_INITIATE_LIMIT_KEY,
        [context.getHandler(), context.getClass()],
      );
      if (
        paymentLimit !== undefined &&
        typeof req.userId !== 'string' &&
        req.headers?.authorization
      ) {
        try {
          const authorization =
            typeof req.headers?.authorization === 'string'
              ? req.headers.authorization
              : undefined;
          const user =
            await this.supabaseAdmin.getAuthenticatedUser(authorization);
          req.userId = user.id;
        } catch {
          // Invalid or missing auth — fall back to IP-based tracking.
        }
      }
    }

    const userId = typeof req.userId === 'string' ? req.userId : null;
    if (userId) return `u:${userId}`;

    const ip =
      (typeof req.ip === 'string' && req.ip) ||
      (typeof req.headers?.['x-forwarded-for'] === 'string'
        ? String(req.headers['x-forwarded-for']).split(',')[0]?.trim()
        : null) ||
      (typeof req.connection?.remoteAddress === 'string'
        ? req.connection.remoteAddress
        : null) ||
      'unknown';

    return `ip:${ip}`;
  }
}
