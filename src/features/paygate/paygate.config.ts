import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface PaygateConfig {
  apiBase: string | null;
  bearerToken: string | null;
  webhookSecret: string | null;
  linkExpirationHours: number;
  currency: string;
}

@Injectable()
export class PaygateConfigService {
  constructor(private readonly config: ConfigService) {}

  get apiBase(): string | null {
    const raw = this.config.get<string>('PAYGATE_API_BASE');
    if (!raw) return null;
    return raw.trim().replace(/\/+$/, '');
  }

  get bearerToken(): string | null {
    const raw = this.config.get<string>('PAYGATE_BEARER_TOKEN');
    return raw && raw.trim().length > 0 ? raw.trim() : null;
  }

  get webhookSecret(): string | null {
    const raw = this.config.get<string>('PAYGATE_WEBHOOK_SECRET');
    return raw && raw.trim().length > 0 ? raw.trim() : null;
  }

  get linkExpirationHours(): number {
    const raw = this.config.get<string>('PAYGATE_LINK_EXPIRATION_HOURS');
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
  }

  get currency(): string {
    return (this.config.get<string>('PAYGATE_CURRENCY') ?? 'HNL').toUpperCase();
  }

  snapshot(): PaygateConfig {
    return {
      apiBase: this.apiBase,
      bearerToken: this.bearerToken,
      webhookSecret: this.webhookSecret,
      linkExpirationHours: this.linkExpirationHours,
      currency: this.currency,
    };
  }

  isFullyConfigured(): boolean {
    return Boolean(this.apiBase && this.bearerToken);
  }
}
