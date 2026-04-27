import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createClient, User } from '@supabase/supabase-js';

@Injectable()
export class SupabaseAdminService {
  private readonly client: ReturnType<typeof createClient> | null;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL ?? '';
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

    if (!supabaseUrl || !serviceRoleKey) {
      // Allow the API to boot without admin credentials.
      // Endpoints that require admin access will throw a clear error when used.
      this.client = null;
      console.log(
        '[supabase-admin] Missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY; admin features disabled',
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

    return data.user;
  }

  private extractBearerToken(header?: string) {
    if (!header) return null;
    const [type, token] = header.split(' ');
    if (!token || type.toLowerCase() !== 'bearer') return null;
    return token;
  }
}
