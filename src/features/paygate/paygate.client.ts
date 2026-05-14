import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosResponse } from 'axios';
import { firstValueFrom } from 'rxjs';
import { PaygateConfigService } from './paygate.config';
import { PaygateApiError, PaygateNetworkError } from './paygate.errors';

const DEFAULT_TIMEOUT_MS = 10_000;

interface RequestOptions {
  /** Per-request timeout override. */
  timeoutMs?: number;
  /** Override the bearer token (rarely needed; used for tests). */
  bearerToken?: string | null;
  /** Extra headers to merge in. */
  headers?: Record<string, string>;
}

/**
 * Low-level HTTP client for the Paygate REST API.
 *
 * Responsibilities:
 *  - inject Bearer token from config
 *  - apply a sane per-request timeout
 *  - translate transport errors into `PaygateNetworkError`
 *  - translate 4xx responses into `PaygateApiError` (carrying `errorCode`)
 *  - return parsed body on 2xx
 *
 * Out of scope: business logic, retries, caching. Those live in the
 * service layer.
 */
@Injectable()
export class PaygateClient {
  private readonly logger = new Logger(PaygateClient.name);

  constructor(
    private readonly cfg: PaygateConfigService,
    private readonly http: HttpService,
  ) {}

  get<TResponse>(path: string, options?: RequestOptions) {
    return this.request<TResponse>('GET', path, undefined, options);
  }

  post<TResponse>(path: string, body: unknown, options?: RequestOptions) {
    return this.request<TResponse>('POST', path, body, options);
  }

  delete<TResponse>(path: string, options?: RequestOptions) {
    return this.request<TResponse>('DELETE', path, undefined, options);
  }

  private async request<TResponse>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body: unknown,
    options: RequestOptions = {},
  ): Promise<TResponse> {
    const apiBase = this.cfg.apiBase;
    if (!apiBase) {
      throw new PaygateNetworkError('PAYGATE_API_BASE is not configured');
    }
    const token =
      options.bearerToken !== undefined
        ? options.bearerToken
        : this.cfg.bearerToken;
    if (!token) {
      throw new PaygateNetworkError('PAYGATE_BEARER_TOKEN is not configured');
    }

    const url = `${apiBase}${path.startsWith('/') ? path : `/${path}`}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    };

    let response: AxiosResponse<unknown>;
    try {
      response = await firstValueFrom(
        this.http.request({
          method,
          url,
          data: body,
          headers,
          timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          validateStatus: () => true,
        }),
      );
    } catch (err) {
      const message = this.describeNetworkError(err, options.timeoutMs);
      this.logger.warn(`Paygate ${method} ${path} failed: ${message}`);
      throw new PaygateNetworkError(message, err);
    }

    return this.handleResponse<TResponse>(method, path, response);
  }

  private handleResponse<TResponse>(
    method: string,
    path: string,
    response: AxiosResponse<unknown>,
  ): TResponse {
    const { status, data } = response;

    if (status >= 200 && status < 300) {
      return data as TResponse;
    }

    // 4xx → API error. We pull `message` and `errorCode` when present
    // (Paygate's standard error shape per the sandbox spec).
    if (status >= 400 && status < 500) {
      const { message, errorCode } = parsePaygateErrorBody(data);
      throw new PaygateApiError({
        httpStatus: status,
        message:
          message ?? `Paygate rejected ${method} ${path} (HTTP ${status})`,
        errorCode,
      });
    }

    // 5xx and anything unexpected: treated as transient transport-level.
    const description = `Paygate returned HTTP ${status} on ${method} ${path}`;
    this.logger.warn(description);
    throw new PaygateNetworkError(description);
  }

  private describeNetworkError(
    err: unknown,
    timeoutMs: number | undefined,
  ): string {
    if (axios.isAxiosError(err)) {
      if (err.code === 'ECONNABORTED') {
        return `Timeout (${timeoutMs ?? DEFAULT_TIMEOUT_MS}ms)`;
      }
      return err.message || err.code || 'Network error';
    }
    if (err instanceof Error) {
      return err.message;
    }
    return 'Unknown network error talking to Paygate';
  }
}

function parsePaygateErrorBody(data: unknown): {
  message: string | null;
  errorCode: string | null;
} {
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const message = typeof obj.message === 'string' ? obj.message : null;
    const errorCode = typeof obj.errorCode === 'string' ? obj.errorCode : null;
    return { message, errorCode };
  }
  return { message: null, errorCode: null };
}
