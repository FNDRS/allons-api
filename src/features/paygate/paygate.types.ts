export interface PaygateHealthMissing {
  apiBase: boolean;
  bearerToken: boolean;
  webhookSecret: boolean;
}

export type PaygateConnectivity =
  | { status: 'ok'; httpStatus: number; latencyMs: number }
  | {
      status: 'unauthorized';
      httpStatus: number;
      latencyMs: number;
      message: string;
    }
  | { status: 'unreachable'; latencyMs: number; message: string }
  | { status: 'skipped'; reason: string };

export interface PaygateHealthResponse {
  configured: boolean;
  apiBase: string | null;
  currency: string;
  linkExpirationHours: number;
  missing: PaygateHealthMissing;
  connectivity: PaygateConnectivity;
  checkedAt: string;
}
