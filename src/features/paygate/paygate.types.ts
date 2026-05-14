// =====================================================================
// Health
// =====================================================================

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

// =====================================================================
// Payment links — POST /pos/payment
// =====================================================================

export type PaygateCurrency = 'HNL' | 'USD';

export interface CreatePaymentLinkInput {
  /** Text shown on the hosted checkout page. e.g. "Ticket - Event X". */
  description: string;
  /** Amount in currency units (not cents). Paygate accepts two decimals. */
  amount: number;
  /** ISO 4217 currency code. Defaults to `PAYGATE_CURRENCY` from config. */
  currency?: PaygateCurrency;
  /** Tax already included in `amount`. 0 if not applicable. */
  tax?: number;
  /**
   * Hours until the link expires. Falls back to
   * `PAYGATE_LINK_EXPIRATION_HOURS` from config when omitted.
   */
  expirationHours?: number;
}

/**
 * Paygate response when creating a single-payment link.
 * We only expose the fields documented in the sandbox spec.
 */
export interface PaygatePaymentLink {
  /** Paygate link ID. We persist it as `paygate_link_id`. */
  id: string;
  /** Hosted-checkout URL handed to the buyer. */
  link: string;
  amount: number;
  subtotal: number;
  tax: number;
  description: string;
  expires: boolean;
  /** TTL configured when the link was created. */
  expirationHours: number;
  currency: string;
  /** Times the link has been processed (always 0 on creation). */
  numberOfProcesses: number;
  isOpenAmount: boolean;
  /** Paygate-side status (`PENDING`, `PROCESSED`, etc.) when available. */
  status?: string;
}

/**
 * Raw shape Paygate returns. Internal — the service maps it to
 * `PaygatePaymentLink`. Kept here so the HTTP client stays typed
 * without falling back to `any`.
 */
export interface PaygatePaymentLinkRaw {
  _id: string;
  link?: string;
  amount: number;
  subtotal: number;
  tax: number;
  description: string;
  expires: boolean;
  expiration: number;
  currency: string;
  numberOfProcesses: number;
  maximumNumberOfProcessesAllowed: number | null;
  isOpenAmount: boolean;
  status?: string;
}

// =====================================================================
// Webhook payload
// =====================================================================

/**
 * Known charge statuses Paygate reports in webhook payloads.
 * Kept as a `const` array so callers can do exhaustive checks while
 * leaving the type permissive (Paygate may add new statuses).
 */
export const PAYGATE_WEBHOOK_KNOWN_STATUSES = [
  'APPROVED',
  'DENIED',
  'CANCELED',
] as const;

export type PaygateWebhookKnownStatus =
  (typeof PAYGATE_WEBHOOK_KNOWN_STATUSES)[number];

/**
 * Expected shape of the Paygate webhook payload. Tentative until a
 * real sandbox webhook has been captured and inspected.
 */
export interface PaygateWebhookPayload {
  /** Paygate charge ID once confirmed. */
  _id: string;
  /** Final charge status — see `PAYGATE_WEBHOOK_KNOWN_STATUSES`. */
  status: string;
  amount?: number;
  currency?: string;
  description?: string;
  transactionID?: string;
  createdAt?: string;
  /** External reference we attached when creating the link/order. */
  orderReference?: string;
}
