export type PaygateConnectivity =
  | { status: 'skipped'; reason: string }
  | { status: 'ok'; httpStatus: 200; latencyMs: number }
  | {
      status: 'unauthorized';
      httpStatus: 401 | 403;
      latencyMs: number;
      message: string;
    }
  | {
      status: 'unexpected_status';
      httpStatus: number;
      latencyMs: number;
      message: string;
    }
  | { status: 'unreachable'; latencyMs: number; message: string };

export interface PaygateHealthResponse {
  configured: boolean;
  apiBase: string | null;
  currency: string;
  linkExpirationHours: number;
  missing: {
    apiBase: boolean;
    bearerToken: boolean;
    webhookSecret: boolean;
  };
  connectivity: PaygateConnectivity;
  checkedAt: string;
  cached: boolean;
}
