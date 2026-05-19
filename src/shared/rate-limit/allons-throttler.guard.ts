import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// Uses authenticated user id when controllers attach it to the request.
// Falls back to the client IP (trust proxy is enabled in main.ts).
@Injectable()
export class AllonsThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
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
