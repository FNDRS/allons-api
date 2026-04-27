import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createClient, User } from '@supabase/supabase-js';

@Injectable()
export class SupabaseAdminService {
  private readonly client: ReturnType<typeof createClient>;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL ?? '';
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in allons-api environment',
      );
    }

    this.client = createClient(supabaseUrl, serviceRoleKey);
  }

  get db() {
    return this.client;
  }

  async getAuthenticatedUser(authorizationHeader?: string): Promise<User> {
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
