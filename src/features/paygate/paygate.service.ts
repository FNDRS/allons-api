import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import axios from 'axios';
import { PaygateConfigService } from './paygate.config';
import type {
  PaygateConnectivity,
  PaygateHealthResponse,
} from './paygate.types';

const CONNECTIVITY_TIMEOUT_MS = 5_000;
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
    private readonly http: HttpService,
  ) {}

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

    const connectivity = await this.probeConnectivity(snapshot);

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

  private async probeConnectivity(
    snapshot: ReturnType<PaygateConfigService['snapshot']>,
  ): Promise<PaygateConnectivity> {
    const { apiBase, bearerToken } = snapshot;
    if (!apiBase) {
      return { status: 'skipped', reason: 'PAYGATE_API_BASE no configurado' };
    }

    const url = `${apiBase}/pos?limit=1`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (bearerToken) {
      headers.Authorization = `Bearer ${bearerToken}`;
    }

    const startedAt = Date.now();
    try {
      const response = await firstValueFrom(
        this.http.get(url, {
          headers,
          timeout: CONNECTIVITY_TIMEOUT_MS,
          validateStatus: () => true,
        }),
      );
      const latencyMs = Date.now() - startedAt;

      if (response.status === 200) {
        return { status: 'ok', httpStatus: 200, latencyMs };
      }
      if (response.status === 401 || response.status === 403) {
        return {
          status: 'unauthorized',
          httpStatus: response.status,
          latencyMs,
          message:
            'Paygate respondió pero el bearer token es inválido o no fue enviado',
        };
      }
      return {
        status: 'unexpected_status',
        httpStatus: response.status,
        latencyMs,
        message: `Paygate respondió con HTTP ${response.status} (no clasificado)`,
      };
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      const message = this.describeNetworkError(err);
      this.logger.warn(`Paygate connectivity probe failed: ${message}`);
      return { status: 'unreachable', latencyMs, message };
    }
  }

  private describeNetworkError(err: unknown): string {
    if (axios.isAxiosError(err)) {
      if (err.code === 'ECONNABORTED') {
        return `Timeout (${CONNECTIVITY_TIMEOUT_MS}ms)`;
      }
      return err.message || err.code || 'Error de red';
    }
    if (err instanceof Error) {
      return err.message;
    }
    return 'Error desconocido al conectar con Paygate';
  }
}
