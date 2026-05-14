import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { PaygateConfigService } from './paygate.config';
import type {
  PaygateConnectivity,
  PaygateHealthResponse,
} from './paygate.types';

@Injectable()
export class PaygateService {
  private readonly logger = new Logger(PaygateService.name);
  private readonly connectivityTimeoutMs = 5_000;

  constructor(
    private readonly cfg: PaygateConfigService,
    private readonly http: HttpService,
  ) {}

  async health(): Promise<PaygateHealthResponse> {
    const snapshot = this.cfg.snapshot();
    const missing = {
      apiBase: !snapshot.apiBase,
      bearerToken: !snapshot.bearerToken,
      webhookSecret: !snapshot.webhookSecret,
    };

    const connectivity = await this.probeConnectivity();

    return {
      configured: this.cfg.isFullyConfigured(),
      apiBase: snapshot.apiBase,
      currency: snapshot.currency,
      linkExpirationHours: snapshot.linkExpirationHours,
      missing,
      connectivity,
      checkedAt: new Date().toISOString(),
    };
  }

  private async probeConnectivity(): Promise<PaygateConnectivity> {
    const apiBase = this.cfg.apiBase;
    if (!apiBase) {
      return { status: 'skipped', reason: 'PAYGATE_API_BASE no configurado' };
    }

    const url = `${apiBase}/pos?limit=1`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    const token = this.cfg.bearerToken;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const startedAt = Date.now();
    try {
      const response = await firstValueFrom(
        this.http.get(url, {
          headers,
          timeout: this.connectivityTimeoutMs,
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
        status: 'unreachable',
        latencyMs,
        message: `Paygate respondió con HTTP ${response.status}`,
      };
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      const message =
        err instanceof AxiosError
          ? err.code === 'ECONNABORTED'
            ? `Timeout (${this.connectivityTimeoutMs}ms)`
            : (err.message ?? 'Error de red')
          : 'Error desconocido al conectar con Paygate';
      this.logger.warn(`Paygate connectivity probe failed: ${message}`);
      return { status: 'unreachable', latencyMs, message };
    }
  }
}
