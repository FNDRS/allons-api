import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { verifyJwtHs256 } from './jwt-hs256';

@Injectable()
export class AuthWebhookJwtGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = String(request.headers.authorization ?? '');
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length).trim()
      : '';

    const secret = this.config.get<string>('SUPABASE_AUTH_HOOK_SECRET') ?? '';
    if (!secret) {
      throw new UnauthorizedException('Auth webhook secret not configured');
    }
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    try {
      verifyJwtHs256(token, secret);
    } catch {
      throw new UnauthorizedException('Invalid bearer token');
    }
    return true;
  }
}
