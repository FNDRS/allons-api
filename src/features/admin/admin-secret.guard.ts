import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

/**
 * Gates every route in the AdminController. Compares the
 * `x-admin-secret` header against the value configured in
 * `ADMIN_API_SECRET`. The secret is shared with `allons-admin` (set
 * server-side only — never in client bundles).
 *
 * Uses constant-time comparison to avoid timing leaks.
 */
@Injectable()
export class AdminSecretGuard implements CanActivate {
  private readonly logger = new Logger(AdminSecretGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = String(request.headers['x-admin-secret'] ?? '');
    const expected = this.config.get<string>('ADMIN_API_SECRET') ?? '';

    if (!expected) {
      this.logger.error('ADMIN_API_SECRET is not set — rejecting all admin requests.');
      throw new UnauthorizedException('Admin access not configured');
    }

    if (!safeEqual(provided, expected)) {
      throw new UnauthorizedException('Invalid admin credentials');
    }

    return true;
  }
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
