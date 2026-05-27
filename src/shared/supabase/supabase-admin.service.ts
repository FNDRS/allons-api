import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { createClient, User } from '@supabase/supabase-js';

@Injectable()
export class SupabaseAdminService {
  private readonly client: ReturnType<typeof createClient> | null;
  private readonly logger = new Logger(SupabaseAdminService.name);

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL ?? '';
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

    if (!supabaseUrl || !serviceRoleKey) {
      // Allow the API to boot without admin credentials.
      // Endpoints that require admin access will throw a clear error when used.
      this.client = null;
      this.logger.warn(
        'Missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY; admin features disabled',
      );
      return;
    }

    this.client = createClient(supabaseUrl, serviceRoleKey);
  }

  get db() {
    if (!this.client) {
      throw new Error(
        'Supabase admin is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
      );
    }
    return this.client;
  }

  async getAuthenticatedUser(authorizationHeader?: string): Promise<User> {
    if (!this.client) {
      throw new Error(
        'Supabase admin is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
      );
    }
    const token = this.extractBearerToken(authorizationHeader);
    if (!token) throw new UnauthorizedException('Missing Bearer token');

    const { data, error } = await this.client.auth.getUser(token);
    if (error || !data.user) throw new UnauthorizedException('Invalid token');
    const bannedUntil = data.user.banned_until;
    if (isUserCurrentlyBanned(bannedUntil)) {
      throw new ForbiddenException(
        'Cuenta deshabilitada por solicitud de cancelación.',
      );
    }

    return data.user;
  }

  /**
   * Fetches a user by id via the service-role admin API. Returns null when
   * admin isn't configured or the user is missing, so callers can degrade
   * gracefully (e.g. fall back to default fee config).
   */
  async getUserById(userId: string): Promise<User | null> {
    if (!this.client) return null;
    const { data, error } = await this.client.auth.admin.getUserById(userId);
    if (error || !data?.user) return null;
    return data.user;
  }

  private extractBearerToken(header?: string) {
    if (!header) return null;
    const [type, token] = header.split(' ');
    if (!token || type.toLowerCase() !== 'bearer') return null;
    return token;
  }
}

function isUserCurrentlyBanned(bannedUntil?: string | null) {
  if (!bannedUntil) return false;
  const parsed = new Date(bannedUntil);
  if (Number.isNaN(parsed.getTime())) return true;
  return parsed.getTime() > Date.now();
}
