import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface PaygateConfig {
  apiBase: string | null;
  bearerToken: string | null;
  webhookSecret: string | null;
  linkExpirationHours: number;
  currency: string;
}

const DEFAULT_LINK_EXPIRATION_HOURS = 2;
const DEFAULT_CURRENCY = 'HNL';

@Injectable()
export class PaygateConfigService {
  private readonly logger = new Logger(PaygateConfigService.name);
  private readonly cached: PaygateConfig;

  constructor(config: ConfigService) {
    this.cached = this.load(config);
  }

  get apiBase(): string | null {
    return this.cached.apiBase;
  }

  get bearerToken(): string | null {
    return this.cached.bearerToken;
  }

  get webhookSecret(): string | null {
    return this.cached.webhookSecret;
  }

  get linkExpirationHours(): number {
    return this.cached.linkExpirationHours;
  }

  get currency(): string {
    return this.cached.currency;
  }

  snapshot(): PaygateConfig {
    return { ...this.cached };
  }

  isFullyConfigured(): boolean {
    return Boolean(this.cached.apiBase && this.cached.bearerToken);
  }

  private load(config: ConfigService): PaygateConfig {
    const rawApiBase = config.get<string>('PAYGATE_API_BASE');
    const apiBase = rawApiBase?.trim()
      ? rawApiBase.trim().replace(/\/+$/, '')
      : null;

    const rawToken = config.get<string>('PAYGATE_BEARER_TOKEN');
    const bearerToken = rawToken?.trim() ? rawToken.trim() : null;

    const rawSecret = config.get<string>('PAYGATE_WEBHOOK_SECRET');
    const webhookSecret = rawSecret?.trim() ? rawSecret.trim() : null;

    const rawCurrency = config.get<string>('PAYGATE_CURRENCY');
    const currency = (rawCurrency ?? DEFAULT_CURRENCY).toUpperCase();

    const rawExpiration = config.get<string>('PAYGATE_LINK_EXPIRATION_HOURS');
    const linkExpirationHours = this.parseExpirationHours(rawExpiration);

    return {
      apiBase,
      bearerToken,
      webhookSecret,
      linkExpirationHours,
      currency,
    };
  }

  private parseExpirationHours(raw: string | undefined): number {
    if (raw === undefined || raw === null || raw.trim() === '') {
      return DEFAULT_LINK_EXPIRATION_HOURS;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      this.logger.warn(
        `PAYGATE_LINK_EXPIRATION_HOURS="${raw}" is not a positive integer; falling back to default ${DEFAULT_LINK_EXPIRATION_HOURS}h. Set a valid value to avoid unexpected payment-link expirations.`,
      );
      return DEFAULT_LINK_EXPIRATION_HOURS;
    }
    return parsed;
  }
}
