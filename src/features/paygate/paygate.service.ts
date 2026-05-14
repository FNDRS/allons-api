import { Injectable, Logger } from '@nestjs/common';
import { PaygateClient } from './paygate.client';
import { PaygateConfigService } from './paygate.config';
import { PaygateApiError, PaygateNetworkError } from './paygate.errors';
import type {
  CreatePaymentLinkInput,
  PaygateConnectivity,
  PaygateHealthResponse,
  PaygatePaymentLink,
  PaygatePaymentLinkRaw,
} from './paygate.types';

const HEALTH_PROBE_TIMEOUT_MS = 5_000;
const HEALTH_CACHE_TTL_MS = 30_000;

interface CachedHealth {
  response: PaygateHealthResponse;
  expiresAt: number;
}

@Injectable()
export class PaygateService {
  private readonly logger = new Logger(PaygateService.name);
  private cachedHealth: CachedHealth | null = null;

  constructor(
    private readonly cfg: PaygateConfigService,
    private readonly client: PaygateClient,
  ) {}

  // ===================================================================
  // Health
  // ===================================================================

  async health(): Promise<PaygateHealthResponse> {
    const now = Date.now();
    if (this.cachedHealth && this.cachedHealth.expiresAt > now) {
      return { ...this.cachedHealth.response, cached: true };
    }

    const snapshot = this.cfg.snapshot();
    const missing = {
      apiBase: !snapshot.apiBase,
      bearerToken: !snapshot.bearerToken,
      webhookSecret: !snapshot.webhookSecret,
    };

    const connectivity = await this.probeConnectivity();

    const response: PaygateHealthResponse = {
      configured: Boolean(snapshot.apiBase && snapshot.bearerToken),
      apiBase: snapshot.apiBase,
      currency: snapshot.currency,
      linkExpirationHours: snapshot.linkExpirationHours,
      missing,
      connectivity,
      checkedAt: new Date(now).toISOString(),
      cached: false,
    };

    this.cachedHealth = {
      response,
      expiresAt: now + HEALTH_CACHE_TTL_MS,
    };

    return response;
  }

  private async probeConnectivity(): Promise<PaygateConnectivity> {
    if (!this.cfg.apiBase) {
      return { status: 'skipped', reason: 'PAYGATE_API_BASE not configured' };
    }
    if (!this.cfg.bearerToken) {
      return {
        status: 'unauthorized',
        httpStatus: 401,
        latencyMs: 0,
        message: 'PAYGATE_BEARER_TOKEN not configured',
      };
    }

    const startedAt = Date.now();
    try {
      await this.client.get('/pos?limit=1', {
        timeoutMs: HEALTH_PROBE_TIMEOUT_MS,
      });
      return {
        status: 'ok',
        httpStatus: 200,
        latencyMs: Date.now() - startedAt,
      };
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      if (err instanceof PaygateApiError) {
        if (err.httpStatus === 401 || err.httpStatus === 403) {
          return {
            status: 'unauthorized',
            httpStatus: err.httpStatus,
            latencyMs,
            message:
              err.message ||
              'Paygate rejected the request; bearer token is invalid or absent',
          };
        }
        return {
          status: 'unexpected_status',
          httpStatus: err.httpStatus,
          latencyMs,
          message: err.message,
        };
      }
      if (err instanceof PaygateNetworkError) {
        this.logger.warn(`Paygate connectivity probe failed: ${err.message}`);
        return { status: 'unreachable', latencyMs, message: err.message };
      }
      this.logger.warn(
        `Paygate connectivity probe failed unexpectedly: ${String(err)}`,
      );
      return {
        status: 'unreachable',
        latencyMs,
        message: 'Unknown error talking to Paygate',
      };
    }
  }

  // ===================================================================
  // Payment links
  // ===================================================================

  /**
   * Creates a single-payment hosted link in Paygate.
   *
   * Falls back to `PAYGATE_CURRENCY` and `PAYGATE_LINK_EXPIRATION_HOURS`
   * from config when the input omits them. Returns a normalized
   * `PaygatePaymentLink` (Paygate's `_id` is exposed as `id`).
   */
  async createPaymentLink(
    input: CreatePaymentLinkInput,
  ): Promise<PaygatePaymentLink> {
    const expirationHours =
      input.expirationHours ?? this.cfg.linkExpirationHours;
    const currency = input.currency ?? (this.cfg.currency as 'HNL' | 'USD');

    const body = {
      description: input.description,
      amount: input.amount,
      currency,
      tax: input.tax ?? 0,
      expires: true,
      expiration: expirationHours,
    };

    const raw = await this.client.post<PaygatePaymentLinkRaw>(
      '/pos/payment',
      body,
    );
    return mapPaymentLink(raw);
  }

  /**
   * Fetches the current state of a payment link by Paygate ID. Useful
   * as a backup path when an expected webhook is delayed or missed.
   */
  async getPaymentLinkDetail(paygateId: string): Promise<PaygatePaymentLink> {
    const raw = await this.client.get<PaygatePaymentLinkRaw>(
      `/pos/${encodeURIComponent(paygateId)}`,
    );
    return mapPaymentLink(raw);
  }

  /**
   * Cancels a payment link in Paygate. Idempotent on our side: Paygate
   * may return 404 if the link is already cancelled — callers should
   * decide whether that's an error in their context.
   */
  async cancelPaymentLink(paygateId: string): Promise<void> {
    await this.client.delete<unknown>(`/pos/${encodeURIComponent(paygateId)}`);
  }
}

function mapPaymentLink(raw: PaygatePaymentLinkRaw): PaygatePaymentLink {
  return {
    id: raw._id,
    link: raw.link ?? '',
    amount: raw.amount,
    subtotal: raw.subtotal,
    tax: raw.tax,
    description: raw.description,
    expires: raw.expires,
    expirationHours: raw.expiration,
    currency: raw.currency,
    numberOfProcesses: raw.numberOfProcesses,
    isOpenAmount: raw.isOpenAmount,
    status: raw.status,
  };
}
